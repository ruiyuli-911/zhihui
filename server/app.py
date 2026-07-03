"""
智慧小职 — FastAPI 应用入口
语音驱动的就业任务 Agent 后端服务
"""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models.chat_schemas import ChatRequest, ChatResponse

# ── 日志 ──
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="智慧小职 - 就业服务 Agent",
    description="面向大龄劳动者的语音就业任务助手。用户通过语音完成岗位查询、报名、面试安排等服务。",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Agent 实例（懒加载） ──
from agent.employment_agent import get_agent as _get_agent


def get_agent():
    agent = _get_agent()
    return agent


# ─── 路由 ─────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "智慧小职 Agent",
        "version": "1.0.0",
    }


@app.post("/api/agent/chat", response_model=ChatResponse)
async def agent_chat(req: ChatRequest):
    """
    核心聊天接口

    接收用户消息 → LangChain Agent 处理（意图识别+工具调用） → 结构化返回

    请求体:
        user_id: 用户标识
        message: 用户输入的文本
        location: 可选，用户位置 {latitude, longitude}
        session_id: 可选，会话ID

    返回:
        type: text / job_list / job_detail / confirmation / result / error
        content: 具体数据
        reply: 纯文本回复（TTS 播报用）
        actions: 操作按钮列表
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    try:
        agent = get_agent()
        result: ChatResponse = agent.process(
            user_id=req.user_id or "anonymous",
            message=req.message.strip(),
            location=req.location,
            session_id=req.session_id,
        )
        return result
    except Exception as e:
        logger.error("Agent 处理失败: %s", e, exc_info=True)
        return ChatResponse(
            type="error",
            content={"text": "服务暂时不可用，请稍后再试。"},
            reply="抱歉，服务暂时不可用，请稍后再试。",
        )


@app.post("/api/agent/confirm")
async def agent_confirm(data: dict):
    """
    确认报名接口

    前端用户点击"确认报名"按钮时调用此接口，替代文本确认。

    请求体:
        user_id: 用户标识
        job_id: 岗位ID
    """
    user_id = data.get("user_id", "")
    job_id = data.get("job_id", "")

    if not user_id or not job_id:
        raise HTTPException(status_code=400, detail="缺少 user_id 或 job_id")

    agent = get_agent()
    agent.set_pending_apply(user_id, job_id)

    # 触发确认处理（模拟用户说了"确认"）
    confirm_result = agent.process(
        user_id=user_id,
        message="确认报名",
    )
    return confirm_result


# ─── 启动 ─────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("[智慧小职] Agent 服务启动中...")


@app.on_event("shutdown")
async def shutdown():
    logger.info("[智慧小职] Agent 服务已停止")
