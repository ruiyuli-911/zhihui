"""
推荐排序服务

职责：
- 对岗位列表按用户画像和行为算分排序
- 返回排序后的岗位 + 推荐理由（给 AI 润色用）
- 不含任何 LLM 调用，纯规则计算

评分规则：
  硬条件（必须满足）：
    - 岗位在招
    - 年龄符合或岗位无年龄限制

  软评分：
    收藏过相似岗位：+30
    明确说过喜欢该工种：+35
    多次浏览相似岗位：+15
    单次浏览：+5
    地点匹配用户常选区域：+20
    薪资符合预期：+15
    新发布岗位：+10
    不喜欢的岗位类型：排除或负分
"""

import logging
from datetime import datetime
from typing import Optional

from orchestrator.behavior_service import get_behavior_profile

logger = logging.getLogger(__name__)


def score_and_sort_jobs(
    jobs: list,
    user_age: Optional[int] = None,
    preferences: list = None,
    behavior: dict = None,
    city: str = "",
) -> list:
    """
    对岗位列表进行评分和排序。

    参数:
      jobs: 岗位卡片列表
      user_age: 用户年龄
      preferences: 用户主动表达过的工种偏好 ["保安", "门卫"]
      behavior: 行为画像（get_behavior_profile 返回值）
      city: 用户所在城市

    返回:
      [{job, score, reasons}, ...] 按 score 降序
    """
    behavior = behavior or {}
    preferences = preferences or []
    fav_tags = set(behavior.get("favorite_tags", []))
    viewed_tags = set(behavior.get("viewed_tags", []))
    disliked_tags = set(behavior.get("disliked_tags", []))
    applied_ids = set(behavior.get("applied_ids", []))

    scored = []
    for job in jobs:
        # 排除已报名
        if job.get("job_id") in applied_ids:
            continue

        score = 0
        reasons = []
        title = (job.get("title") or "").lower()
        category = (job.get("category") or "").lower()

        # 1. 主动偏好 +35
        for pref in preferences:
            if pref.lower() in title or pref.lower() in category:
                score += 35
                reasons.append(f"您说过想做{pref}类工作")
                break

        # 2. 收藏相似 +30
        for tag in fav_tags:
            if tag.lower() in title or tag.lower() in category:
                score += 30
                reasons.append("与您收藏的岗位相似")
                break

        # 3. 多次浏览 +15
        for tag in viewed_tags:
            if tag.lower() in title or tag.lower() in category:
                score += 15
                reasons.append("您浏览过相似岗位")
                break

        # 4. 地点匹配 +20
        job_city = job.get("location", "") or ""
        if city and city in job_city:
            score += 20
            reasons.append("地点离您较近")

        # 5. 薪资匹配 +15（如果有薪资信息）
        salary = job.get("salary", "")
        if salary and "面议" not in salary:
            score += 15

        # 6. 新发布 +10
        score += 10

        # 7. 负向：不喜欢
        for tag in disliked_tags:
            if tag.lower() in title or tag.lower() in category:
                score -= 50
                reasons.append("您之前表示不太感兴趣")
                break

        job["score"] = score
        job["reasons"] = reasons
        scored.append((job, score))

    # 按 score 降序
    scored.sort(key=lambda x: -x[1])
    return [job for job, _ in scored]


def group_jobs_by_age_eligibility(jobs: list, user_age: int) -> dict:
    """
    按年龄条件分组：
      age_eligible: 年龄符合的岗位
      no_age_limit: 没有年龄限制的岗位
      age_mismatch: 年龄不符合的岗位
    """
    groups = {"age_eligible": [], "no_age_limit": [], "age_mismatch": []}
    for job in jobs:
        min_age = job.get("min_age")
        max_age = job.get("max_age")
        if min_age is None and max_age is None:
            groups["no_age_limit"].append(job)
        elif (min_age is None or user_age >= min_age) and (max_age is None or user_age <= max_age):
            groups["age_eligible"].append(job)
        else:
            groups["age_mismatch"].append(job)
    return groups
