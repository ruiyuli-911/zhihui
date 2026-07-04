"""
报名服务

职责：
- prepare_application: 查岗位+资料，生成确认卡片 + confirm_token
- submit_application: 校验 token + 提交报名（幂等）
- confirm_token 绑定 account_id + job_id + session，10分钟过期，一次有效

⚠️ 敏感操作：所有校验必须在后端完成，不信任前端传入的任何报名决策。
"""

import hashlib
import json
import logging
import time
from datetime import datetime
from typing import Optional

from services.db_factory import get_db
from agent.tools import get_job_detail, _build_job_card
from orchestrator.profile_service import get_user_profile, get_masked_profile, check_profile_completeness

logger = logging.getLogger(__name__)
db = get_db()

# 内存中存储 confirm_token（生产环境应改用 Redis）
# 结构: {token_hash: {account_id, job_id, session_id, expires_at, used}}
_confirm_tokens = {}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _generate_token(account_id: str, job_id: str, session_id: str) -> str:
    """生成一次性确认令牌"""
    raw = f"{account_id}:{job_id}:{session_id}:{time.time()}:{hashlib.md5(str(time.time()).encode()).hexdigest()[:8]}"
    token = hashlib.sha256(raw.encode()).hexdigest()[:32]
    return token


def prepare_application(account_id: str, job_id: str, session_id: str) -> dict:
    """
    准备报名：检查岗位+资料，生成确认卡片。

    返回:
      {
        "ready": True/False,
        "job": {...},          # 岗位卡片
        "profile": {...},      # 脱敏信息
        "missing_fields": [],  # 缺的资料
        "confirm_token": "xxx" # 只有 ready=True 时才有
      }
    """
    # 1. 查岗位
    detail = get_job_detail.invoke({"job_id": job_id})
    if detail.get("error"):
        return {"ready": False, "error": detail["error"]}
    job = detail["job"]

    # 2. 查岗位状态
    job_raw = db.get("jobs", job_id)
    if not job_raw:
        return {"ready": False, "error": "岗位不存在"}
    if job_raw.get("auditStatus") != "approved" or job_raw.get("recruitStatus") != "recruiting":
        return {"ready": False, "error": "该岗位当前不可报名"}

    # 3. 查用户资料
    profile = get_user_profile(account_id)
    missing = check_profile_completeness(profile)

    if missing:
        return {
            "ready": False,
            "job": job,
            "missing_fields": missing,
            "profile": get_masked_profile(account_id),
        }

    # 4. 幂等性检查
    existing = db.query("applications", where={"jobId": job_id, "jobseekerId": account_id}, limit=5)
    for app in existing:
        if app.get("status") in ("submitted", "accepted", "completed"):
            return {"ready": False, "error": "您已经报过这个岗位，不能重复报名。"}

    # 5. 生成 confirm_token
    token = _generate_token(account_id, job_id, session_id)
    token_hash = _hash_token(token)
    _confirm_tokens[token_hash] = {
        "account_id": account_id,
        "job_id": job_id,
        "session_id": session_id,
        "expires_at": time.time() + 600,  # 10 分钟
        "used": False,
    }

    return {
        "ready": True,
        "job": job,
        "profile": get_masked_profile(account_id),
        "confirm_token": token,
    }


def submit_application(account_id: str, job_id: str, confirm_token: str, session_id: str) -> dict:
    """
    确认提交报名。

    校验：
      - token 存在且未使用
      - token 未过期
      - token 绑定当前用户+岗位+会话
      - 岗位仍可报名
      - 不重复报名
    """
    token_hash = _hash_token(confirm_token)
    token_data = _confirm_tokens.get(token_hash)

    if not token_data:
        return {"success": False, "error": "确认令牌无效，请重新操作。"}

    if token_data["used"]:
        return {"success": False, "error": "该确认令牌已被使用，请重新操作。"}

    if time.time() > token_data["expires_at"]:
        _confirm_tokens.pop(token_hash, None)
        return {"success": False, "error": "确认令牌已过期，请重新操作。"}

    if token_data["account_id"] != account_id or token_data["job_id"] != job_id or token_data["session_id"] != session_id:
        return {"success": False, "error": "确认令牌信息不匹配。"}

    # 标记已使用（防止重复提交）
    _confirm_tokens[token_hash]["used"] = True

    # 再次检查岗位
    job = db.get("jobs", job_id)
    if not job:
        return {"success": False, "error": "岗位不存在"}
    if job.get("auditStatus") != "approved" or job.get("recruitStatus") != "recruiting":
        return {"success": False, "error": "该岗位当前不可报名"}

    # 再次检查重复报名
    existing = db.query("applications", where={"jobId": job_id, "jobseekerId": account_id}, limit=5)
    for app in existing:
        if app.get("status") in ("submitted", "accepted", "completed"):
            return {"success": False, "error": "您已经报过这个岗位，不能重复报名。"}

    # 创建报名记录
    profile = get_user_profile(account_id)
    now_str = datetime.now().strftime("%Y%m%d%H%M%S")
    app_id = f"{now_str}-{job_id}-{account_id[-8:]}" if len(account_id) >= 8 else f"{now_str}-{job_id}"

    application_data = {
        "_id": app_id,
        "jobId": job_id,
        "jobseekerId": account_id,
        "companyId": job.get("companyId", ""),
        "jobTitle": job.get("title", ""),
        "companyName": job.get("companyName", ""),
        "jobseekerName": profile.get("name", ""),
        "jobseekerPhone": profile.get("phone", ""),
        "status": "submitted",
        "applyTime": datetime.now().isoformat(),
        "processTime": None,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "confirmToken": token_hash[:16],
    }

    try:
        db.add("applications", application_data)
        apply_count = job.get("applyCount", 0) or 0
        db.update("jobs", job_id, {"applyCount": apply_count + 1})
        _confirm_tokens.pop(token_hash, None)  # 用完移除
        return {
            "success": True,
            "application_id": app_id,
            "message": f"报名成功！已成功报名{job.get('title', '')}，企业将在1个工作日内联系您。",
        }
    except Exception as e:
        err_str = str(e).lower()
        if "dup" in err_str or "duplicate" in err_str or "e11000" in err_str:
            return {"success": False, "error": "您已经报过这个岗位，不能重复报名。"}
        logger.error("报名提交失败: %s", e)
        return {"success": False, "error": f"报名提交失败，请稍后重试。"}
