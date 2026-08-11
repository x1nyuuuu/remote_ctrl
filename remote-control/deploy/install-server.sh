#!/bin/bash
# 生产环境服务器一键安装脚本 (Ubuntu/Debian)
# 用法: sudo bash install-server.sh

set -euo pipefail

INSTALL_ROOT="/opt/remote-control"
RC_USER="remotecontrol"
ENV_DIR="/etc/remote-control"
SSL_DIR="/etc/ssl/cloudflare"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> [1/8] 安装依赖"
apt-get update -qq
apt-get install -y -qq curl git nginx openssl

if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> [2/8] 创建系统用户"
id "$RC_USER" &>/dev/null || useradd --system --home "$INSTALL_ROOT" --shell /usr/sbin/nologin "$RC_USER"

echo "==> [3/8] 部署代码"
mkdir -p "$INSTALL_ROOT"
if [[ -d "$INSTALL_ROOT/.git" ]]; then
  cd "$INSTALL_ROOT" && git pull
else
  cp -a "$(cd "$PROJECT_ROOT/.." && pwd)" "$INSTALL_ROOT"
  chown -R "$RC_USER:$RC_USER" "$INSTALL_ROOT"
fi

echo "==> [4/8] 安装 Node 依赖"
cd "$INSTALL_ROOT/remote-control/server"
sudo -u "$RC_USER" npm install --omit=dev

echo "==> [5/8] 配置环境"
mkdir -p "$ENV_DIR" "$SSL_DIR"
if [[ ! -f "$ENV_DIR/server.env" ]]; then
  TOKEN=$(openssl rand -base64 48)
  cat > "$ENV_DIR/server.env" <<EOF
TOKEN=$TOKEN
HOST=127.0.0.1
PORT=8443
NODE_ENV=production
EOF
  chmod 600 "$ENV_DIR/server.env"
  echo "    已生成 Token 写入 $ENV_DIR/server.env"
  echo "    *** 请保存此 Token，PC1/PC2 需要使用 ***"
  grep TOKEN "$ENV_DIR/server.env"
else
  echo "    保留已有 $ENV_DIR/server.env"
fi

if [[ ! -f "$SSL_DIR/origin.pem" ]]; then
  echo "    [!] 请将 Cloudflare Origin 证书放到:"
  echo "        $SSL_DIR/origin.pem"
  echo "        $SSL_DIR/origin-key.pem"
  echo "    然后重新运行: sudo nginx -t && sudo systemctl reload nginx"
fi

echo "==> [6/8] 配置 nginx"
cp "$SCRIPT_DIR/nginx.conf" /etc/nginx/sites-available/remote-control
ln -sf /etc/nginx/sites-available/remote-control /etc/nginx/sites-enabled/remote-control
rm -f /etc/nginx/sites-enabled/default

echo "==> [7/8] 配置 systemd"
cp "$SCRIPT_DIR/remote-control-server.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable remote-control-server
systemctl restart remote-control-server

echo "==> [8/8] 启动 nginx"
nginx -t
systemctl enable nginx
systemctl reload nginx

echo ""
echo "============================================"
echo " 安装完成"
echo "============================================"
echo "1. 编辑 nginx 域名: /etc/nginx/sites-available/remote-control"
echo "2. 放入 Cloudflare Origin 证书到 $SSL_DIR/"
echo "3. Cloudflare SSL 模式: Full (strict)"
echo "4. Token 查看: sudo cat $ENV_DIR/server.env"
echo "5. 健康检查: curl https://你的域名/api/health"
echo "6. 控制台:     https://你的域名/console"
echo "============================================"
