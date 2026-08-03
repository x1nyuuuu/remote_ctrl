package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	cfg := LoadConfig()
	hub := NewHub(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWS(hub, cfg, w, r)
	})
	mux.HandleFunc("/api/ice", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"iceServers": hub.iceServers()})
	})

	if cfg.StaticDir != "" {
		if st, err := os.Stat(cfg.StaticDir); err == nil && st.IsDir() {
			mux.Handle("/", spaHandler(cfg.StaticDir))
			log.Printf("serving static from %s", cfg.StaticDir)
		} else {
			log.Printf("static dir %s not found, API/WS only", cfg.StaticDir)
		}
	}

	log.Printf("relay listening on %s token=%s turn=%s:%d", cfg.ListenAddr, mask(cfg.AuthToken), cfg.TURNHost, cfg.TURNPort)
	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func mask(s string) string {
	if len(s) <= 4 {
		return "****"
	}
	return s[:2] + "****" + s[len(s)-2:]
}

func handleWS(hub *Hub, cfg Config, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade: %v", err)
		return
	}

	var peer *Peer
	roomID := "default"

	defer func() {
		hub.Leave(roomID, peer)
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			_ = writeJSON(conn, map[string]any{"v": 1, "type": "error", "message": "bad json"})
			continue
		}
		typ, _ := msg["type"].(string)
		switch typ {
		case "join":
			token, _ := msg["token"].(string)
			if token != cfg.AuthToken {
				_ = writeJSON(conn, map[string]any{"v": 1, "type": "error", "message": "unauthorized"})
				return
			}
			roleStr, _ := msg["role"].(string)
			if rid, ok := msg["room"].(string); ok && rid != "" {
				roomID = rid
			}
			p, err := hub.Join(roomID, Role(roleStr), conn)
			if err != nil {
				_ = writeJSON(conn, map[string]any{"v": 1, "type": "error", "message": err.Error()})
				return
			}
			peer = p
		case "signal", "input":
			if peer == nil {
				_ = writeJSON(conn, map[string]any{"v": 1, "type": "error", "message": "join first"})
				continue
			}
			hub.Forward(roomID, peer, msg)
		case "ping":
			if peer != nil {
				_ = peer.sendJSON(map[string]any{"v": 1, "type": "pong"})
			}
		default:
			_ = writeJSON(conn, map[string]any{"v": 1, "type": "error", "message": "unknown type"})
		}
	}
}

func spaHandler(staticDir string) http.Handler {
	root := http.Dir(staticDir)
	fileServer := http.FileServer(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(staticDir, filepath.Clean(r.URL.Path))
		if !strings.HasPrefix(path, filepath.Clean(staticDir)) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		fi, err := os.Stat(path)
		if err == nil && !fi.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		index := filepath.Join(staticDir, "index.html")
		if _, err := os.Stat(index); err == nil {
			http.ServeFile(w, r, index)
			return
		}
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = fs.ErrNotExist
		http.NotFound(w, r)
	})
}
