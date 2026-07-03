# 智汇就业 — 项目文档

> 微信小程序 + 微信云开发
> 求职招聘平台，服务老年求职者与企业

---

## 目录

1. [项目架构](#1-项目架构)
2. [用户角色与流程](#2-用户角色与流程)
3. [数据库集合](#3-数据库集合)
4. [云函数清单](#4-云函数清单)
5. [页面路由](#5-页面路由)
6. [核心功能流程](#6-核心功能流程)
7. [关键特性](#7-关键特性)

## 最新文档

- [06-代码优化审核报告-上线检查清单](06-代码优化审核报告-上线检查清单.md) — 2026-07-03 全面代码审计与上线准备（含7项Critical安全修复）
- [07-部署前快速测试方案](07-部署前快速测试方案.md) — 2026-07-03 52项测试用例，覆盖核心闭环+并发+安全

---

## 1. 项目架构

```
zhihui-code/
├── cloudfunctions/        # 云函数（后端）
│   ├── account/          # 账号登录
│   ├── admin/            # 管理后台
│   ├── apply/            # 报名（待完善）
│   ├── audit/            # 审核（待完善）
│   ├── checkin/          # 签到（待完善）
│   ├── company/          # 企业端
│   ├── job/              # 岗位查询
│   ├── jobseeker/        # 求职者端
│   ├── notification/     # 通知（待完善）
│   ├── policy/           # 政策（待完善）
│   ├── stats/            # 统计（待完善）
│   ├── wage/             # 工资（待完善）
│   └── shared/           # 共享工具
├── miniprogram/           # 小程序前端
│   ├── pages/
│   │   ├── c/            # C端 — 求职者
│   │   ├── b/            # B端 — 企业
│   │   ├── g/            # G端 — 政府
│   │   └── admin/        # 管理后台
│   ├── components/       # 公共组件
│   └── utils/            # 工具库
├── docs/                  # 项目文档
└── scripts/               # 脚本工具
```

---

## 2. 用户角色与流程

### 角色体系

| 角色 | 标识 | 说明 |
|------|------|------|
| 求职者 | `jobseeker` | 浏览岗位、报名、签到、查工资 |
| 企业管理员 | `company_admin` | 发布岗位、管理招聘 |
| 平台管理员 | `platform_admin` | 审核岗位、导出数据、系统管理 |
| 政府管理员 | `gov_admin` | 查看数据、发布政策 |

### 用户使用流程

```
打开小程序
  → 登录页（手机号 + 验证码）
  → 首次使用 → 填写资料（姓名、身份证、照片等）
  → 进入首页
      ├── 浏览推荐岗位（热门排序）
      ├── 语音找工作
      ├── 快捷功能（报名、签到、工资）
      └── 我的
          ├── 完善资料
          ├── 进入企业端
          └── 退出登录
```

### 企业使用流程

```
我的 → 进入企业端
  ├── 岗位管理（查看/编辑/删除）
  ├── 发布岗位（填写表单 + 上传营业执照）
  └── 返回求职端
```

### 管理员审核流程

```
管理后台 → 岗位审核
  ├── 待审核tab → 查看证明材料 → 通过/驳回
  ├── 全部岗位tab → 标记热门/撤销发布
  └── 导出求职者信息（CSV/Excel）
```

---

## 3. 数据库集合

### `accounts` — 用户账号

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | 自动生成 |
| `openid` | String | 微信 openid |
| `phone` | String | 手机号 |
| `role` | String | 角色：jobseeker/company_admin/platform_admin |
| `name` | String | 姓名 |
| `status` | String | 状态：active/disabled |
| `createTime` | Date | 创建时间 |
| `updateTime` | Date | 更新时间 |

### `jobs` — 岗位

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | `{日期}-{岗位名}-{企业名}` |
| `companyId` | String | 关联 accounts._id |
| `companyName` | String | 企业名称 |
| `title` | String | 岗位名称 |
| `categoryName` | String | 工种分类 |
| `salaryMin/Max` | Number | 薪资范围 |
| `area` | String | 工作区域 |
| `address` | String | 详细地址 |
| `workHours` | String | 工时说明 |
| `requirement` | String | 岗位要求 |
| `description` | String | 岗位描述 |
| `foodCondition` | String | 食宿条件 |
| `peopleCount` | Number | 招聘人数 |
| `recruitStatus` | String | recruiting/full/paused/closed |
| `auditStatus` | String | pending/approved/rejected |
| `auditMsg` | String | 审核备注 |
| `isHot` | Boolean | 热门标记 |
| `applyCount` | Number | 报名人数（用于热门排序） |
| `viewCount` | Number | 浏览次数 |
| `certImages` | Array | 证明材料 fileID 列表 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |
| `publishedAt` | Date | 审核通过时间 |

### `jobseekers` — 求职者档案

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | `{日期}-{姓名}` |
| `accountId` | String | 关联 accounts._id |
| `name` | String | 姓名 |
| `phone` | String | 手机号 |
| `expectJob` | String | 期望工作 |
| `expectArea` | String | 期望区域 |
| `idNumber` | String | 身份证号 |
| `idCardAddress` | String | 身份证地址 |
| `idCardFront` | String | 身份证正面照 fileID |
| `idCardBack` | String | 身份证反面照 fileID |
| `isPoor` | Boolean | 是否贫困 |
| `poorDescription` | String | 贫困说明 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### `applications` — 报名记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `jobseekerId` | String | 关联 jobseekers._id |
| `jobId` | String | 关联 jobs._id |
| `status` | String | submitted/accepted/rejected/completed |

### `wage_statements` — 工资单

| 字段 | 类型 | 说明 |
|------|------|------|
| `jobseekerId` | String | 关联 jobseekers._id |
| `amount` | Number | 工资金额 |
| `status` | String | pending/confirmed/disputed |

### `checkins` — 签到记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `jobseekerId` | String | 关联 jobseekers._id |
| `applicationId` | String | 关联 applications._id |

### `policies` — 政策资讯

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 标题 |
| `content` | String | 内容 |

---

## 4. 云函数清单

| 云函数 | 主要动作 | 说明 |
|--------|---------|------|
| `account` | login, getProfile, updateProfile, getPhone | 用户登录、资料管理 |
| `jobseeker` | getHome, getProfile, updateProfile | 首页数据、求职者档案 |
| `company` | createJob, updateJob, deleteJob, getMyJobs, getMyJobDetail | 企业岗位管理 |
| `job` | getJobList, getHotJobs, getJobDetail, searchJobs | 岗位查询浏览 |
| `admin` | getPendingJobs, approveJob, rejectJob, toggleHot, getAllJobs, revokeJob, seedTestData, setupCollections, exportJobseekers | 管理后台 |
| `apply` | （待完善） | 报名 |
| `checkin` | （待完善） | 签到 |
| `wage` | （待完善） | 工资 |
| `policy` | （待完善） | 政策 |
| `notification` | （待完善） | 通知 |

---

## 5. 页面路由

### C端 — 求职者

| 页面 | 路径 | 说明 |
|------|------|------|
| 登录 | `/pages/c/login/login` | 手机号验证码登录，首屏 |
| 首页 | `/pages/c/home/home` | 推荐岗位、语音、快捷功能 |
| 岗位列表 | `/pages/c/jobs/jobs` | 分类筛选、排序、搜索 |
| 岗位详情 | `/pages/c/job-detail/job-detail` | 基本信息、报名入口 |
| 报名 | `/pages/c/apply/apply` | 报名确认 |
| 我的报名 | `/pages/c/my-applications/my-applications` | 报名记录 |
| 签到码 | `/pages/c/my-qrcode/my-qrcode` | 签到二维码 |
| 签到记录 | `/pages/c/checkins/checkins` | 签到历史 |
| 工资 | `/pages/c/wages/wages` | 工资列表 |
| 收藏 | `/pages/c/favorites/favorites` | 收藏岗位 |
| 我的 | `/pages/c/profile/profile` | 个人中心、完善资料、企业入口 |
| 完善资料 | `/pages/c/profile-edit/profile-edit` | 身份证、照片、贫困信息 |

### B端 — 企业

| 页面 | 路径 | 说明 |
|------|------|------|
| 企业首页 | `/pages/b/home/home` | 岗位管理、发布入口 |
| 岗位管理 | `/pages/b/jobs/jobs` | 查看/编辑/删除岗位 |
| 发布岗位 | `/pages/b/job-publish/job-publish` | 岗位表单 + 营业执照上传 |
| 企业登录 | `/pages/b/login/login` | 企业端登录 |

### 管理后台

| 页面 | 路径 | 说明 |
|------|------|------|
| 登录 | `/pages/admin/login/login` | 管理员登录 |
| 总览 | `/pages/admin/dashboard/dashboard` | 数据概览 |
| 岗位审核 | `/pages/admin/job-audit/job-audit` | 审核/撤销/标记热门 |

---

## 6. 核心功能流程

### 岗位发布与审核

```
企业发布岗位（填写信息 + 上传营业执照）
  → 存到 jobs 集合（auditStatus: pending）
  → 管理员审核（查看证明材料）
      ├── 通过 → 岗位出现在求职端（可按热门排序）
      └── 驳回 → 企业编辑后重新提交

管理员也可：
  ├── 标记热门（isHot: true）
  ├── 撤销发布（审核错了可纠正）
  └── 关闭招聘
```

### 热门排序规则

```
① isHot = true（管理员手动标记）优先展示
② 按 applyCount（报名人数）降序
③ 取前6条展示在首页
```

### 证明材料

```
企业：上传营业执照（发布岗位时）
个人：上传身份证（完善资料时）
管理员审核时可见图片预览
```

### 导出数据

```
管理员 → 导出求职者信息
  → 查询 jobseekers 全量数据
  → 生成 CSV（Excel可打开）
  → 存到云存储
  → 返回下载链接
```

---

## 7. 关键特性

### 老年人友好设计

- **大字体大按钮**：引导语22px，按钮56px高
- **高对比度**：白字绿底
- **语音输入**：支持语音填写信息
- **步骤简单**：登录只需3步（手机号 → 验证码 → 进入）

### 数据库 ID 标准化

所有集合的 `_id` 使用可读格式：
```
20260702-建筑小工-山阳建工集团
20260702-张师傅
```

### 云存储路径标准化

```
cert/{openid}_{timestamp}_{n}.jpg     — 证明材料
idcard/{timestamp}_front.jpg          — 身份证正面
idcard/{timestamp}_back.jpg           — 身份证反面
export/导出_求职者信息_{日期}.csv      — 导出文件
```
