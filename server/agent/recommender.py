"""
智汇小玉 — 岗位推荐引擎

三层推荐策略：
  第一层：完全匹配 → 直接推荐
  第二层：相近岗位 → 扩展工种同义词后匹配
  第三层：放宽条件 → 提示用户放宽条件

岗位评分基于：年龄匹配度、工作环境、工种接近度、距离、稳定性
"""

import logging
from typing import Optional

from agent.tools import search_jobs, get_job_detail
from agent.query_expander import expand_preferences

logger = logging.getLogger(__name__)


def recommend(profile: dict) -> dict:
    """
    根据用户画像推荐岗位。

    返回:
        {
            "layer": 1|2|3,      # 命中哪一层
            "jobs": [...],        # 岗位列表（已排序）
            "summary": str,       # 推荐说明
            "reason": str,        # 推荐理由
            "next_hint": str,     # 后续提示
        }
    """
    age = profile.get("age")
    preferences = profile.get("job_preferences", [])
    environment = profile.get("work_environment")

    # ── 第一层：完全匹配 ──
    if preferences:
        for pref in preferences:
            result = search_jobs.invoke({"keyword": pref, "min_salary": 0})
            if result.get("jobs"):
                jobs = _score_and_sort(result["jobs"], profile)
                if jobs:
                    return _build_result(1, jobs, profile, "完全匹配")

    # ── 第二层：扩展同义词 ──
    expanded = expand_preferences(preferences) if preferences else []
    if environment:
        expanded = expanded + ["包装工", "分拣员", "保洁员"]

    if expanded:
        for kw in expanded[:5]:  # 最多尝试5个扩展词
            result = search_jobs.invoke({"keyword": kw, "min_salary": 0})
            if result.get("jobs"):
                jobs = _score_and_sort(result["jobs"], profile)
                if jobs:
                    return _build_result(2, jobs, profile, f"相近岗位（{kw}）")

    # ── 第三层：没有结果 → 提示放宽 ──
    return {
        "layer": 3,
        "jobs": [],
        "summary": "暂时没有找到完全符合的岗位。",
        "reason": "",
        "next_hint": "您可以换一个工种试试，或者我帮您把距离放宽一些。",
        "actions": [
            {"text": "放宽距离", "type": "cancel", "data": {}},
            {"text": "换个工种", "type": "cancel", "data": {}},
        ],
    }


def _score_and_sort(jobs: list, profile: dict) -> list:
    """按用户画像对岗位评分并排序"""
    scored = []
    for job in jobs:
        score = _score_job(job, profile)
        if score > 0:
            scored.append((job, score))
    scored.sort(key=lambda x: -x[1])
    return [job for job, _ in scored[:6]]  # 最多6个


def _score_job(job: dict, profile: dict) -> int:
    """对单个岗位评分（分数越高越匹配）"""
    score = 50  # 基础分

    age = profile.get("age")
    preferences = profile.get("job_preferences", [])
    environment = profile.get("work_environment")
    location = profile.get("location")

    # 年龄匹配
    if age:
        job_age_req = job.get("requirement", "") or ""
        age_nums = [int(n) for n in re.findall(r'\d{2}', job_age_req) if int(n) >= 18]
        if age_nums:
            max_age = max(age_nums)
            if age <= max_age:
                score += 30
            else:
                score -= 20
        else:
            score += 15  # 没写年龄要求默认加分

    # 工种偏好匹配
    if preferences:
        job_title = job.get("title", "") or ""
        for pref in preferences:
            if pref in job_title:
                score += 25
                break
        else:
            # 检查扩展词
            expanded = expand_preferences(preferences)
            for exp in expanded:
                if exp in job_title:
                    score += 15
                    break

    # 环境匹配
    if environment:
        job_desc = (job.get("title", "") or "") + (job.get("description", "") or "")
        if environment == "indoor" and any(w in job_desc for w in ["室内", "车间", "仓库", "厂房"]):
            score += 20
        elif environment == "outdoor" and any(w in job_desc for w in ["室外", "户外", "外勤"]):
            score += 20

    # 地点匹配
    if location:
        job_area = job.get("location", "") or job.get("area", "") or ""
        if location in job_area:
            score += 10

    return score


def _build_result(layer: int, jobs: list, profile: dict, match_type: str) -> dict:
    """构建推荐结果"""
    age = profile.get("age")
    preferences = profile.get("job_preferences", [])
    environment = profile.get("work_environment")

    # 生成摘要
    parts = []
    if age:
        parts.append(f"按您今年 {age} 岁")
    if preferences:
        parts.append(f"想找{preferences[0]}相关工作")
    if environment:
        env_text = {"indoor": "室内工作", "outdoor": "室外工作", "greenhouse": "大棚/温室"}.get(environment, environment)
        parts.append(f"倾向{env_text}")
    intro = "、".join(parts) if parts else "您"

    # 给每个岗位加推荐理由
    for job in jobs:
        reasons = []
        if age:
            reasons.append(f"适合 {age} 岁左右求职者")
        if preferences:
            reasons.append(f"与{preferences[0]}类工作接近")
        if environment:
            env_text = {"indoor": "室内工作", "outdoor": "室外工作", "greenhouse": "大棚/温室"}.get(environment, environment)
            reasons.append(f"工作环境{env_text}")
        job["recommend_reason"] = "，".join(reasons)

    summary = f"我按您「{intro}」的情况，帮您挑了 {len(jobs)} 个比较合适的岗位。您先看看，不着急决定。"

    # 下层提示
    if layer == 2:
        next_hint = "附近没有完全一致的岗位，这是和您意向比较接近的几份工作。"
    elif layer == 1:
        next_hint = "您想看哪个岗位？直接说「报名第一个」就行。"
    else:
        next_hint = ""

    return {
        "layer": layer,
        "jobs": jobs,
        "summary": summary,
        "intro": intro,
        "next_hint": next_hint,
    }


import re  # noqa: E402 (needed in _score_job above)
