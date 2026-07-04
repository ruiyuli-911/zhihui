"""
智汇小玉 — FastAPI 应用入口
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
    title="智汇小玉 - 就业服务 Agent",
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

# ── 编排器实例（懒加载） ──
from orchestrator.conversation_orchestrator import ConversationOrchestrator

_orchestrator: ConversationOrchestrator = None


def get_orchestrator() -> ConversationOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = ConversationOrchestrator()
    return _orchestrator


# ─── 路由 ─────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "智汇小玉 Agent",
        "version": "1.0.0",
    }


@app.post("/api/agent/chat", response_model=ChatResponse)
async def agent_chat(req: ChatRequest):
    """
    核心聊天接口（v2 编排器）

    接收用户消息 → ConversationOrchestrator 处理 → 结构化返回

    请求体:
        user_id: 用户标识（TODO: 改为从登录态解析）
        message: 用户输入的文本
        location: 可选，用户位置
        session_id: 可选，会话ID

    返回:
        type: text / job_list / apply_confirm / application_success / ...
        content: 具体数据
        reply: 纯文本回复
        actions: 操作按钮
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    try:
        orchestrator = get_orchestrator()
        result: ChatResponse = await orchestrator.process(
            user_id=req.user_id or "anonymous",
            message=req.message.strip(),
            location=req.location,
            session_id=req.session_id,
        )
        return result
    except Exception as e:
        logger.error("编排器处理失败: %s", e, exc_info=True)
        return ChatResponse(
            type="error",
            content={"text": "服务暂时不可用，请稍后再试。"},
            reply="抱歉，服务暂时不可用，请稍后再试。",
        )


@app.post("/api/agent/confirm")
async def agent_confirm(data: dict):
    """
    确认报名接口（兼容旧版本）

    TODO: 前端应该通过 chat 接口 + confirm_token 提交报名。
    当前只做兼容处理：根据 confirm_token 提交或使用旧逻辑。
    """
    user_id = data.get("user_id", "")
    job_id = data.get("job_id", "")
    confirm_token = data.get("confirm_token", "")

    if not user_id or not job_id:
        raise HTTPException(status_code=400, detail="缺少 user_id 或 job_id")

    orchestrator = get_orchestrator()

    # 如果有 confirm_token，走新流程
    if confirm_token:
        session = orchestrator._get_session(user_id, user_id)
        result = orchestrator._do_submit(user_id, session, confirm_token)
        return result

    # 没有 confirm_token → 旧兼容逻辑
    session = orchestrator._get_session(user_id, user_id)
    from agent.tools import get_job_detail
    job = get_job_detail.invoke({"job_id": job_id}).get("job")
    if job:
        session["pending_job"] = job
        session["state"] = "waiting_confirm"
    result = await orchestrator.process(user_id=user_id, message="确认", session_id=user_id)
    return result


# ─── 请求日志中间件 ──────────────────────────────────────

@app.middleware("http")
async def log_requests(request, call_next):
    import time
    import uuid
    rid = str(uuid.uuid4())[:8]
    start = time.time()
    response = await call_next(request)
    cost = time.time() - start
    logger.info("[%s] %s %s → %s (%.2fs)", rid, request.method, request.url.path, response.status_code, cost)
    return response


# ─── vivo AI 调试接口 ────────────────────────────────────

@app.post("/api/ai/vivo-test")
async def vivo_test(data: dict):
    """本地测试 vivo AI 大模型连通性"""
    message = data.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="message 不能为空")

    try:
        from config import settings
        from services.vivo_llm import VivoLLMClient
        client = VivoLLMClient(settings)
        messages = [
            {"role": "system", "content": "你是智汇小玉，一个面向大龄求职者的语音就业助手。"},
            {"role": "user", "content": message},
        ]
        reply = await client.chat(messages)
        return {"success": True, "provider": "vivo", "model": settings.VIVO_MODEL, "reply": reply}
    except Exception as e:
        return {"success": False, "message": str(e), "provider": "vivo"}


# ─── 启动 ─────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("[智汇小玉] Agent 服务启动中...")


@app.on_event("shutdown")
async def shutdown():
    logger.info("[智汇小玉] Agent 服务已停止")
