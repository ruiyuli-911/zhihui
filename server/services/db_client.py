"""
微信云数据库 HTTP 客户端
通过微信云 HTTP API 访问云数据库，无需经过云函数中转

文档：https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-http-api/
"""

import time
import json
import logging
from typing import Any, Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)


class CloudDatabaseClient:
    """微信云数据库 HTTP 客户端"""

    def __init__(self):
        self._access_token: str = ""
        self._token_expires_at: int = 0
        self._http = httpx.Client(timeout=10.0)

    # ─── Token 管理 ────────────────────────────────────────

    def _get_access_token(self) -> str:
        """获取 access_token（自动缓存，过期刷新）"""
        now = int(time.time())

        if self._access_token and now < self._token_expires_at - 60:
            return self._access_token

        url = f"{settings.WX_API_BASE}/cgi-bin/token"
        params = {
            "grant_type": "client_credential",
            "appid": settings.WX_APPID,
            "secret": settings.WX_SECRET,
        }

        resp = self._http.get(url, params=params)
        data = resp.json()

        if "access_token" not in data:
            raise RuntimeError(f"获取 access_token 失败: {data}")

        self._access_token = data["access_token"]
        self._token_expires_at = now + data.get("expires_in", 7200)
        logger.info("access_token 已刷新，有效期 %s 秒", data.get("expires_in", 7200))
        return self._access_token

    def _request(self, action: str, query: str) -> dict:
        """执行云数据库操作"""
        token = self._get_access_token()
        url = f"{settings.WX_API_BASE}/tcb/{action}?access_token={token}"

        resp = self._http.post(url, json={
            "env": settings.WX_ENV_ID,
            "query": query,
        })
        data = resp.json()

        if data.get("errcode", 0) != 0:
            raise RuntimeError(f"数据库操作失败: {data}")

        return data

    # ─── 公开 API ──────────────────────────────────────────

    def query(self, collection: str, where: Optional[dict] = None,
              order_by: Optional[str] = None, order: str = "desc",
              skip: int = 0, limit: int = 20) -> list[dict]:
        """
        通用查询
        where: 查询条件，如 {"auditStatus": "approved", "recruitStatus": "recruiting"}
        order_by: 排序字段
        order: "asc" 或 "desc"
        """
        conditions = []
        if where:
            for key, value in where.items():
                conditions.append(f"{key}: {repr(value)}")

        cond_str = ", ".join(conditions) if conditions else ""

        order_str = ""
        if order_by:
            order_str = f".orderBy('{order_by}', '{order}')"

        query = (
            f"db.collection('{collection}')"
            f".where({{{cond_str}}})"
            f"{order_str}"
            f".skip({skip})"
            f".limit({limit})"
            f".get()"
        )

        result = self._request("databasequery", query)
        # 返回的 data 是 JSON 字符串列表
        raw_list = result.get("data", [])
        return [json.loads(item) if isinstance(item, str) else item for item in raw_list]

    def get(self, collection: str, doc_id: str) -> Optional[dict]:
        """获取单条记录"""
        query = f"db.collection('{collection}').doc('{doc_id}').get()"
        try:
            result = self._request("databasequery", query)
            raw_list = result.get("data", [])
            if not raw_list:
                return None
            item = raw_list[0]
            return json.loads(item) if isinstance(item, str) else item
        except Exception as e:
            logger.warning("获取文档失败: collection=%s, doc_id=%s, error=%s",
                           collection, doc_id, e)
            return None

    def add(self, collection: str, data: dict) -> str:
        """新增记录，返回 _id"""
        import json
        data_json = json.dumps(data, ensure_ascii=False)
        query = f"db.collection('{collection}').add({{data: {data_json}}})"
        result = self._request("databaseadd", query)
        return result.get("id_list", [""])[0]

    def update(self, collection: str, doc_id: str, data: dict) -> bool:
        """更新记录"""
        import json
        data_json = json.dumps(data, ensure_ascii=False)
        query = f"db.collection('{collection}').doc('{doc_id}').update({{data: {data_json}}})"
        result = self._request("databaseupdate", query)
        return result.get("modified", 0) > 0

    def count(self, collection: str, where: Optional[dict] = None) -> int:
        """统计记录数"""
        conditions = []
        if where:
            for key, value in where.items():
                conditions.append(f"{key}: {repr(value)}")

        cond_str = ", ".join(conditions) if conditions else ""
        query = f"db.collection('{collection}').where({{{cond_str}}}).count()"

        result = self._request("databasequery", query)
        raw_list = result.get("data", [])
        if raw_list:
            item = raw_list[0]
            item = json.loads(item) if isinstance(item, str) else item
            return item.get("total", 0)
        return 0


# 全局单例
db = CloudDatabaseClient()
