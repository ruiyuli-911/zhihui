# 智汇小玉 — AI Agent 改造实施方案

> **版本**：v1.0  
> **日期**：2026-07-03  
> **定位**：从"AI 聊天机器人"转型为"语音驱动的就业任务 Agent"  
> **演示截止**：2026-07-07  

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                     微信小程序（前端）                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AI 页面 (ai.wxml / ai.js)                                │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │  │
│  │  │ 文本气泡  │  │ 岗位卡片  │  │ 确认弹窗  │  │ 结果卡片   │ │  │
│  │  └─────────┘  └──────────┘  └──────────┘  └────────────┘ │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ wx.request HTTP                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                           ▼                                      │
│              ┌──────────────────────────────────────────────┐    │
│              │  Python FastAPI 服务器                         │    │
│              │  (LangChain Agent)                            │    │
│              │                                                │    │
│              │  ┌─────────────────────────────────────────┐  │    │
│              │  │ Agent 处理流程：                          │  │    │
│              │  │ 用户文本 → 意图识别 → 参数提取             │  │    │
│              │  │ → 工具调用 → 结果包装 → 结构化返回          │  │    │
│              │  └─────────────────────────────────────────┘  │    │
│              └───────────────────┬──────────────────────────┘    │
│                                  │                                │
│                                  ▼                                │
│              ┌──────────────────────────────────────────────┐    │
│              │  微信云开发 HTTP API                           │    │
│              │  (tcb.databasequery / databaseadd 等)        │    │
│              └───────────────────┬──────────────────────────┘    │
│                                  │                                │
│                                  ▼                                │
│              ┌──────────────────────────────────────────────┐    │
│              │  云数据库 (MongoDB-like)                      │    │
│              │  jobs / applications / users / jobseekers    │    │
│              └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 数据流

```text
用户语音 → WechatSI 语音识别 → 文字 → wx.request → Python FastAPI
  → LangChain Agent
    → 意图识别（找工/报名/查进度/问路线）
    → 参数提取（岗位、薪资、距离、福利）
    → 工具调用（search_jobs / apply_job / get_status）
      → 微信云 HTTP API → 云数据库
    → 结果结构化封装
  → 返回 JSON 给小程序
  → 前端渲染（文本气泡 / 岗位卡片 / 确认卡片 / 结果卡片）
```

### 1.2 技术选型

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | 微信小程序 + WechatSI | 现有资产，复用语音插件 |
| 后端 | Python 3.10+ / FastAPI / LangChain | 新增，部署在腾讯云轻量服务器或 CloudBase 云托管 |
| 模型 | DeepSeek API | 现有关联，继续复用 |
| 数据库 | 微信云开发 CloudBase | 现有资产，Python 通过 HTTP API 访问 |
| 语音 | 微信同声传译插件 (WechatSI) | 现有资产，已配置 |

---

## 二、后端文件结构（新建）

```
server/
├── app.py                          # FastAPI 应用入口
├── config.py                       # 配置管理（环境变量）
├── requirements.txt                # 依赖清单
│
├── agent/
│   ├── __init__.py
│   ├── employment_agent.py         # Agent 组装 + invoke
│   ├── tools.py                    # 6 个就业工具
│   └── prompts.py                  # 系统提示词 + 工具描述
│
├── services/
│   ├── __init__.py
│   ├── db_client.py                # 微信云数据库 HTTP 客户端
│   ├── asr_service.py              # 语音识别服务
│   └── tts_service.py              # 语音合成服务
│
├── models/
│   ├── __init__.py
│   ├── chat_schemas.py             # 请求/响应模型 (Pydantic)
│   └── job_schemas.py              # 岗位数据结构
│
└── demo/
    └── seed_data.py                # 测试数据填充脚本
```

---

## 三、分步实施计划

### 📅 Day 1 — 7月3日 | Python 后端 + LangChain Agent

| 文件 | 动作 | 产出 |
|------|------|------|
| `server/app.py` | 新建 | FastAPI 入口，CORS，`POST /api/agent/chat` 路由 |
| `server/config.py` | 新建 | 环境变量：APPID / SECRET / ENV_ID / DEEPSEEK_KEY |
| `server/agent/tools.py` | 新建 | 6 个 `@tool` 装饰器函数 |
| `server/agent/prompts.py` | 新建 | 就业 Agent 系统提示词 |
| `server/agent/employment_agent.py` | 新建 | LangChain Agent 组装 |
| `server/services/db_client.py` | 新建 | 云数据库 HTTP 查询/写入封装 |
| `server/models/chat_schemas.py` | 新建 | 请求/响应 Pydantic 模型 |
| `server/requirements.txt` | 新建 | fastapi, langchain, httpx, pydantic 等 |

