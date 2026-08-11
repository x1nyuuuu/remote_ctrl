# 生产部署方案（无 Cloudflare）

适用：有域名、DNS 直接解析到服务器 IP，自行管理 TLS 证书。

---

## 架构

```
PC1 浏览器 ──HTTPS/WSS──► 你的服务器:443 ──► Node:8443(本地)
                              ▲
PC2 Agent ──────WSS 出站──────┘

DNS:  rc.yourdomain.com  A  →  服务器公网 IP（直连，无代理）
```

与 Cloudflare 方案的区别：

| 项目 | 无 Cloudflare | 有 Cloudflare |
|------|---------------|---------------|
| DNS | A 记录直连 IP | 橙色云代理 |
| 证书 | Let's Encrypt（免费） | Edge + Origin 双证书 |
| DDoS | 靠防火墙/服务商 | Cloudflare 吸收 |
| 配置 | 稍多，但更透明 | 更省心 |
| 延迟 | 少一跳，略低 | 多一跳 |

---

## 方案 A：Caddy（最推荐，自动 HTTPS）

Caddy 自动向 Let's Encrypt 申请并续期证书，适合长期运行。

### 1. DNS

在域名服务商添加：

| 类型 | 名称 | 值 |
|------|------|-----|
| A | `rc` | 服务器公网 IP |

**不要**走 Cloudflare 代理；若域名在 CF 上，用小灰云（DNS only）。

### 2. 安装

```bash
git clone -b cursor/remote-control-tool-5731 \
  https://github.com/x1nyuuuu/remote_ctrl.git /opt/remote-control

cd /opt/remote-control/remote-control/server
npm install

# 安装 Caddy (Ubuntu)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 3. Caddyfile

```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
rc.yourdomain.com {
    reverse_proxy 127.0.0.1:8443
}
EOF
# 把 rc.yourdomain.com 改成你的域名
```

### 4. Token + systemd

```bash
sudo mkdir -p /etc/remote-control
sudo tee /etc/remote-control/server.env <<EOF
TOKEN=$(openssl rand -base64 48)
HOST=127.0.0.1
PORT=8443
NODE_ENV=production
EOF
sudo chmod 600 /etc/remote-control/server.env
sudo cat /etc/remote-control/server.env   # 保存 Token

sudo cp /opt/remote-control/remote-control/deploy/remote-control-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now remote-control-server
sudo systemctl enable --now caddy
```

### 5. 防火墙

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp    # Let's Encrypt 验证
sudo ufw allow 443/tcp
sudo ufw enable
```

### 6. 使用

- PC1：`https://rc.yourdomain.com/console`
- Gateway：`wss://rc.yourdomain.com`
- PC2：`python agent.py --server wss://rc.yourdomain.com --token <Token>`

Caddy 会在证书到期前 **自动续期**，无需人工干预。

---

## 方案 B：nginx + Certbot（Let's Encrypt）

适合已熟悉 nginx 的场景。

### 1. 安装 certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

### 2. 先用 HTTP 启动 Node

```bash
# 同方案 A 的 server.env + systemd
sudo systemctl start remote-control-server
```

### 3. nginx 初始配置（仅 HTTP）

```nginx
server {
    listen 80;
    server_name rc.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

### 4. 申请证书（自动改 nginx 配置）

```bash
sudo certbot --nginx -d rc.yourdomain.com
```

按提示填写邮箱。Certbot 会：

- 申请 Let's Encrypt 证书
- 配置 HTTPS
- 添加自动续期 cron/systemd timer

### 5. 验证续期

```bash
sudo certbot renew --dry-run
```

---

## 方案 C：仅 IP、无域名（不推荐长期使用）

```bash
cd remote-control/server
bash gen-self-signed-cert.sh
SSL_CERT=cert.pem SSL_KEY=key.pem PORT=443 TOKEN=xxx node index.js
```

- PC1：`https://IP:443/console`（浏览器会警告，需手动信任）
- 证书需手动更换，**不适合长期生产**

---

## 安全加固（无 Cloudflare 时更重要）

### 1. 防火墙

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2. SSH

- 禁用密码登录，只用密钥
- 改默认 22 端口（可选）

### 3. fail2ban（防暴力扫描）

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

### 4. 限制控制台访问（nginx）

只允许公司 IP 访问 `/console`：

```nginx
location /console {
    allow 203.0.113.0/24;   # 公司 IP 段
    deny all;
    proxy_pass http://127.0.0.1:8443;
    # ... 其余 proxy 配置
}
```

### 5. 强 Token

```bash
openssl rand -base64 48
```

存 `/etc/remote-control/server.env`，权限 `600`。

---

## PC2 / PC1 配置（与 Cloudflare 方案相同）

**PC2 `agent.env`：**

```ini
RC_SERVER=wss://rc.yourdomain.com
RC_TOKEN=<与服务器相同>
RC_FPS=8
```

**PC1：**

- 地址：`https://rc.yourdomain.com/console`
- Gateway：`wss://rc.yourdomain.com`

---

## 运维

| 频率 | 事项 |
|------|------|
| 自动 | Caddy/Certbot 续期证书 |
| 每周 | `systemctl status remote-control-server caddy`（或 nginx） |
| 每月 | 系统 apt update && upgrade |
| 每季度 | 轮换 TOKEN |

健康检查：

```bash
curl -s https://rc.yourdomain.com/api/health
```

---

## 方案选择建议

| 场景 | 推荐 |
|------|------|
| 有域名，想要最省心 | **Caddy（方案 A）** |
| 已有 nginx 生态 | **nginx + Certbot（方案 B）** |
| 无域名 / 临时测试 | 自签名（方案 C） |
| 需要隐藏源站 IP / 防 DDoS | 仍建议 Cloudflare |

无 Cloudflare 时，**Caddy + systemd + Let's Encrypt** 即可达到长期稳定，证书自动续期，无需 Cloudflare 账户。
