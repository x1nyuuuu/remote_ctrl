package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"
)

// REST API style temporary credentials for coturn use-auth-secret.
func turnCredentials(secret string, ttl time.Duration) (username, password string, expiresAt int64) {
	expiresAt = time.Now().Add(ttl).Unix()
	username = fmt.Sprintf("%d:remote", expiresAt)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, password, expiresAt
}
