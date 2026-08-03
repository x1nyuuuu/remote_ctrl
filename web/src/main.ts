type IceServer = RTCIceServer;

type WireMsg = {
  v?: number;
  type: string;
  role?: string;
  room?: string;
  token?: string;
  peers?: string[];
  iceServers?: IceServer[];
  payload?: unknown;
  from?: string;
  message?: string;
};

const statusEl = document.querySelector("#status") as HTMLElement;
const overlayEl = document.querySelector("#overlay") as HTMLElement;
const videoEl = document.querySelector("#remote") as HTMLVideoElement;
const tokenEl = document.querySelector("#token") as HTMLInputElement;
const roomEl = document.querySelector("#room") as HTMLInputElement;
const connectBtn = document.querySelector("#connect") as HTMLButtonElement;

const saved = localStorage.getItem("remote.token");
if (saved) tokenEl.value = saved;

let ws: WebSocket | null = null;
let pc: RTCPeerConnection | null = null;
let iceServers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let makingOffer = false;
let ignoreOffer = false;
let isAgentPolite = true; // client is polite peer

function setStatus(s: string) {
  statusEl.textContent = s;
}

function setOverlay(text: string | null) {
  if (!text) {
    overlayEl.classList.add("hidden");
    overlayEl.textContent = "";
    return;
  }
  overlayEl.classList.remove("hidden");
  overlayEl.textContent = text;
}

function wsURL(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function send(msg: WireMsg) {
  ws?.send(JSON.stringify({ v: 1, ...msg }));
}

async function ensurePC() {
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    send({
      type: "signal",
      payload: { kind: "candidate", candidate: ev.candidate.toJSON() },
    });
  };

  pc.onconnectionstatechange = () => {
    setStatus(`webrtc: ${pc?.connectionState}`);
    if (pc?.connectionState === "connected") setOverlay(null);
  };

  pc.ontrack = (ev) => {
    videoEl.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
    setOverlay(null);
  };

  return pc;
}

async function handleSignal(payload: any) {
  const peer = await ensurePC();
  const kind = payload?.kind as string;
  if (kind === "offer") {
    const offerCollision = makingOffer || peer.signalingState !== "stable";
    ignoreOffer = !isAgentPolite && offerCollision;
    if (ignoreOffer) return;
    await peer.setRemoteDescription(payload.sdp);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send({
      type: "signal",
      payload: { kind: "answer", sdp: peer.localDescription },
    });
  } else if (kind === "answer") {
    await peer.setRemoteDescription(payload.sdp);
  } else if (kind === "candidate" && payload.candidate) {
    try {
      await peer.addIceCandidate(payload.candidate);
    } catch (e) {
      if (!ignoreOffer) console.warn(e);
    }
  } else if (kind === "negotiate") {
    await startOffer();
  }
}

async function startOffer() {
  // Client is recvonly — agent creates the offer.
}

function bindInput() {
  const stage = document.querySelector(".stage") as HTMLElement;

  const sendInput = (payload: Record<string, unknown>) => {
    send({ type: "input", payload });
  };

  const norm = (ev: MouseEvent) => {
    const rect = videoEl.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / Math.max(rect.width, 1);
    const y = (ev.clientY - rect.top) / Math.max(rect.height, 1);
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  };

  stage.addEventListener("mousemove", (ev) => {
    if (!pc || pc.connectionState !== "connected") return;
    const { x, y } = norm(ev);
    sendInput({ kind: "mouse-move", x, y });
  });

  stage.addEventListener("mousedown", (ev) => {
    const { x, y } = norm(ev);
    sendInput({ kind: "mouse-down", x, y, button: ev.button });
    ev.preventDefault();
  });

  stage.addEventListener("mouseup", (ev) => {
    const { x, y } = norm(ev);
    sendInput({ kind: "mouse-up", x, y, button: ev.button });
    ev.preventDefault();
  });

  stage.addEventListener(
    "wheel",
    (ev) => {
      sendInput({ kind: "wheel", dx: ev.deltaX, dy: ev.deltaY });
      ev.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    sendInput({
      kind: "key-down",
      key: ev.key,
      code: ev.code,
      alt: ev.altKey,
      ctrl: ev.ctrlKey,
      shift: ev.shiftKey,
      meta: ev.metaKey,
    });
  });

  window.addEventListener("keyup", (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    sendInput({
      kind: "key-up",
      key: ev.key,
      code: ev.code,
      alt: ev.altKey,
      ctrl: ev.ctrlKey,
      shift: ev.shiftKey,
      meta: ev.metaKey,
    });
  });
}

function connect() {
  const token = tokenEl.value.trim();
  const room = roomEl.value.trim() || "default";
  if (!token) {
    setOverlay("Token required");
    return;
  }
  localStorage.setItem("remote.token", token);

  ws?.close();
  pc?.close();
  pc = null;

  setStatus("connecting");
  setOverlay("Connecting…");
  ws = new WebSocket(wsURL());

  ws.onopen = () => {
    send({ type: "join", role: "client", room, token });
  };

  ws.onclose = () => {
    setStatus("disconnected");
    setOverlay("Disconnected");
  };

  ws.onerror = () => setStatus("ws error");

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data) as WireMsg;
    switch (msg.type) {
      case "joined":
        setStatus(`joined as client`);
        if (msg.iceServers?.length) iceServers = msg.iceServers;
        await ensurePC();
        if (msg.peers?.includes("agent")) setOverlay("Waiting for media…");
        else setOverlay("Waiting for agent…");
        break;
      case "peer-joined":
        if (msg.role === "agent") setOverlay("Agent online, waiting for media…");
        break;
      case "peer-left":
        setOverlay("Peer left");
        break;
      case "signal":
        await handleSignal(msg.payload);
        break;
      case "error":
        setOverlay(msg.message || "error");
        setStatus("error");
        break;
    }
  };
}

connectBtn.addEventListener("click", connect);
bindInput();

// Prefill from query ?token=
const q = new URLSearchParams(location.search);
if (q.get("token")) tokenEl.value = q.get("token") || "";
