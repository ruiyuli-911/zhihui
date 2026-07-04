# 智汇小玉 — 部署指南

## 推荐配置

| 项目 | 规格 |
|------|------|
| 服务器 | 阿里云 / 腾讯云 轻量应用服务器 |
| 配置 | 2核4G（最低 2核2G） |
| 系统 | Ubuntu 22.04 LTS |
| 域名 | 1个（用于 HTTPS） |
| 费用 | 约 ¥50-100/月 |

---

## 第一步：购买服务器

推荐新手用 **轻量应用服务器**：

- 阿里云：搜索"轻量应用服务器"，Ubuntu 22.04
- 腾讯云：搜索"轻量应用服务器"，Ubuntu 22.04

购买后记下 **公网 IP**。

---

## 第二步：配置域名（可选但推荐）

1. 买域名（阿里云/腾讯云/Namesilo 等）
2. 添加 A 记录，指向服务器公网 IP
3. 等待 DNS 生效（几分钟到几小时）

---

## 第三步：部署后端

登录服务器（用 SSH）：

```bash
# Windows 用 PowerShell 或 Git Bash 执行
ssh root@你的服务器IP
```

把项目上传到服务器：

```bash
# 在服务器上执行
cd /opt
git clone https://github.com/ruiyuli-911/zhihui.git
cd zhihui/deploy
chmod +x *.sh

# 运行初始化脚本
./setup-server.sh
```

初始化脚本会自动安装 Python、Nginx、项目依赖等。

---

## 第四步：配置环境变量

```bash
nano /opt/zhihui/server/.env
```

把 `VIVO_APP_KEY` 填上你的 AppKey。

---

## 第五步：配置 HTTPS

```bash
# 如果你有域名
./setup-nginx.sh your-domain.com

# 如果没有域名，用 IP 直连（只能用 HTTP）
# 只需要启动后端服务：
systemctl start zhihui
```

---

## 第六步：启动服务

```bash
systemctl start zhihui
systemctl status zhihui  # 确认运行正常

# 测试
curl http://127.0.0.1:8000/api/health
# 返回 {"status":"ok","service":"智汇小玉 Agent","version":"1.0.0"}
```

---

## 第七步：修改小程序配置

[app.js](../miniprogram/app.js) 中修改 `API_BASE`：

```javascript
// 开发时用局域网 IP
API_BASE: 'http://192.168.x.x:8002'

// 上线后改成你的域名
API_BASE: 'https://your-domain.com'
```

然后在微信小程序后台：
1. 开发管理 → 开发设置 → 服务器域名
2. 添加 `https://your-domain.com`
3. 上传小程序代码

---

## 常用命令

```bash
# 查看日志
journalctl -u zhihui -f

# 重启服务
systemctl restart zhihui

# 更新代码
cd /opt/zhihui
git pull
systemctl restart zhihui

# 查看 Nginx 日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```
