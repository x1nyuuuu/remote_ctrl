#!/bin/bash
# 生成本地测试用自签名证书（有效期 365 天）
# 用法: bash gen-self-signed-cert.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost"

echo "Generated cert.pem and key.pem"
echo "Start with:"
echo "  SSL_CERT=cert.pem SSL_KEY=key.pem TOKEN=your-token node index.js"
