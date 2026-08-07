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

## 安全提示

- 务必修改默认 `TOKEN`，生产环境启用 TLS（反向代理 nginx/caddy）
- 本工具为轻量演示，未做端到端加密；敏感场景请在 TLS 之上再加应用层加密

## 目录

```
remote-control/
├── server/       # S — Node.js 中继
├── pc2-agent/    # PC2 — Python 被控端
├── pc1-web/      # PC1 — Web 控制台
└── shared/       # 协议 & 伪装层
```
