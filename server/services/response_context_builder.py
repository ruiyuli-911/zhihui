"""
ResponseContextBuilder — 构建可安全发送给 LLM 的业务摘要

职责：
- 把后端真实业务结果（岗位、确认信息、报名结果）整理成安全的摘要
- 只包含 LLM 需要知道的信息，不包含敏感数据
- 每个场景有固定的 facts 结构，LLM 只能依据 facts 说话
"""

from typing import Optional


def build_greeting_context() -> dict:
    return {
        "scene": "greeting",
        "facts": {
            "service_name": "智汇小玉",
            "capabilities": ["找工作", "推荐岗位", "报名", "查进度", "政策咨询"],
            "tone": "warm_welcome",
        },
        "instruction": "用简短、亲切的中文介绍自己，告诉用户可以帮ta做什么。控制在 2 句话以内。不要编造岗位信息。",
    }


def build_recommend_first_time_context(
    message: str,
    job_count: int,
    age: Optional[int],
    preferences: list,
    reasons: list,
    has_more: bool,
) -> dict:
    facts = {
        "job_count": job_count,
        "has_more": has_more,
        "reasons": reasons[:3],
    }
    if age:
        facts["user_age"] = age
    if preferences:
        facts["user_preferences"] = preferences[:3]

    return {
        "scene": "recommend_first_time",
        "facts": facts,
        "instruction": (
            "根据推荐结果说一两句话。可以提及岗位数量和推荐依据，"
            "但不能编造具体岗位名称、薪资、地址、年龄要求、福利。"
            "用户是中老年人，请用简短、亲切的中文。"
        ),
    }


def build_recommend_more_context(
    message: str,
    job_count: int,
    excluded_count: int,
    reasons: list,
    user_new_preference: str = "",
) -> dict:
    facts = {
        "job_count": job_count,
        "excluded_count": excluded_count,
        "reasons": reasons[:3],
    }
    if user_new_preference:
        facts["user_new_preference"] = user_new_preference

    return {
        "scene": "recommend_more",
        "facts": facts,
        "instruction": (
            "用户要求换一批岗位。回复要体现已经避开之前展示过的岗位，"
            "如果用户说了新的偏好（如不想夜班、想离家近），要回应ta的偏好变化。"
            "不能编造具体岗位名称、薪资、地址。"
        ),
    }


def build_search_result_context(
    message: str,
    job_count: int,
    keyword: str,
    reasons: list,
) -> dict:
    return {
        "scene": "search_result",
        "facts": {
            "keyword": keyword,
            "job_count": job_count,
            "reasons": reasons[:3],
        },
        "instruction": (
            f"用户搜索了「{keyword}」相关岗位。"
            "用一两句话告知搜索结果数量。"
            "不能编造具体岗位名称、薪资、地址。"
        ),
    }


def build_no_jobs_found_context(message: str, keyword: str = "") -> dict:
    return {
        "scene": "no_jobs_found",
        "facts": {"keyword": keyword},
        "instruction": (
            "没有找到匹配的岗位。告知用户当前没有结果，"
            "建议换个关键词试试。语气要温和，不让用户失望。"
        ),
    }


def build_apply_confirm_context(job_title: str, company: str, has_profile: bool) -> dict:
    facts = {"job_title": job_title}
    if company:
        facts["company"] = company
    return {
        "scene": "apply_confirm",
        "facts": facts,
        "instruction": (
            "用户准备报名。说一句引导语让用户确认信息。"
            "注意：具体报名信息（姓名、电话、年龄）由卡片展示，"
            "你不要重复这些信息。只说一句比如「我已帮您核对好报名信息，请确认。」"
            "不能编造岗位名称、薪资、地址。不超过 2 句话。"
        ),
    }


def build_apply_success_context(job_title: str) -> dict:
    return {
        "scene": "apply_success",
        "facts": {"job_title": job_title, "success": True},
        "instruction": (
            "报名已成功提交。告知用户报名成功，招聘方会联系ta。"
            "语气要正面、肯定。不超过 2 句话。"
        ),
    }


def build_profile_question_context(missing_fields: list) -> dict:
    return {
        "scene": "profile_question",
        "facts": {"missing_fields": missing_fields},
        "instruction": (
            f"用户缺少以下信息：{'、'.join(missing_fields)}。"
            "用亲切的语气一次只问一项。不要一次性列出所有缺失项。"
        ),
    }


def build_application_status_context(record_count: int) -> dict:
    return {
        "scene": "application_status",
        "facts": {"record_count": record_count},
        "instruction": (
            f"用户有 {record_count} 条报名记录。"
            "用简短的话告知用户报名情况。"
        ),
    }
