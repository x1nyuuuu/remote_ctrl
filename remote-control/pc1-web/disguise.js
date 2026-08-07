/**
 * 浏览器版流量伪装层（PC1 Web 控制台）
 */
const Disguise = (() => {
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

  function uuid() {
    return crypto.randomUUID();
  }

  function fakeMeta() {
    return {
      ua: navigator.userAgent,
      ref: 'https://portal.corp-analytics.internal/dashboard',
      vid: uuid().slice(0, 8),
      plat: 'web',
    };
  }

  function noiseEvents(count = 2) {
    const pages = ['/dashboard', '/reports', '/settings', '/team'];
    const events = [];
    for (let i = 0; i < count; i++) {
      events.push({
        e: 'page_view',
        p: pages[Math.floor(Math.random() * pages.length)],
        d: btoa(JSON.stringify({ t: Date.now(), r: Math.random() }))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, ''),
      });
    }
    return events;
  }

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encode(payload, sessionId) {
    const disguisedType = EVENT_MAP[payload.type] || 'custom_event';
    const realData = toBase64Url(JSON.stringify(payload));

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

    return { v: 2, sid: sessionId, ts: Date.now(), batch, meta: fakeMeta() };
  }

  function decode(envelope) {
    if (!envelope?.batch) return null;
    for (const item of envelope.batch) {
      if (!item.d) continue;
      try {
        const parsed = JSON.parse(fromBase64Url(item.d));
        if (parsed?.type) return parsed;
      } catch {
        /* noise */
      }
    }
    return null;
  }

  return { encode, decode };
})();
