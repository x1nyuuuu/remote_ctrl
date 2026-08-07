/**
 * PC1 Web 控制台 — 查看 PC2 屏幕并发送键鼠操作
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('screen');
  const ctx = canvas.getContext('2d');
  const overlay = $('overlay');
  const dotServer = $('dot-server');
  const dotAgent = $('dot-agent');
  const fpsLabel = $('fps-label');

  let ws = null;
  let sessionId = crypto.randomUUID();
  let agentOnline = false;
  let frameCount = 0;
  let lastFpsTime = Date.now();

  const KEY_MAP = {
    Enter: 'enter',
    Backspace: 'backspace',
    Tab: 'tab',
    Escape: 'escape',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ' ': 'space',
    Delete: 'delete',
    Home: 'home',
    End: 'end',
  };

  function setStatus(el, on) {
    el.classList.toggle('on', on);
    el.classList.toggle('off', !on);
  }

  function send(payload) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(Disguise.encode(payload, sessionId)));
    }
  }

  function buildUrl(server, token) {
    const base = server.replace(/\/$/, '');
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}/api/v2/telemetry/stream?role=viewer&token=${encodeURIComponent(token)}`;
  }

  function connect() {
    const server = $('server-url').value.trim();
    const token = $('token').value.trim();
    if (!server || !token) {
      alert('请填写 Gateway 地址和 Token');
      return;
    }

    const url = buildUrl(server, token);
    ws = new WebSocket(url);
    sessionId = crypto.randomUUID();

    ws.onopen = () => {
      setStatus(dotServer, true);
      overlay.classList.add('hidden');
      $('btn-connect').disabled = true;
      $('btn-disconnect').disabled = false;
    };

    ws.onclose = () => {
      setStatus(dotServer, false);
      setStatus(dotAgent, false);
      agentOnline = false;
      overlay.classList.remove('hidden');
      overlay.textContent = 'Disconnected from gateway';
      $('btn-connect').disabled = false;
      $('btn-disconnect').disabled = true;
      ws = null;
    };

    ws.onerror = () => {
      overlay.textContent = 'Connection failed — check gateway URL and token';
      overlay.classList.remove('hidden');
    };

    ws.onmessage = (ev) => {
      let envelope;
      try {
        envelope = JSON.parse(ev.data);
      } catch {
        return;
      }
      const payload = Disguise.decode(envelope);
      if (!payload) return;

      if (payload.type === 'paired') {
        agentOnline = payload.data?.online ?? false;
        setStatus(dotAgent, agentOnline);
      } else if (payload.type === 'screen_frame') {
        renderFrame(payload.data);
      }
    };

    // 心跳
    const hb = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) send({ type: 'ping', data: {} });
      else clearInterval(hb);
    }, 15000);
  }

  function disconnect() {
    ws?.close();
  }

  function renderFrame(data) {
    if (!data?.image) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      frameCount++;
      const now = Date.now();
      if (now - lastFpsTime >= 1000) {
        fpsLabel.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsTime = now;
      }
    };
    img.src = `data:image/jpeg;base64,${data.image}`;
  }

  function relCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = ((e.clientX - rect.left) * scaleX) / canvas.width;
    const y = ((e.clientY - rect.top) * scaleY) / canvas.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!agentOnline) return;
    send({ type: 'mouse_move', data: relCoords(e) });
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!agentOnline) return;
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    send({ type: 'mouse_down', data: { ...relCoords(e), button: btn } });
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!agentOnline) return;
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    send({ type: 'mouse_up', data: { button: btn } });
  });

  canvas.addEventListener('click', (e) => {
    if (!agentOnline) return;
    const btn = e.button === 2 ? 'right' : 'left';
    send({ type: 'mouse_click', data: { ...relCoords(e), button: btn } });
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (!agentOnline || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const key = KEY_MAP[e.key] || (e.key.length === 1 ? e.key : null);
    if (key) send({ type: 'key_down', data: { key } });
  });

  document.addEventListener('keyup', (e) => {
    if (!agentOnline || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const key = KEY_MAP[e.key] || (e.key.length === 1 ? e.key : null);
    if (key) send({ type: 'key_up', data: { key } });
  });

  $('btn-connect').addEventListener('click', connect);
  $('btn-disconnect').addEventListener('click', disconnect);

  // 默认填入当前 host
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  $('server-url').value = `${proto}//${location.hostname}:${location.port || (location.protocol === 'https:' ? 443 : 80)}`;
})();
