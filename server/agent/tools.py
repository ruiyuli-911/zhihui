"""
智慧小职 — 就业 Agent 工具定义

每个工具用 @tool 装饰，LLM 根据用户意图自动选择合适的工具和参数。
"""

import logging
from datetime import datetime
from typing import Optional

from langchain_core.tools import tool

from services.db_factory import get_db

db = get_db()

logger = logging.getLogger(__name__)


# ─── 辅助函数 ─────────────────────────────────────────────

def _format_salary(job: dict) -> str:
    """格式化薪资展示"""
    if job.get("salary"):
        return job["salary"]
    s_min = job.get("salaryMin") or job.get("salaryMin")
    s_max = job.get("salaryMax") or job.get("salaryMax")
    if s_min and s_max:
        return f"{s_min}-{s_max}元/月"
    if s_min:
        return f"{s_min}元/月起"
    return "面议"


def _build_job_card(job: dict) -> dict:
    """将数据库中的岗位记录转为前端岗位卡片格式"""
    benefits = []
    food = job.get("foodCondition", "") or ""
    if "包吃" in food:
        benefits.append("包吃")
    if "包住" in food or "住宿" in food:
        benefits.append("包住")
    if "五险" in food:
        benefits.append("五险")
    if food and "包吃" not in food and "包住" not in food and "五险" not in food:
        # 其他福利条件直接加入
        benefits.append(food)

    return {
        "job_id": job.get("_id", ""),
        "title": job.get("title", ""),
        "company_name": job.get("companyName", ""),
        "salary": _format_salary(job),
        "location": job.get("address", job.get("area", "")),
        "distance": "",  # 前端根据用户位置计算
        "benefits": benefits,
        "category": job.get("categoryName", ""),
    }


# ─── 工具 1: 搜索岗位 ─────────────────────────────────────

@tool
def search_jobs(
    keyword: str = "",
    city: str = "",
    district: str = "",
    min_salary: int = 0,
    max_salary: int = 0,
    distance_km: int = 10,
    provide_food: bool = False,
    provide_housing: bool = False,
    page: int = 1,
    page_size: int = 10,
) -> dict:
    """
    根据用户条件查询岗位列表。
    keyword 是岗位名称/关键词，如保安、保洁、搬运工；
    city 是城市名；district 是区域名；
    min_salary 是最低工资要求；
    distance_km 是距离范围（公里）；
    provide_food / provide_housing 是否要求包吃/包住。
    返回匹配的岗位列表和数量。
    """
    logger.info(
        "search_jobs: keyword=%s, city=%s, district=%s, min_salary=%s, "
        "distance=%s, food=%s, housing=%s",
        keyword, city, district, min_salary,
        distance_km, provide_food, provide_housing,
    )

    # 基础条件：审核通过 + 招聘中
    where = {
        "auditStatus": "approved",
        "recruitStatus": "recruiting",
    }

    # 关键词搜索（模糊匹配标题/公司/分类）
    # 注意：微信云数据库不支持 $or + regex 的复杂查询，
    # 这里先按 keyword 精确匹配 title，后续可扩展
    if keyword:
        where["title"] = keyword  # 精确匹配标题关键词

    if district:
        where["area"] = district

    # 薪资条件（微信云 DB 不支持直接的 >= 查询语法，
    # 这里先做基础查询，在 Python 层做过滤）
    try:
        jobs_raw = db.query("jobs", where=where, limit=page_size,
                            skip=(page - 1) * page_size)
    except Exception as e:
        logger.error("数据库查询失败: %s", e)
        return {"total": 0, "jobs": [], "error": "数据库查询失败"}

    # Python 层过滤
    filtered = []
    for j in jobs_raw:
        # 薪资过滤
        if min_salary > 0:
            s_min = j.get("salaryMin") or 0
            if s_min < min_salary:
                continue
        # 包吃过滤
        if provide_food:
            food = j.get("foodCondition", "") or ""
            if "包吃" not in food:
                continue
        # 包住过滤
        if provide_housing:
            food = j.get("foodCondition", "") or ""
            if "包住" not in food and "住宿" not in food:
                continue

        filtered.append(j)

    jobs = [_build_job_card(j) for j in filtered]

    return {
        "total": len(jobs),
        "jobs": jobs,
        "summary": f"为您找到 {len(jobs)} 个符合条件的岗位",
    }


# ─── 工具 2: 岗位详情 ─────────────────────────────────────

@tool
def get_job_detail(job_id: str) -> dict:
    """获取单个岗位的详细信息，包括公司名称、薪资范围、工作地点、福利待遇、岗位要求等。"""
    logger.info("get_job_detail: job_id=%s", job_id)

    job = db.get("jobs", job_id)
    if not job:
        return {"error": "岗位不存在或已下架", "job": None}

    card = _build_job_card(job)
    card.update({
        "company_name": job.get("companyName", ""),
        "requirement": job.get("requirement", ""),
        "description": job.get("description", ""),
        "work_hours": job.get("workHours", ""),
        "head_count": job.get("peopleCount", job.get("headCount", "")),
    })

    return {"job": card, "error": None}


# ─── 工具 3: 报名岗位 ─────────────────────────────────────

