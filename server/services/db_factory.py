"""
数据库客户端工厂
根据配置自动选择：云数据库 / Mock 本地数据
"""

import logging

from config import settings

logger = logging.getLogger(__name__)

# 全局实例
_db_instance = None


def get_db():
    """获取数据库客户端实例（自动选择云数据库或本地 Mock）"""
    global _db_instance

    if _db_instance is not None:
        return _db_instance

    # 检查是否配置了云数据库凭证
    if settings.WX_APPID and settings.WX_APPID != "你的AppId" and \
       settings.WX_SECRET and settings.WX_SECRET != "你的AppSecret" and \
       settings.WX_ENV_ID and settings.WX_ENV_ID != "你的云环境ID":
        from services.db_client import CloudDatabaseClient
        _db_instance = CloudDatabaseClient()
        logger.info("使用云数据库（环境: %s）", settings.WX_ENV_ID)
    else:
        from demo.mock_data import mock_db
        _db_instance = mock_db
        logger.info("云数据库未配置，使用空数据（不编造岗位）")

    return _db_instance
