"""
用户资料服务

职责：
- 从 accounts + jobseekers 表查询用户资料
- 从身份证号计算年龄和性别
- 脱敏敏感数据（身份证号、手机号）再返回给上层
- 绝不把完整身份证号和手机号传给 LLM
"""

import logging
from datetime import datetime
from typing import Optional

from services.db_factory import get_db

logger = logging.getLogger(__name__)
db = get_db()


def get_user_profile(user_id: str) -> dict:
    """
    获取用户完整资料（含敏感信息，仅后端使用）。
    返回字段：name, phone, age, gender, idNumber, expect_job, expect_area
    """
    accounts = db.query("accounts", where={"openid": user_id}, limit=1)
    if not accounts:
        accounts = db.query("accounts", where={"_id": user_id}, limit=1)
    account = accounts[0] if accounts else None

    account_id = (account or {}).get("_id", user_id)
    seekers = db.query("jobseekers", where={"accountId": account_id}, limit=1)
    if not seekers and user_id != account_id:
        seekers = db.query("jobseekers", where={"accountId": user_id}, limit=1)
    seeker = seekers[0] if seekers else None

    profile = {
        "name": (account or {}).get("name", "") or (seeker or {}).get("name", ""),
        "phone": (account or {}).get("phone", "") or (seeker or {}).get("phone", ""),
        "age": None,
        "gender": (seeker or {}).get("gender", None) or (account or {}).get("gender", None),
        "idNumber": (seeker or {}).get("idNumber", "") or (account or {}).get("idNumber", ""),
        "expect_job": (seeker or {}).get("expectJob", ""),
        "expect_area": (seeker or {}).get("expectArea", ""),
    }

    # 从身份证号计算年龄
    if profile.get("idNumber"):
        id_num = profile["idNumber"]
        if len(id_num) >= 14:
            try:
                by = int(id_num[6:10])
                bm = int(id_num[10:12])
                bd = int(id_num[12:14])
                now = datetime.now()
                age = now.year - by
                if (now.month, now.day) < (bm, bd):
                    age -= 1
                profile["age"] = age
            except (ValueError, IndexError):
                pass
        # 身份证第17位：奇男偶女
        if not profile["gender"] and len(id_num) >= 17:
            try:
                profile["gender"] = "男" if int(id_num[16]) % 2 == 1 else "女"
            except (ValueError, IndexError):
                pass

    # 如果没有身份证，从 birthYear 计算
    if not profile["age"]:
        birth_year = (seeker or {}).get("birthYear", None) or (account or {}).get("birthYear", None)
        if birth_year:
            profile["age"] = datetime.now().year - int(birth_year)

    return profile


def get_masked_profile(user_id: str) -> dict:
    """
    获取脱敏后的用户资料（可以安全传给 LLM / 前端展示）。
    不包含：完整手机号、完整身份证号。
    """
    raw = get_user_profile(user_id)
    phone = raw.get("phone", "")
    masked_phone = phone[:3] + "****" + phone[-4:] if len(phone) >= 7 else ""
    return {
        "name": raw.get("name", ""),
        "age": raw.get("age"),
        "gender": raw.get("gender", ""),
        "phone_masked": masked_phone,
        "expect_job": raw.get("expect_job", ""),
        "expect_area": raw.get("expect_area", ""),
    }


def check_profile_completeness(profile: dict) -> list:
    """检查资料完整性，返回缺失字段列表"""
    missing = []
    if not profile.get("name"):
        missing.append("姓名")
    if not profile.get("phone"):
        missing.append("联系电话")
    if not profile.get("age") and not profile.get("idNumber"):
        missing.append("年龄")
    return missing
