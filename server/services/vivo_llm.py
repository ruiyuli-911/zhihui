"""
vivo AI 大模型客户端（异步，OpenAI 兼容接口）

使用 openai 官方 SDK（AsyncOpenAI）接入 vivo AI 平台。
每次请求携带唯一 request_id 用于排查。
"""

import uuid
import logging
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class VivoLLMError(Exception):
    """vivo AI 调用异常，携带 request_id 方便定位"""
    def __init__(self, message: str, request_id: str = ""):
        self.request_id = request_id
        super().__init__(f"[{request_id}] {message}")


class VivoLLMClient:
    """vivo AI 大模型客户端（异步）"""

    def __init__(self, settings):
        if not settings.VIVO_APP_KEY or settings.VIVO_APP_KEY == "你的AppKey":
            raise VivoLLMError("VIVO_APP_KEY 未配置，请检查 .env 文件")

        self.model = settings.VIVO_MODEL
        self.client = AsyncOpenAI(
            api_key=settings.VIVO_APP_KEY,
            base_url=settings.VIVO_BASE_URL,
            timeout=settings.VIVO_TIMEOUT,
            default_headers={
                "Content-Type": "application/json; charset=utf-8"
            }
        )

    async def chat(
        self,
        messages: list,
        temperature: float = 0.3,
        max_tokens: int = 1200,
    ) -> str:
        """
        调用 vivo AI 大模型（异步）。

        参数:
            messages: [{"role": "system"|"user"|"assistant", "content": "..."}, ...]
            temperature: 生成温度，默认 0.3
            max_tokens: 最大输出 token，默认 1200

        返回:
            模型回复文本

        异常:
            VivoLLMError: 携带 request_id 的可读异常
        """
        request_id = str(uuid.uuid4())

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort="minimal",
                stream=False,
                extra_query={
                    "request_id": request_id
                }
            )
        except Exception as e:
            err_msg = str(e)
            if "401" in err_msg:
                raise VivoLLMError("API 鉴权失败，请检查 VIVO_APP_KEY", request_id)
            if "429" in err_msg:
                raise VivoLLMError("请求过于频繁，请稍后重试", request_id)
            if "30001" in err_msg or "2003" in err_msg:
                raise VivoLLMError("AI 服务暂时不可用，请稍后重试", request_id)
            raise VivoLLMError(f"AI 服务调用失败: {err_msg[:80]}", request_id)

        if not response.choices:
            raise VivoLLMError("AI 服务返回为空", request_id)

        content = response.choices[0].message.content or ""
        return content
