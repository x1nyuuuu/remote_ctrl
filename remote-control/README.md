# 轻量化远程控制工具

PC1（公司电脑）通过服务器 S 控制 PC2（家中电脑）。PC2 无 UI，后台运行；PC1 使用 Web 控制台查看屏幕并操作键鼠。

## 架构

```
PC1 (Web 控制台)  ──►  S (中继服务器)  ◄──  PC2 (被控 Agent)
     伪装 analytics 遥测 WebSocket 流量
```

## 快速开始

### 1. 服务器 S

```bash
cd remote-control/server
npm install
TOKEN=your-secret-token node index.js
```

- 控制台: `http://SERVER_IP:8443/console`
- 默认端口 `8443`，可通过 `PORT` 修改

### 2. PC2 被控端（家中电脑）

```bash
cd remote-control/pc2-agent
pip install -r requirements.txt
python agent.py --server ws://SERVER_IP:8443 --token your-secret-token
```

Windows 需以普通用户运行；Linux 可能需要 `DISPLAY` 环境变量。

### 3. PC1 控制台（公司电脑）

浏览器打开 `http://SERVER_IP:8443/console`，填入 Gateway 地址与 Token，点击 Connect。

## 流量伪装方案

详见 [shared/protocol.md](shared/protocol.md)。

| 层级 | 手段 |
|------|------|
| 传输 | WSS/443，与 HTTPS 一致 |
| 路径 | `/api/v2/telemetry/stream` / `collect`，仿 SaaS 埋点 |
| 载荷 | JSON batch 埋点信封，真实数据 base64 藏在 `d` 字段 |
| 噪声 | 每条消息混入 `page_view` 假事件 |
| 事件名 | `screen_frame`→`scroll_depth`，`mouse_*`→`click` 等 |

**PC1 侧建议**：用内网域名（如 `analytics.corp.internal`）解析到 S，控制台标题已伪装为 “Corp Analytics Dashboard”。

## 安全与加密

### 伪装 ≠ 加密

| 层级 | 当前「伪装」 | 真正加密 |
|------|-------------|----------|
| 内容格式 | base64 埋点信封，**可轻易解码** | TLS 加密整个传输通道 |
| 传输 | 默认 `http://` / `ws://` **明文** | `https://` / `wss://` **密文** |

**生产环境必须启用 TLS**，否则截屏、键鼠指令在网络上明文传输。

### 方案 A：Caddy 反向代理（推荐，有域名）

```bash
# 终端 1 — Node 本地明文
TOKEN=your-secret node index.js

# 终端 2 — Caddy 对外 HTTPS/WSS（自动申请 Let's Encrypt 证书）
# 编辑 server/Caddyfile 填入你的域名
caddy run
```

PC1 访问：`https://your-domain.com/console`  
PC2 连接：`wss://your-domain.com`  
Gateway 填：`wss://your-domain.com`

### 方案 B：Node 直接 TLS（自签名或自有证书）

```bash
cd remote-control/server
bash gen-self-signed-cert.sh
SSL_CERT=cert.pem SSL_KEY=key.pem TOKEN=your-secret node index.js
```

PC1：`https://服务器IP:8443/console`（自签名证书浏览器会警告，点继续）  
PC2：`python agent.py --server wss://服务器IP:8443 --token your-secret`

### 方案 C：nginx + certbot

nginx 监听 443，反代到 `localhost:8443`，配置 `proxy_http_version 1.1` 和 `Upgrade` 头以支持 WebSocket。

## 安全提示

- 务必修改默认 `TOKEN`
- 生产环境必须 TLS（Caddy / nginx / 直接 SSL_CERT）
- 本工具无端到端加密；TLS 只保护 PC↔S 传输，服务器仍能看到明文

## 目录

```
remote-control/
├── server/       # S — Node.js 中继
├── pc2-agent/    # PC2 — Python 被控端
├── pc1-web/      # PC1 — Web 控制台
└── shared/       # 协议 & 伪装层
```