@tool
def apply_job(job_id: str, user_id: str, user_name: str = "",
              user_phone: str = "", user_age: Optional[int] = None) -> dict:
    """
    为用户报名指定岗位。
    调用前必须先让用户确认岗位信息。
    如果用户资料不完整（缺少姓名/电话/年龄），返回需要补充的信息项。
    幂等性：同一用户同一岗位不可重复报名。
    """
    logger.info("apply_job: job_id=%s, user_id=%s", job_id, user_id)

    # 1. 检查岗位是否存在且可报名
    job = db.get("jobs", job_id)
    if not job:
        return {"success": False, "error": "岗位不存在"}
    if job.get("auditStatus") != "approved" or job.get("recruitStatus") != "recruiting":
        return {"success": False, "error": "该岗位当前不可报名"}

    # 2. 检查用户资料完整性
    missing = []
    if not user_name:
        missing.append("姓名")
    if not user_phone:
        missing.append("联系电话")
    if user_age is None:
        missing.append("年龄")

    if missing:
        return {
            "success": False,
            "need_info": True,
            "missing_fields": missing,
            "error": f"缺少以下信息：{'、'.join(missing)}",
        }

    # 3. 幂等性检查：查是否已有有效报名
    active_statuses = ["submitted", "accepted", "completed"]
    existing_apps = db.query(
        "applications",
        where={"jobId": job_id, "jobseekerId": user_id},
        limit=5,
    )
    for app in existing_apps:
        if app.get("status") in active_statuses:
            return {
                "success": False,
                "error": "您已经报过这个岗位，不能重复报名。",
                "already_applied": True,
            }

    # 4. 创建报名记录
    now_str = datetime.now().strftime("%Y%m%d%H%M%S")
    app_id = f"{now_str}-{job_id}-{user_id[-8:]}" if len(user_id) >= 8 else f"{now_str}-{job_id}"

    application_data = {
        "_id": app_id,
        "jobId": job_id,
        "jobseekerId": user_id,
        "companyId": job.get("companyId", ""),
        "jobTitle": job.get("title", ""),
        "companyName": job.get("companyName", ""),
        "jobseekerName": user_name,
        "jobseekerPhone": user_phone or "",
        "status": "submitted",
        "applyTime": datetime.now().isoformat(),
        "processTime": None,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
    }

    try:
        db.add("applications", application_data)
        # 更新岗位报名数
        apply_count = job.get("applyCount", 0) or 0
        db.update("jobs", job_id, {"applyCount": apply_count + 1})

        return {
            "success": True,
            "application_id": app_id,
            "error": None,
            "message": f"报名成功！已成功报名{job.get('title', '')}，企业将在1个工作日内联系您。",
        }
    except Exception as e:
        err_str = str(e).lower()
        if "dup" in err_str or "duplicate" in err_str or "e11000" in err_str:
            return {
                "success": False,
                "error": "您已经报过这个岗位，不能重复报名。",
                "already_applied": True,
            }
        logger.error("报名失败: %s", e)
        return {"success": False, "error": f"报名提交失败: {str(e)}"}


# ─── 工具 4: 查询报名进度 ─────────────────────────────────

@tool
def get_application_status(user_id: str) -> dict:
    """查询用户的报名记录和当前处理进度。"""
    logger.info("get_application_status: user_id=%s", user_id)

    apps = db.query(
        "applications",
        where={"jobseekerId": user_id},
        order_by="applyTime",
        order="desc",
        limit=20,
    )

    status_map = {
        "submitted": "已报名，待企业查看",
        "accepted": "已录取",
        "rejected": "未通过",
        "cancelled": "已取消",
        "completed": "已完成",
    }

    records = []
    for app in apps:
        records.append({
            "application_id": app.get("_id", ""),
            "job_title": app.get("jobTitle", ""),
            "company_name": app.get("companyName", ""),
            "status": app.get("status", ""),
            "status_text": status_map.get(app.get("status", ""), "未知"),
            "apply_time": app.get("applyTime", ""),
        })

    return {
        "total": len(records),
        "records": records,
        "summary": f"您共有 {len(records)} 条报名记录" if records else "您还没有报名记录",
    }


# ─── 工具 5: 获取用户档案 ─────────────────────────────────

@tool
def get_user_profile(user_id: str) -> dict:
    """获取用户的个人档案信息，包括姓名、年龄、电话、期望岗位等。"""
    logger.info("get_user_profile: user_id=%s", user_id)

    # 先从 accounts 查
    accounts = db.query("accounts", where={"_id": user_id}, limit=1)
    account = accounts[0] if accounts else None

    # 再从 jobseekers 查
    seekers = db.query("jobseekers", where={"accountId": user_id}, limit=1)
    seeker = seekers[0] if seekers else None

    profile = {
        "user_id": user_id,
        "name": (seeker or account or {}).get("name", ""),
        "phone": (seeker or account or {}).get("phone", ""),
        "age": (seeker or {}).get("birthYear", None),
        "expect_job": (seeker or {}).get("expectJob", ""),
        "expect_area": (seeker or {}).get("expectArea", ""),
    }

    # 如果有 birthYear，计算年龄
    if profile["age"]:
        profile["age"] = datetime.now().year - profile["age"]

    return {"profile": profile}
