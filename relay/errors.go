package main

import "errors"

var (
	errInvalidRole    = errors.New("invalid role")
	errSendBufferFull = errors.New("send buffer full")
)
