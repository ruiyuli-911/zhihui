"""
用户行为服务

记录和查询用户行为事件（浏览、收藏、隐藏、不喜欢等）。
为推荐排序提供行为画像数据。

事件类型：
  impression   — 展示（用户看到了岗位卡片）
  view         — 查看详情
  favorite     — 收藏
  unfavorite   — 取消收藏
  apply        — 报名
  hide         — 隐藏（不感兴趣）
  dislike      — 不喜欢某类岗位

表：job_events（通用事件表）
表：job_favorites（收藏专用，方便快速查询）
"""

import logging
from datetime import datetime
from typing import Optional

from services.db_factory import get_db

logger = logging.getLogger(__name__)
db = get_db()


def record_event(account_id: str, job_id: str, event_type: str, metadata: dict = None):
    """记录用户行为事件"""
    event = {
        "accountId": account_id,
        "jobId": job_id,
        "eventType": event_type,
        "metadata": metadata or {},
        "createdAt": datetime.now().isoformat(),
    }
    try:
        db.add("job_events", event)
    except Exception as e:
        logger.warning("记录事件失败: %s", e)


def record_view(account_id: str, job_id: str):
    """记录浏览（如果已存在则更新浏览次数和最后时间）"""
    existing = db.query("job_events", where={
        "accountId": account_id, "jobId": job_id, "eventType": "view"
    }, limit=1)
    if existing:
        try:
            db.update("job_events", existing[0]["_id"], {
                "viewCount": (existing[0].get("viewCount", 0) or 0) + 1,
                "lastViewedAt": datetime.now().isoformat(),
            })
        except Exception as e:
            logger.warning("更新浏览记录失败: %s", e)
    else:
        record_event(account_id, job_id, "view", {"viewCount": 1})


def toggle_favorite(account_id: str, job_id: str, job_title: str = "", job_type: str = "") -> dict:
    """切换收藏状态。已收藏则取消，未收藏则添加。"""
    existing = db.query("job_favorites", where={
        "accountId": account_id, "jobId": job_id
    }, limit=1)
    if existing:
        try:
            db.update("job_favorites", existing[0]["_id"], {"cancelled": True, "cancelledAt": datetime.now().isoformat()})
            record_event(account_id, job_id, "unfavorite")
            return {"favorited": False}
        except Exception as e:
            logger.warning("取消收藏失败: %s", e)
            return {"favorited": True, "error": str(e)}
    else:
        fav = {
            "accountId": account_id,
            "jobId": job_id,
            "jobTitle": job_title,
            "jobType": job_type,
            "cancelled": False,
            "createdAt": datetime.now().isoformat(),
        }
        try:
            db.add("job_favorites", fav)
            record_event(account_id, job_id, "favorite")
            return {"favorited": True}
        except Exception as e:
            logger.warning("收藏失败: %s", e)
            return {"favorited": False, "error": str(e)}


def get_favorite_job_ids(account_id: str) -> list:
    """获取用户收藏的岗位ID列表"""
    favs = db.query("job_favorites", where={"accountId": account_id, "cancelled": False}, limit=100)
    return [f.get("jobId") for f in favs if f.get("jobId")]


def get_behavior_profile(account_id: str) -> dict:
    """
    获取用户行为画像（用于推荐排序）。
    返回：
      favorite_tags  — 收藏岗位的分类标签
      viewed_tags    — 浏览岗位的分类标签
      disliked_tags  — 不喜欢的分类标签
      applied_ids    — 已报名的岗位ID
    """
    # 收藏的岗位
    favs = db.query("job_favorites", where={"accountId": account_id, "cancelled": False}, limit=100)
    favorite_tags = list(set(f.get("jobType", "") for f in favs if f.get("jobType")))

    # 浏览事件
    views = db.query("job_events", where={"accountId": account_id, "eventType": "view"}, limit=200)
    viewed_tags = list(set(v.get("metadata", {}).get("jobType", "") for v in views if v.get("metadata", {}).get("jobType")))

    # 不喜欢
    dislikes = db.query("job_events", where={"accountId": account_id, "eventType": "dislike"}, limit=50)
    disliked_tags = list(set(d.get("metadata", {}).get("tag", "") for d in dislikes if d.get("metadata", {}).get("tag")))

    # 已报名
    apps = db.query("applications", where={"jobseekerId": account_id}, limit=100)
    applied_ids = list(set(a.get("jobId") for a in apps if a.get("jobId") and a.get("status") in ("submitted", "accepted", "completed")))

    return {
        "favorite_tags": favorite_tags,
        "viewed_tags": viewed_tags,
        "disliked_tags": disliked_tags,
        "applied_ids": applied_ids,
    }
