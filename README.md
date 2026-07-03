# 智汇就业

## 当前状态

当前仓库已经完成基础框架整理：

- 小程序页面全部接入统一页面骨架
- 云函数目录全部补齐标准入口
- 文本文件编码统一转向 UTF-8

## 本地检查

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\encoding-check.ps1
```

## 部署准备

1. 复制 `deploy.example.json` 为 `deploy.local.json`。
2. 把微信小程序后台下载的私钥文件放到项目根目录，或修改 `privateKeyPath` 指向真实路径。
3. 将 `deploy.local.json` 中的版本号、描述、环境配置改成你的实际值。

## 命令

```powershell
npm run encoding:check
npm run deploy:preview
npm run deploy:upload
```

## 微信开发者工具

1. 打开微信开发者工具。
2. 选择 `miniprogram/` 作为小程序目录。
3. 选择或配置云开发环境。
4. 右键 `cloudfunctions/` 下各函数目录并上传部署。

## 云环境

默认占位环境 ID 在 `miniprogram/utils/constants.js`：

```js
const DEFAULT_ENV_ID = 'zhihui-job-xxxxx'
```

部署前请替换为你的真实环境 ID。

## 当前阻塞项

仓库内已经具备部署脚本，但还不能直接上传正式版本，因为当前缺少微信小程序管理后台导出的私钥文件。这个文件属于本地敏感凭证，已经被 `.gitignore` 排除。

管理员设置

### 几个角色说明

| 角色       | 字段值             | 能干什么                   |
| ---------- | ------------------ | -------------------------- |
| 求职者     | `jobseeker`      | 看岗位、报名、签到、查工资 |
| 企业管理员 | `company_admin`  | 发布岗位、管理报名         |
| 平台管理员 | `platform_admin` | 审核岗位、导出数据         |
