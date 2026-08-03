# Remote — local pathfinding

See [docs/PLAN.md](docs/PLAN.md) for product decisions.  
VPS and domain can be filled in later; local Docker is enough to develop.

## Layout

| Path | Role |
|------|------|
| `relay/` | Go signaling + static web host |
| `web/` | TypeScript browser client (“Notes” shell) |
| `agent/` | C# Windows agent (capture + input + WebRTC) |
| `deploy/` | Docker Compose + coturn |
| `desktop/` | Electron skin (later) |

## Prerequisites (this machine)

Install/uninstall via winget: [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md).

Pathfinding needs:

| Tool | Used for |
|------|----------|
| **Node.js 20+** | build `web/` |
| **Go 1.22+** *or* **Docker** | run `relay/` (+ coturn) |
| **.NET 8 SDK** | run Windows `agent/` |

VPS/domain are optional until M4.

## Quick start (Windows)

### 1) Start relay (+ optional TURN)

```powershell
cd deploy
copy .env.example .env
docker compose up --build
```

Open http://127.0.0.1:8080 — token default `dev-token-change-me`.

### 2) Dev web (hot reload, optional)

```powershell
cd web
npm install
npm run dev
```

Vite proxies `/ws` to `:8080`.

### 3) Run agent on the home PC

```powershell
cd agent
dotnet run -- --relay ws://127.0.0.1:8080/ws --token dev-token-change-me --room default
```

Requires .NET 8 SDK (Windows).

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_TOKEN` | `dev-token-change-me` | Shared join token |
| `TURN_HOST` | `127.0.0.1` | Host advertised in ICE (use VPS public IP later) |
| `TURN_SECRET` | `dev-turn-secret-change-me` | Must match coturn `static-auth-secret` |

## Milestone map

- M0–M1: compose + join + WebRTC signaling  
- M2: mouse/keyboard over WS `input`  
- M3: real screen via agent  
- M4: same images on your VPS + real domain (you supply later)
