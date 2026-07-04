"""
智汇小玉 — 请求/响应数据模型

v2 架构：支持结构化响应，confirm_token，岗位卡片，脱敏信息。
"""

from typing import Any, Optional
from pydantic import BaseModel


class ChatRequest(BaseModel):
    """Agent 聊天请求"""
    user_id: str = ""
    session_id: str = ""
    message: str
    location: Optional[dict] = None


class ActionButton(BaseModel):
    """操作按钮"""
    text: str
    type: str  # confirm / navigate / detail / submit_application / cancel_application
    data: dict = {}


class ChatResponse(BaseModel):
    """
    Agent 聊天响应

    type 支持:
      text               — 纯文本
      job_list           — 岗位卡片列表（含推荐理由）
      job_detail         — 单个岗位详情
      apply_confirm      — 报名确认卡片（含 confirm_token）
      application_success — 报名成功
      profile_question   — 收集用户资料（一次只问一个字段）
      error              — 错误提示
    """
    type: str
    content: dict = {}
    reply: str = ""
    actions: list[ActionButton] = []
    state: str = ""  # 当前状态机状态，供前端参考


class VivoIntentResult(BaseModel):
    """vivo AI 意图识别结果（受约束 JSON）"""
    intent: str = "small_talk"
    slots: dict = {}
    confidence: float = 0.0


# 可用的 intent 白名单
VALID_INTENTS = {
    "small_talk", "greeting",
    "recommend_jobs", "search_jobs", "more_like_me",
    "apply_job_by_index", "apply_job_by_id",
    "confirm_application", "cancel_application",
    "favorite_job", "unfavorite_job",
    "check_application_status", "policy_query",
    "provide_info", "job_detail",
}
