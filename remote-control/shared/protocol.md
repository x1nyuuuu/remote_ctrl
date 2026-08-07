# 协议说明

## 角色

| 角色 | 代号 | 职责 |
|------|------|------|
| 公司电脑 | PC1 | Web 控制台，查看 PC2 屏幕并发送键鼠操作 |
| 服务器 | S | WebSocket 中继，配对 PC1 与 PC2 |
| 家中电脑 | PC2 | 被控端，截屏 + 执行键鼠，无本地 UI |

## 连接路径（仅 PC1 → PC2）

```
PC1 ──WebSocket──► S ◄──WebSocket── PC2
         伪装为 analytics 遥测流
```

- PC1 连接: `ws://S/api/v2/telemetry/stream?role=viewer&token=XXX`
- PC2 连接: `ws://S/api/v2/telemetry/collect?role=agent&token=XXX`

## 消息类型

| type | 方向 | 说明 |
|------|------|------|
| register | PC1/PC2 → S | 注册角色 |
| paired | S → PC1/PC2 | 配对成功 |
| screen_frame | PC2 → PC1 | JPEG 截屏帧 (base64) |
| mouse_move | PC1 → PC2 | 鼠标移动 |
| mouse_click | PC1 → PC2 | 鼠标点击 |
| mouse_down/up | PC1 → PC2 | 按下/释放 |
| key_down/up | PC1 → PC2 | 键盘 |
| ping/pong | 双向 | 心跳 |

## 流量伪装方案

### 1. 传输层

- 生产环境使用 **WSS (TLS)**，端口 443，与 HTTPS 无法区分
- WebSocket 路径伪装为企业 SaaS 埋点 API：
  - `/api/v2/telemetry/stream` — PC1「订阅报表流」
  - `/api/v2/telemetry/collect` — PC2「上报事件」

### 2. 应用层信封

每条 WebSocket 消息均为 JSON，结构模仿 Segment/Clarity 埋点 batch：

```json
{
  "v": 2,
  "sid": "session-uuid",
  "ts": 1699999999999,
  "batch": [
    {"e": "page_view", "p": "/dashboard", "d": "<噪声base64>"},
    {"e": "scroll_depth", "p": "/remote-session", "d": "<真实payload的base64>"},
    {"e": "click", "p": "/reports", "d": "<噪声base64>"}
  ],
  "meta": {"ua": "Mozilla/5.0...", "ref": "https://portal.corp-analytics.internal/dashboard"}
}
```

真实远控数据藏在某个 batch 事件的 `d` 字段（base64url 编码的内部 JSON）。

### 3. 事件名映射

| 真实类型 | 伪装事件名 |
|----------|------------|
| screen_frame | scroll_depth |
| mouse_* | mouse_move / click / mousedown / mouseup |
| key_* | keydown / keyup |
| ping/pong | heartbeat / heartbeat_ack |

### 4. 噪声填充

每条消息随机插入 1–3 个 `page_view` 噪声事件，batch 长度与真实 BI 上报接近。

### 5. PC1 侧额外建议

- 浏览器访问控制台时使用公司内网域名（如 `analytics.corp.internal`）
- 可配合 hosts / 反向代理，让 S 的 IP 解析为内网 SaaS 域名
- 截屏帧在 `screen_frame.data` 内已是 JPEG base64，外层再包一层 analytics 信封
