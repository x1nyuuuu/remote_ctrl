#!/usr/bin/env node
/**
 * 服务器 S — WebSocket 中继 + PC1 Web 控制台静态资源
 *
 * 明文启动: TOKEN=your-secret node index.js
 * TLS 启动: SSL_CERT=cert.pem SSL_KEY=key.pem TOKEN=your-secret node index.js
 * 默认端口 8443（可设 PORT 环境变量）
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { encode, decode } = require('../shared/disguise');

const PORT = process.env.PORT || 8443;
const TOKEN = process.env.TOKEN || 'change-me-in-production';
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY = process.env.SSL_KEY;
const PC1_WEB = path.join(__dirname, '../pc1-web');
const USE_TLS = Boolean(SSL_CERT && SSL_KEY);
const SCHEME = USE_TLS ? 'https' : 'http';
const WS_SCHEME = USE_TLS ? 'wss' : 'ws';

const app = express();

// 健康检查 — 伪装为普通 API
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'corp-analytics-gateway', version: '2.1.0' });
});

// PC1 Web 控制台
app.use('/console', express.static(PC1_WEB));
app.get('/', (_req, res) => res.redirect('/console'));

const server = USE_TLS
  ? https.createServer(
      { cert: fs.readFileSync(SSL_CERT), key: fs.readFileSync(SSL_KEY) },
      app
    )
  : http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

/** @type {Map<string, { viewer?: WebSocket, agent?: WebSocket }>} */
const rooms = new Map();

function getRoom(token) {
  if (!rooms.has(token)) rooms.set(token, {});
  return rooms.get(token);
}

function sendDisguised(ws, payload, sessionId) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(encode(payload, sessionId)));
  }
}

function relay(fromWs, toWs, payload, sessionId) {
  if (toWs && toWs.readyState === toWs.OPEN) {
    sendDisguised(toWs, payload, sessionId);
    return true;
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token');
  const sessionId = uuidv4();

  if (!token || token !== TOKEN) {
    sendDisguised(ws, { type: 'error', data: { message: 'unauthorized' } }, sessionId);
    ws.close(4001, 'unauthorized');
    return;
  }

  if (role !== 'viewer' && role !== 'agent') {
    sendDisguised(ws, { type: 'error', data: { message: 'invalid role' } }, sessionId);
    ws.close(4002, 'invalid role');
    return;
  }

  const room = getRoom(token);
  ws._sessionId = sessionId;
  ws._role = role;
  ws._token = token;

  if (role === 'viewer') {
    room.viewer = ws;
    sendDisguised(ws, { type: 'register', data: { role: 'viewer', ok: true } }, sessionId);
    if (room.agent) {
      sendDisguised(ws, { type: 'paired', data: { peer: 'agent', online: true } }, sessionId);
      sendDisguised(room.agent, { type: 'paired', data: { peer: 'viewer', online: true } }, room.agent._sessionId);
    }
  } else {
    room.agent = ws;
    sendDisguised(ws, { type: 'register', data: { role: 'agent', ok: true } }, sessionId);
    if (room.viewer) {
      sendDisguised(ws, { type: 'paired', data: { peer: 'viewer', online: true } }, sessionId);
      sendDisguised(room.viewer, { type: 'paired', data: { peer: 'agent', online: true } }, room.viewer._sessionId);
    }
  }

  ws.on('message', (raw) => {
    let envelope;
    try {
      envelope = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const payload = decode(envelope);
    if (!payload) return;

    const r = getRoom(token);

    if (payload.type === 'ping') {
      sendDisguised(ws, { type: 'pong', data: { t: Date.now() } }, sessionId);
      return;
    }

    // PC1 → PC2 控制指令
    if (role === 'viewer' && r.agent) {
      relay(ws, r.agent, payload, r.agent._sessionId);
      return;
    }

    // PC2 → PC1 屏幕帧等
    if (role === 'agent' && r.viewer) {
      relay(ws, r.viewer, payload, r.viewer._sessionId);
    }
  });

  ws.on('close', () => {
    const r = getRoom(token);
    if (role === 'viewer' && r.viewer === ws) {
      r.viewer = undefined;
      if (r.agent) {
        sendDisguised(r.agent, { type: 'paired', data: { peer: 'viewer', online: false } }, r.agent._sessionId);
      }
    }
    if (role === 'agent' && r.agent === ws) {
      r.agent = undefined;
      if (r.viewer) {
        sendDisguised(r.viewer, { type: 'paired', data: { peer: 'agent', online: false } }, r.viewer._sessionId);
      }
    }
  });
});

// 升级 WebSocket — 路径伪装
server.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0];
  const allowed = ['/api/v2/telemetry/stream', '/api/v2/telemetry/collect'];
  if (!allowed.includes(pathname)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`[S] Analytics gateway listening on :${PORT} (${USE_TLS ? 'TLS' : 'plain HTTP'})`);
  console.log(`[S] PC1 console: ${SCHEME}://localhost:${PORT}/console`);
  console.log(`[S] WS viewer:   ${WS_SCHEME}://localhost:${PORT}/api/v2/telemetry/stream?role=viewer&token=${TOKEN}`);
  console.log(`[S] WS agent:    ${WS_SCHEME}://localhost:${PORT}/api/v2/telemetry/collect?role=agent&token=${TOKEN}`);
  if (!USE_TLS) {
    console.log('[S] WARNING: traffic is NOT encrypted. Set SSL_CERT + SSL_KEY or use Caddy/nginx.');
  }
});
