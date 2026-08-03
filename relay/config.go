package main

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	ListenAddr     string
	AuthToken      string
	StaticDir      string
	TURNHost       string
	TURNPort       int
	TURNSecret     string
	TURNRealm      string
	CredTTL        time.Duration
	PublicSTUNURL  string
}

func LoadConfig() Config {
	ttlMin, _ := strconv.Atoi(getenv("TURN_CRED_TTL_MIN", "60"))
	turnPort, _ := strconv.Atoi(getenv("TURN_PORT", "3478"))
	return Config{
		ListenAddr:    getenv("LISTEN_ADDR", ":8080"),
		AuthToken:     getenv("AUTH_TOKEN", "dev-token-change-me"),
		StaticDir:     getenv("STATIC_DIR", "static"),
		TURNHost:      getenv("TURN_HOST", "127.0.0.1"),
		TURNPort:      turnPort,
		TURNSecret:    getenv("TURN_SECRET", "dev-turn-secret-change-me"),
		TURNRealm:     getenv("TURN_REALM", "remote.local"),
		CredTTL:       time.Duration(ttlMin) * time.Minute,
		PublicSTUNURL: getenv("PUBLIC_STUN_URL", "stun:stun.l.google.com:19302"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