#### 核心工具清单（tools.py）

```python
@tool
def search_jobs(
    keyword: str = "",
    city: str = "",
    district: str = "",
    min_salary: int = 0,
    max_salary: int = 0,
    distance_km: int = 10,
    provide_food: bool = False,
    provide_housing: bool = False,
    page: int = 1,
    page_size: int = 10
) -> list:
    """根据用户条件查询岗位列表。keyword是岗位名称关键词如保安/保洁/搬运工；city和district是地点；
    min_salary是最低工资；distance_km是距离范围；provide_food/provide_housing是否包吃住。"""

@tool
def get_job_detail(job_id: str) -> dict:
    """获取单个岗位的详细信息，包括公司介绍、岗位要求、福利待遇等。"""

@tool
def apply_job(job_id: str, user_id: str) -> dict:
    """为指定用户报名指定岗位。调用前必须先让用户确认。返回报名结果。"""

@tool
def get_application_status(user_id: str) -> list:
    """查询用户的所有报名记录和进度状态。"""

@tool
def get_user_profile(user_id: str) -> dict:
    """获取用户的个人资料（姓名、年龄、电话等），用于报名前检查资料完整性。"""

@tool
def get_navigation_info(address: str, user_lat: float, user_lng: float) -> dict:
    """获取从用户位置到岗位地点的导航路线信息。"""
```

#### 系统提示词核心（prompts.py）

```
你是智汇小玉，一个面向大龄劳动者的语音就业任务助手。

你的目标不是闲聊，而是帮助用户完成就业任务。

核心规则：
1. 优先调用岗位查询、报名、面试等业务工具，不要编造信息。
2. 用户说"找工作"→调用 search_jobs 并展示岗位列表。
3. 用户说"报名第X个"→先展示该岗位信息让用户确认，用户确认后才调用 apply_job。
4. 信息不完整时，一次只追问最重要的一项。
5. 回答必须简短、口语化、适合语音播报。
6. 不要编造岗位、薪资、企业或报名状态。
7. 用户查询完成后，询问是否需要进一步帮助。
```

#### app.py 骨架

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models.chat_schemas import ChatRequest, ChatResponse
from agent.employment_agent import EmploymentAgent

