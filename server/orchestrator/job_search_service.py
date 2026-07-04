"""
岗位搜索服务

职责：
- 按条件搜索岗位（关键词、城市、薪资）
- 年龄条件筛选（min_age / max_age）
- 排除已报名岗位
- 返回岗位卡片 + 符合/不符合年龄标记
"""

import logging
from datetime import datetime
from typing import Optional

from services.db_factory import get_db
from agent.tools import _build_job_card

logger = logging.getLogger(__name__)
db = get_db()


def search_eligible_jobs(
    keyword: str = "",
    city: str = "",
    district: str = "",
    min_salary: int = 0,
    age: Optional[int] = None,
    exclude_job_ids: list = None,
    page: int = 1,
    page_size: int = 20,
) -> list:
    """
    搜索符合条件（含年龄）的岗位。

    参数:
      age: 用户年龄，用于筛选 min_age / max_age
      exclude_job_ids: 需要排除的岗位ID列表（已报名、已展示）
      min_salary: 最低薪资
    """
    where = {
        "auditStatus": "approved",
        "recruitStatus": "recruiting",
    }

    if district:
        where["area"] = district

    try:
        jobs_raw = db.query("jobs", where=where, limit=page_size * 2,
                            skip=(page - 1) * page_size,
                            order_by="createdAt", order="desc")
    except Exception as e:
        logger.error("数据库查询失败: %s", e)
        return []

    exclude = set(exclude_job_ids or [])
    result = []

    for j in jobs_raw:
        if j.get("_id") in exclude:
            continue

        # 关键词模糊匹配
        if keyword:
            kw_lower = keyword.lower()
            title = (j.get("title") or "").lower()
            company = (j.get("companyName") or "").lower()
            category = (j.get("categoryName") or "").lower()
            if kw_lower not in title and kw_lower not in company and kw_lower not in category:
                continue

        # 薪资过滤
        if min_salary > 0:
            s_min = j.get("salaryMin") or 0
            if s_min < min_salary:
                continue

        # 年龄条件检查
        min_age = j.get("min_age") or j.get("minAge")
        max_age = j.get("max_age") or j.get("maxAge")
        age_eligible = True
        age_reason = ""

        if age is not None:
            if min_age is not None and age < min_age:
                age_eligible = False
                age_reason = f"要求最低{min_age}岁"
            if max_age is not None and age > max_age:
                age_eligible = False
                age_reason = f"要求最高{max_age}岁"

        # 年龄不符合则跳过（除非数据库没有该字段，null=不限）
        # 注意：min_age/max_age 为 null 表示无年龄限制
        if age is not None and min_age is not None and age < min_age:
            continue
        if age is not None and max_age is not None and age > max_age:
            continue

        card = _build_job_card(j)
        card["min_age"] = min_age
        card["max_age"] = max_age
        card["age_eligible"] = age_eligible
        card["age_reason"] = age_reason
        result.append(card)

    return result
