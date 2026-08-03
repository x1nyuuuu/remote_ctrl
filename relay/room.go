package main

import (
	"encoding/json"
	"log"
	"strconv"
	"sync"

	"github.com/gorilla/websocket"
)

type Role string

const (
	RoleAgent  Role = "agent"
	RoleClient Role = "client"
)

type Peer struct {
	Role   Role
	Conn   *websocket.Conn
	Send   chan []byte
	closed sync.Once
}

type Room struct {
	mu     sync.Mutex
	id     string
	agent  *Peer
	client *Peer
}

type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	cfg   Config
}

func NewHub(cfg Config) *Hub {
	return &Hub{rooms: make(map[string]*Room), cfg: cfg}
}

func (h *Hub) getRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[id]
	if !ok {
		r = &Room{id: id}
		h.rooms[id] = r
	}
	return r
}

func (h *Hub) Join(roomID string, role Role, conn *websocket.Conn) (*Peer, error) {
	room := h.getRoom(roomID)
	room.mu.Lock()
	defer room.mu.Unlock()

	peer := &Peer{
		Role: role,
		Conn: conn,
		Send: make(chan []byte, 64),
	}

	switch role {
	case RoleAgent:
		if room.agent != nil {
			_ = writeJSON(room.agent.Conn, map[string]any{
				"v": 1, "type": "error", "message": "replaced by new agent",
			})
			closePeer(room.agent)
		}
		room.agent = peer
	case RoleClient:
		if room.client != nil {
			_ = writeJSON(room.client.Conn, map[string]any{
				"v": 1, "type": "error", "message": "replaced by new client",
			})
			closePeer(room.client)
		}
		room.client = peer
	default:
		return nil, errInvalidRole
	}

	go peerWriter(peer)

	others := []string{}
	if room.agent != nil && role != RoleAgent {
		others = append(others, string(RoleAgent))
	}
	if room.client != nil && role != RoleClient {
		others = append(others, string(RoleClient))
	}

	ice := h.iceServers()
	_ = peer.sendJSON(map[string]any{
		"v": 1, "type": "joined", "role": role, "room": roomID, "peers": others, "iceServers": ice,
	})

	if other := room.other(role); other != nil {
		_ = other.sendJSON(map[string]any{
			"v": 1, "type": "peer-joined", "role": role,
		})
	}

	log.Printf("room=%s join role=%s peers=%v", roomID, role, others)
	return peer, nil
}

func (h *Hub) Leave(roomID string, peer *Peer) {
	if peer == nil {
		return
	}
	room := h.getRoom(roomID)
	room.mu.Lock()
	defer room.mu.Unlock()

	switch peer.Role {
	case RoleAgent:
		if room.agent == peer {
			room.agent = nil
		}
	case RoleClient:
		if room.client == peer {
			room.client = nil
		}
	}
	closePeer(peer)

	if other := room.other(peer.Role); other != nil {
		_ = other.sendJSON(map[string]any{
			"v": 1, "type": "peer-left", "role": peer.Role,
		})
	}
	log.Printf("room=%s leave role=%s", roomID, peer.Role)
}

func (h *Hub) Forward(roomID string, from *Peer, msg map[string]any) {
	room := h.getRoom(roomID)
	room.mu.Lock()
	other := room.other(from.Role)
	room.mu.Unlock()
	if other == nil {
		_ = from.sendJSON(map[string]any{"v": 1, "type": "error", "message": "peer not connected"})
		return
	}
	msg["from"] = string(from.Role)
	_ = other.sendJSON(msg)
}

func (r *Room) other(role Role) *Peer {
	if role == RoleAgent {
		return r.client
	}
	return r.agent
}

func (h *Hub) iceServers() []map[string]any {
	user, pass, _ := turnCredentials(h.cfg.TURNSecret, h.cfg.CredTTL)
	hostPort := h.cfg.TURNHost + ":" + strconv.Itoa(h.cfg.TURNPort)
	turnURI := "turn:" + hostPort
	servers := []map[string]any{
		{"urls": h.cfg.PublicSTUNURL},
		{
			"urls": []string{
				turnURI + "?transport=udp",
				turnURI + "?transport=tcp",
			},
			"username":   user,
			"credential": pass,
		},
	}
	return servers
}

func (p *Peer) sendJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	select {
	case p.Send <- b:
		return nil
	default:
		return errSendBufferFull
	}
}

func peerWriter(p *Peer) {
	for b := range p.Send {
		if err := p.Conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}
}

func closePeer(p *Peer) {
	if p == nil {
		return
	}
	p.closed.Do(func() {
		close(p.Send)
		_ = p.Conn.Close()
	})
}

func writeJSON(conn *websocket.Conn, v any) error {
	return conn.WriteJSON(v)
}
