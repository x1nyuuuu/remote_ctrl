# 长期稳定生产部署方案

适用：有域名 + Cloudflare + 云服务器（S）+ 家中 Windows/Linux（PC2）+ 公司浏览器（PC1）。

---

## 一、目标架构

```
                    ┌─────────────────────────────────────┐
                    │           Cloudflare                │
                    │  HTTPS/WSS  Edge 证书 + DDoS 防护    │
                    │  域名: rc.yourdomain.com (示例)      │
                    └──────────────┬──────────────────────┘
                                   │ Full (Strict)
                                   │ Origin 证书
                    ┌──────────────▼──────────────────────┐
                    │  云服务器 S (Ubuntu 22.04+)          │
                    │  nginx :443 → Node :8443 (本地)      │
                    │  systemd 守护 + 自动重启             │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
         PC1 浏览器            WSS 中继              PC2 Agent
    https://rc.xxx/console   (disguised)      开机自启 + 断线重连
```

**设计原则**

| 原则 | 做法 |
|------|------|
| 传输加密 | Cloudflare Full (Strict) + Origin 证书 |
| 进程稳定 | systemd `Restart=always` |
| 配置安全 | Token 放 `/etc/remote-control.env`，权限 600 |
| 最小暴露 | 仅开放 443/22；Node 只监听 127.0.0.1:8443 |
| 可维护 | 固定目录、一键更新脚本、健康检查 |
| 伪装 | 子域名用 `analytics` / `metrics` 等 |

---

## 二、Cloudflare 配置（一次性）

### 2.1 DNS

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| A | `rc`（或 `analytics`） | 服务器公网 IP | 🟠 已代理 |

访问地址：`https://rc.yourdomain.com`

### 2.2 SSL/TLS

1. **SSL/TLS → Overview** → 选 **Full (strict)**
2. **SSL/TLS → Origin Server** → Create Certificate
   - 主机：`rc.yourdomain.com`
   - 保存 `origin.pem` / `origin-key.pem` 到服务器
3. **SSL/TLS → Edge Certificates** → 开启 **Always Use HTTPS**

### 2.3 Network

- **WebSockets**：ON（必须）
- **HTTP/2**：ON
- **HTTP/3 (QUIC)**：可选

### 2.4 安全（推荐）

- **Security → Settings** → Security Level: Medium
- **Firewall Rules**（可选）：限制 `/console` 仅公司 IP 段访问
- **Access**（可选）：给 `/console` 加 Cloudflare Access 登录

---

## 三、服务器 S 部署

### 3.1 系统要求

- Ubuntu 22.04 / Debian 12
- 1 核 1G 即可（中继 + 网页）
- Node.js 20 LTS

### 3.2 一键安装

```bash
# 以 root 或 sudo 用户
git clone -b cursor/remote-control-tool-5731 \
  https://github.com/x1nyuuuu/remote_ctrl.git /opt/remote-control
cd /opt/remote-control/remote-control/deploy
sudo bash install-server.sh
```

安装脚本会：

1. 安装 Node.js 20、nginx
2. 创建用户 `remotecontrol`
3. 部署代码到 `/opt/remote-control`
4. 配置 nginx + systemd
5. 提示你填写 Token 和 Origin 证书

### 3.3 手动配置要点

**环境变量** `/etc/remote-control/server.env`：

```bash
TOKEN=<64位随机字符串>
PORT=8443
HOST=127.0.0.1
NODE_ENV=production
```

生成 Token：

```bash
openssl rand -base64 48
```

**Origin 证书** 路径：

```
/etc/ssl/cloudflare/origin.pem
/etc/ssl/cloudflare/origin-key.pem
```

权限：

```bash
chmod 600 /etc/remote-control/server.env
chmod 600 /etc/ssl/cloudflare/origin-key.pem
```

### 3.4 服务管理

```bash
sudo systemctl status remote-control-server
sudo systemctl status nginx
sudo journalctl -u remote-control-server -f   # 日志
```

### 3.5 防火墙

```bash
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw enable
# 不要对外开放 8443
```

---

## 四、PC2 被控端（长期运行）

### 4.1 Windows（家中电脑，推荐）

1. 安装 Python 3.11+
2. 部署目录：`C:\RemoteControl\`
3. 配置 `C:\RemoteControl\agent.env`：

```ini
RC_SERVER=wss://rc.yourdomain.com
RC_TOKEN=<与服务器相同>
RC_FPS=8
```

4. 用 **NSSM** 或 **任务计划程序** 开机自启（见 `deploy/windows-install-agent.ps1`）

```powershell
# 管理员 PowerShell
cd C:\RemoteControl
.\windows-install-agent.ps1
```

### 4.2 Linux PC2

```bash
sudo cp deploy/remote-control-agent.service /etc/systemd/system/
# 编辑 EnvironmentFile=/etc/remote-control/agent.env
sudo systemctl enable --now remote-control-agent
```

### 4.3 PC2 稳定性

- Agent 已实现断线 **5 秒自动重连**
- 仅在有 viewer 在线时推帧，节省带宽
- 建议家中网络：路由器 DMZ 不需要（PC2 主动连出）

---

## 五、PC1 使用（公司电脑）

1. 浏览器访问：`https://rc.yourdomain.com/console`
2. Gateway：`wss://rc.yourdomain.com`
3. Token：与服务器一致
4. 可收藏为书签；页面标题已伪装为 Analytics Dashboard

**建议**：公司网络只允许访问该子域名，不暴露 IP。

---

## 六、安全层级总结

| 层级 | 措施 |
|------|------|
| L1 传输 | TLS 全程（Cloudflare + Origin） |
| L2 鉴权 | 强 Token，三端一致 |
| L3 伪装 | analytics 埋点格式 + 子域名 |
| L4 网络 | 防火墙 + Cloudflare WAF |
| L5 访问控制 | CF Firewall 限制 IP / CF Access |

**未做**：端到端加密（服务器可见明文）。若需 E2E，后续可加 AES 层。

---

## 七、运维日历

| 频率 | 事项 |
|------|------|
| 每周 | `systemctl status` + 访问 console 测连通 |
| 每月 | `git pull` 更新 + `npm install` |
| 每季度 | 轮换 TOKEN |
| 每年 | 检查 Cloudflare Origin 证书（通常 15 年） |

### 更新命令

```bash
cd /opt/remote-control
sudo -u remotecontrol git pull
cd remote-control/server && sudo -u remotecontrol npm install
sudo systemctl restart remote-control-server
```

### 健康检查

```bash
curl -s https://rc.yourdomain.com/api/health
# {"status":"ok","service":"corp-analytics-gateway","version":"2.1.0"}
```

---

## 八、故障排查

| 现象 | 排查 |
|------|------|
| 502 | Node 未运行 / nginx 配置错误 |
| 525 | Origin 证书与 Full Strict 不匹配 |
| WS 失败 | CF WebSockets 未开；Gateway 用了 ws 而非 wss |
| PC2 连不上 | Token 不一致；域名 DNS 未生效 |
| 有连接无画面 | PC2 agent 未运行；viewer online 为 false |

---

## 九、推荐最终形态

```
域名:     analytics.yourdomain.com  (伪装)
SSL:      Cloudflare Full (Strict)
服务器:   nginx + Node systemd
PC2:      Windows NSSM 服务，wss 出站
PC1:      浏览器 https，无安装
Token:    openssl rand -base64 48，存 server.env
备份:     记录 Token、域名、服务器 IP 到密码管理器
```

按此方案部署后，可 7×24 稳定运行，服务器重启、进程崩溃均会自动恢复。
