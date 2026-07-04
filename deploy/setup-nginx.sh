#!/bin/bash
# ============================================================
# 智汇小玉 — Nginx + HTTPS 配置脚本
# 用法： ./setup-nginx.sh your-domain.com
# ============================================================
set -e

DOMAIN=$1
if [ -z "$DOMAIN" ]; then
    echo "用法： ./setup-nginx.sh your-domain.com"
    exit 1
fi

echo "===== 配置 Nginx ====="
cat > /etc/nginx/sites-available/zhihui << 'NGINXEOF'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static {
        alias /opt/zhihui/server/static;
        expires 30d;
    }
}
NGINXEOF

sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/sites-available/zhihui

ln -sf /etc/nginx/sites-available/zhihui /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "===== 配置 HTTPS（Let's Encrypt）====="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@"$DOMAIN" || {
    echo ""
    echo "HTTPS 配置失败，常见原因："
    echo "  1. 域名 DNS 还没指向本机 IP"
    echo "  2. 端口 80 未开放"
    echo "  3. 请手动运行： certbot --nginx -d $DOMAIN"
    echo ""
}

echo "===== 重启 Nginx ====="
systemctl restart nginx

echo ""
echo "====== HTTPS 配置完成 ======"
echo "  服务地址： https://$DOMAIN"
echo "  测试： curl https://$DOMAIN/api/health"
echo ""
