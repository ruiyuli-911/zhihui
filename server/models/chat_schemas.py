"""
智慧小职 — 请求/响应数据模型
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
    type: str  # confirm / navigate / detail
    data: dict = {}


class ChatResponse(BaseModel):
    """Agent 聊天响应"""
    type: str  # text / job_list / job_detail / confirmation / result / error
    content: dict
    reply: str = ""  # 纯文本回复（供 TTS 播报用）
    actions: list[ActionButton] = []
