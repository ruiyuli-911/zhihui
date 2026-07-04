#!/bin/bash
# ============================================================
# 智汇小玉 — 服务器初始化脚本（Ubuntu 22.04）
# ============================================================
set -e

echo "===== 1. 更新系统 ====="
apt update && apt upgrade -y

echo "===== 2. 安装依赖 ====="
apt install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx git

echo "===== 3. 克隆项目 ====="
cd /opt
git clone https://github.com/ruiyuli-911/zhihui.git
cd zhihui/server

echo "===== 4. 创建虚拟环境 ====="
python3 -m venv venv
source venv/bin/activate

echo "===== 5. 安装 Python 依赖 ====="
pip install -r requirements.txt
pip install gunicorn uvicorn

echo "===== 6. 创建 .env 文件 ====="
cat > .env << 'ENVEOF'
# 微信云开发配置
WX_APPID=wxbbc7edf7ce254861
WX_SECRET=470e2dc706ad7a8d7d676390711cab2c
WX_ENV_ID=cloud1-7gukagm3a064dc47

# vivo AI 大模型
LLM_PROVIDER=vivo
VIVO_APP_KEY=你的AppKey
VIVO_BASE_URL=https://api-ai.vivo.com.cn/v1
VIVO_MODEL=Volc-DeepSeek-V3.2
VIVO_TIMEOUT=15

# 服务端口
SERVER_PORT=8000
ENVEOF

echo "===== 7. 创建 systemd 服务 ====="
cat > /etc/systemd/system/zhihui.service << 'SERVICEEOF'
[Unit]
Description=智汇小玉 API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/zhihui/server
Environment=PATH=/opt/zhihui/server/venv/bin:/usr/bin
ExecStart=/opt/zhihui/server/venv/bin/gunicorn -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable zhihui

echo ""
echo "====== 安装完成 ======"
echo ""
echo "下一步："
echo "  1. 编辑 /opt/zhihui/server/.env 填写 VIVO_APP_KEY"
echo "  2. 配置域名 DNS 指向本机 IP"
echo "  3. 运行配置 HTTPS： ./setup-nginx.sh your-domain.com"
echo "  4. 启动服务： systemctl start zhihui"
echo ""
