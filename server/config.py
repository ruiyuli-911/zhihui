"""
智汇小玉 — 全局配置
从环境变量或 .env 文件加载配置
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # 微信云开发
    WX_APPID: str = os.getenv("WX_APPID", "")
    WX_SECRET: str = os.getenv("WX_SECRET", "")
    WX_ENV_ID: str = os.getenv("WX_ENV_ID", "")

    # vivo AI 大模型
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "vivo")
    VIVO_APP_KEY: str = os.getenv("VIVO_APP_KEY", "")
    VIVO_BASE_URL: str = os.getenv("VIVO_BASE_URL", "https://api-ai.vivo.com.cn/v1")
    VIVO_MODEL: str = os.getenv("VIVO_MODEL", "Volc-DeepSeek-V3.2")
    VIVO_TIMEOUT: int = int(os.getenv("VIVO_TIMEOUT", "15"))

    # 服务
    SERVER_PORT: int = int(os.getenv("SERVER_PORT", "8000"))

    # 微信云 HTTP API 基础地址
    WX_API_BASE: str = "https://api.weixin.qq.com"

    # Access token 缓存
    ACCESS_TOKEN: str = ""
    TOKEN_EXPIRES_AT: int = 0


settings = Settings()