app = FastAPI(title="智汇小玉 - 就业服务 Agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

agent = EmploymentAgent()

@app.post("/api/agent/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    核心接口：接收用户消息 → Agent 处理 → 结构化返回
    """
    try:
        result = await agent.process(
            user_id=request.user_id,
            message=request.message,
            location=request.location,
            session_id=request.session_id
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "智汇小玉 Agent"}
```

---

### 📅 Day 2 — 7月4日 | 前端 AI 页面重构

#### 2.1 消息类型扩展

当前消息结构只支持纯文本，改造后支持 5 种类型：

| type | 含义 | 前端渲染 |
|------|------|---------|
| `text` | 普通文本 | 气泡 + 文字（现有样式） |
| `job_list` | 岗位推荐列表 | 岗位卡片列表 + 操作按钮 |
| `confirmation` | 确认弹窗 | 信息展示 + 确认/取消大按钮 |
| `result` | 操作结果 | 成功/失败状态 + 结果摘要 |
| `error` | 错误提示 | 红色警示条 + 重试建议 |

#### 2.2 核心改动文件

| 文件 | 动作 | 改动要点 |
|------|------|---------|
| `miniprogram/pages/c/ai/ai.wxml` | **重写** | 新增 job_list / confirmation / result 模板段 |
| `miniprogram/pages/c/ai/ai.js` | **重写** | 真实 API 调用 + 结构化消息解析 + 确认流 |
| `miniprogram/pages/c/ai/ai.wxss` | **重写** | 岗位卡片、确认弹窗、结果卡片样式 |
| `miniprogram/pages/c/ai/ai.json` | 微调 | 导航标题改为"智汇小玉" |

#### 2.3 WXML 模板段示例

```html
<!-- 岗位卡片列表 -->
<block wx:elif="{{item.type === 'job_list'}}">
  <view class="job-card-list">
    <view class="job-list-summary">{{item.content.summary}}</view>
    <view class="job-card-mini" wx:for="{{item.content.jobs}}" wx:key="job_id"
          data-job="{{item}}" bindtap="handleViewJob">
      <view class="job-card-mini__title">{{item.title}}</view>
      <view class="job-card-mini__salary">{{item.salary}}</view>
      <view class="job-card-mini__meta">{{item.distance}} · {{item.location}}</view>
      <view class="job-card-mini__tags">
        <text class="tag" wx:for="{{item.benefits}}">{{item}}</text>
      </view>
    </view>
    <!-- 快捷操作按钮 -->
    <view class="job-card-actions" wx:if="{{item.actions}}">
      <button class="action-btn" wx:for="{{item.actions}}" wx:key="text"
              data-action="{{item}}" bindtap="handleAction">
        {{item.text}}
      </button>
    </view>
  </view>
</block>

<!-- 确认卡片 -->
<block wx:elif="{{item.type === 'confirmation'}}">
  <view class="confirmation-card">
    <view class="confirmation-card__icon">❓</view>
    <view class="confirmation-card__text">{{item.content.prompt}}</view>
    <view class="confirmation-card__actions">
      <button class="btn-confirm" data-data="{{item.content.confirm_data}}"
              bindtap="handleConfirm">确认</button>
      <button class="btn-cancel" bindtap="handleCancel">取消</button>
    </view>
  </view>
</block>

<!-- 结果卡片 -->
<block wx:elif="{{item.type === 'result'}}">
  <view class="result-card result-card--{{item.content.status}}">
    <view class="result-card__icon">{{item.content.status === 'success' ? '✓' : '✗'}}</view>
    <view class="result-card__title">{{item.content.title}}</view>
    <view class="result-card__desc">{{item.content.description}}</view>
  </view>
</block>
```

#### 2.4 ai.js 核心改动

```javascript
// 替换 mock 回复为真实 API 调用
async sendMessage(text) {
  const userMessage = { id: ++this.msgId, role: 'user', type: 'text', content: text };
  this.setData({ inputText: '', loading: true, messages: [...this.data.messages, userMessage] });
  this.scrollToBottom();

  try {
    const reply = await wx.request({
      url: `${API_BASE}/api/agent/chat`,
      method: 'POST',
      data: {
        user_id: getApp().globalData.userId,
        session_id: this.data.sessionId,
        message: text,
        location: this.data.userLocation
      }
    });

    const assistantMsg = {
      id: ++this.msgId,
      role: 'assistant',
      type: reply.data.type,        // text / job_list / confirmation / result
      content: reply.data.content,
      actions: reply.data.actions || []
    };

    this.setData({
      loading: false,
      messages: [...this.data.messages, assistantMsg]
    });
  } catch (err) {
    // 错误处理
    this.setData({ loading: false });
    this.addErrorMessage('服务暂时不可用，请稍后再试');
  }
  this.scrollToBottom();
},

// 确认操作
handleConfirm(e) {
  const confirmData = e.currentTarget.dataset.data;
  // 向后端发送确认指令
  this.sendMessage(JSON.stringify({ action: 'confirm', ...confirmData }));
}
```

---

### 📅 Day 3 — 7月5日 | 语音集成 + 完整交互流

| 模块 | 动作 | 说明 |
|------|------|------|
| `miniprogram/utils/voice.js` | **重写** | 集成 WechatSI 真实语音识别 + 上传后端 |
| `server/services/asr_service.py` | 新建 | ASR 处理（可模拟） |
| `server/services/tts_service.py` | 新建 | TTS 播报 |
| `miniprogram/pages/c/ai/ai.js` | 新增方法 | 语音状态管理 + 报名确认三阶段流 |

#### 语音流程

```text
用户长按麦克风
  → 开始录音 (WechatSI)
  → 松开 → 停止录音
  → 获取识别文本
  → 展示"识别结果：帮我找附近保安工作"
  → 发送到 Agent API
  → 处理并返回结果
```

#### 确认三阶段流（核心亮点）

```
第一阶段 — 建议
用户："帮我报名第二个"
Agent 返回 confirmation 类型消息：
  "第二个岗位是高新区物业保安，月薪4500-5500元。确认报名吗？"

第二阶段 — 确认  
用户点击"确认" / 说"确认"
Agent 检查用户资料完整性：
  如果缺信息 → 追问（一次只问一项）
  "报名还需要您的年龄，请直接告诉我：我今年X岁"

第三阶段 — 执行
用户补充信息
Agent 调用 apply_job() → 返回结果卡片
  "报名成功！企业将在1个工作日内联系您。"
```

---

### 📅 Day 4 — 7月6日 | 整合联调 + 演示准备

| 任务 | 说明 |
|------|------|
| 端到端联调 | 语音 → 文字 → Agent → 工具 → 数据库 → 卡片渲染 |
| 错误处理 | 无结果提示、网络异常、LLM 超时降级 |
| 演示数据注入 | `demo/seed_data.py` 插入 10+ 条测试岗位数据 |
| 演示脚本 | 编写完整演示闭环（见第六节） |
| PowerPoint 更新 | 更新架构图、截屏、交互流程 |

---

## 四、核心接口设计

### 4.1 Agent 接口

```http
POST /api/agent/chat
```

**请求体**：

```json
{
  "user_id": "u001",
  "session_id": "s001",
  "message": "帮我找附近五公里内，工资四千以上的保安工作，最好包吃住",
  "location": {
    "latitude": 34.23,
    "longitude": 108.94
  }
}
```

**响应体**（岗位列表类型）：

```json
{
  "type": "job_list",
  "content": {
    "summary": "为您找到3份符合条件的保安工作",
    "jobs": [
      {
        "job_id": "J1001",
        "title": "小区保安",
        "company_name": "XX物业管理有限公司",
        "salary": "4200-5200元/月",
        "distance": "2.3公里",
        "location": "高新区科技路",
        "benefits": ["包住", "五险", "月休4天"]
      },
      {
        "job_id": "J1002",
        "title": "物流园区夜班保安",
        "company_name": "YY物流集团",
        "salary": "4500-5500元/月",
        "distance": "3.8公里",
        "location": "经开区物流大道",
        "benefits": ["包吃住", "五险", "月休2天"]
      }
    ]
  },
  "actions": [
    { "text": "报名第一个", "type": "apply", "data": { "job_id": "J1001" } },
    { "text": "报名第二个", "type": "apply", "data": { "job_id": "J1002" } },
    { "text": "查看详情", "type": "detail", "data": {} }
  ]
}
```

**响应体**（确认类型）：

```json
{
  "type": "confirmation",
  "content": {
    "prompt": "第二个岗位是物流园区夜班保安，月薪4500-5500元，包吃住。确定报名吗？",
    "confirm_data": {
      "action": "apply",
      "job_id": "J1002"
    }
  },
  "actions": [
    { "text": "确认报名", "type": "confirm", "data": { "job_id": "J1002" } },
    { "text": "再看看别的", "type": "cancel", "data": {} }
  ]
}
```

**响应体**（结果类型）：

```json
{
  "type": "result",
  "content": {
    "status": "success",
    "title": "报名成功！",
    "description": "已成功报名物流园区夜班保安。企业将在1个工作日内联系您。请保持手机畅通。"
  },
  "actions": [
    { "text": "查看我的报名", "type": "navigate", "data": { "url": "/pages/c/my-applications/my-applications" } }
  ]
}
```

---

## 五、前端改造要点

### 5.1 当前状态（改造前）

- `ai.wxml`：只有纯文本气泡（user + assistant）
- `ai.js`：`getMockReply()` 用 `if/else` 写死回复
- `ai.wxss`：只有文本气泡样式
- `voice.js`：只有关键词导航，无 ASR

### 5.2 改造后状态

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 消息类型 | 仅 text | text + job_list + confirmation + result + error |
| 回复逻辑 | 前端 if/else mock | 真实后端 Agent 调用 |
| 语音识别 | 前端本地关键词匹配 | WechatSI 真实 ASR → 后端理解 |
| 岗位操作 | 纯文本提示"已为你筛选" | 真实岗位卡片 + 一键报名 |
| 确认机制 | 无 | 三阶段：建议→确认→执行 |
| 数据源 | 写死字符串 | 实时云数据库 |

---

## 六、演示场景

### 6.1 主演示闭环（2分钟）

```text
Step 1: 用户长按说话
  "帮我找附近五公里内，工资四千以上的保安工作，最好包吃住"

Step 2: 系统展示语音识别文字 + 岗位卡片（3份）

Step 3: 用户点击/说 "第一个帮我报名"

Step 4: 系统展示确认卡片
  "第一个是高新区小区保安，月薪4200-5200元，包住有五险。确认报名吗？"

Step 5: 用户点击 "确认"

Step 6: 系统检测资料缺年龄，追问
  "报名还需要您的年龄，请直接告诉我：我今年X岁"

Step 7: 用户说 "我今年55岁"

Step 8: 系统执行报名 → 展示结果卡片
  "报名成功！企业将在1个工作日内联系您。"
```

### 6.2 备选演示场景

| 用户输入 | 系统响应 | 展示能力 |
|----------|---------|---------|
| "帮我看看有啥工作" | 岗位列表卡片 | 关键词提取 + 查询 |
| "查看我的报名状态" | 报名进度列表 | 数据库实时查询 |
| "这工作包住吗" | 岗位详情卡片 | 详情查询 + 信息提取 |
| "怎么去这个公司" | 导航信息卡片 | 路线/距离信息 |

---

## 七、配置与部署

### 7.1 环境变量

```bash
# 微信云开发配置
WX_APPID=wx你的AppId
WX_SECRET=你的AppSecret
WX_ENV_ID=你的云环境ID

# DeepSeek API
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions

# 服务配置
SERVER_PORT=8000
```

### 7.2 Python 依赖

```
fastapi==0.111.0
uvicorn==0.29.0
langchain==0.2.1
langchain-community==0.2.1
httpx==0.27.0
pydantic==2.7.1
python-dotenv==1.0.1
```

### 7.3 部署方式

| 环境 | 方案 | 说明 |
|------|------|------|
| 开发调试 | 本地 `uvicorn app:app --reload` | 微信开发者工具勾选"不校验合法域名" |
| 演示 | 腾讯云轻量服务器 / CloudBase 云托管 | 部署后配置域名白名单 |

---

## 八、风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| Python 服务器部署环境问题 | Agent 不可用 | ① 开发期用 localhost 调试 ② 准备 Mock 回退模式 |
| 微信云 HTTP API 鉴权失败 | 无法查数据库 | ① 先用本地 SQLite 模拟数据 ② 用 access_token 缓存机制 |
| LLM 调用超时/限流 | 用户等待时间过长 | ① 超时降级为预设回复 ② 前端 loading 状态优化 |
| 语音识别准确率不足 | 意图识别错误 | 前端展示识别文本，用户可语音纠正或文字编辑 |
| 7月7日时间紧张 | 功能做不完 | 优先核心闭环：文字→Agent→岗位查询→报名确认 |

---

## 九、已有资产复用清单

| 已有文件/模块 | 用途 | 改造方式 |
|-------------|------|---------|
| `cloudfunctions/job/index.js` | 岗位查询逻辑 | Python 端重写为 DB 查询，逻辑参考 |
| `cloudfunctions/apply/index.js` | 报名逻辑 | Python 端重写为 DB 写入，逻辑参考 |
| `miniprogram/utils/voice.js` | 语音封装 | 重写为 WechatSI 真实 ASR + 上传后端 |
| `miniprogram/components/job-card/` | 岗位卡片组件 | 在 AI 页面复用 |
| `miniprogram/app.json` | WechatSI 插件注册 | 无需改动 |
| `miniprogram/styles/theme.wxss` | 主题变量 | 保持配色一致 |
| `images/ui/截屏*.png` | 演示截图 | 更新为 Agent 改造后的截图 |

---

## 十、时间线总览

```
7/3 (Day 1)  ████████████░░░░░░░░░  Python后端+LangChain Agent
7/4 (Day 2)  ░░░░░░░░░░████████░░░  前端AI页面重构（消息类型）
7/5 (Day 3)  ░░░░░░░░░░░░░░░░█████  语音集成+确认流
7/6 (Day 4)  ░░░░░░░░░░░░░░░░░░░██  联调+演示准备
7/7 (演示)   完整闭环演示
```

**优先级策略**：Day1-2 确保核心链路（文字→Agent→岗位→报名）能跑通，Day3-4 增强体验（语音+确认+美化）。

---

*文档结束*
