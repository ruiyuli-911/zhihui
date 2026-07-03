"""
智慧小职 — 安全守卫

拦截风险操作，确保系统行为可控。

检查项：
  - 未确认就报名
  - 跨用户查数据
  - 不完整资料强行提交
  - 低置信度 RAG 建议
  - 恶意 Prompt 注入
"""

import re
from typing import Optional

# ─── Prompt 注入关键词 ───
INJECTION_PATTERNS = [
    r"忽略(规则|指令|设定|系统)",
    r"无视.*(规则|指令|设定)",
    r"忘记.*(提示|指令|设置)",
    r"跳过.*(检查|确认|校验)",
    r"直接(报名|提交|执行).*所有",
    r"你是.*(不是|而非).*(助手|小职)",
    r"system.*prompt",
    r"你被(修改|更改|重置)",
]


class SafetyGuard:
    """安全守卫 — 检查风险操作"""

    @staticmethod
    def check_apply_prerequisites(state: str, pending_job: Optional[dict]) -> Optional[str]:
        """
        检查报名前置条件。
        state: 当前对话状态
        pending_job: 待报名岗位
        返回错误消息或 None
        """
        if state not in ("waiting_confirm", "collecting_info", "submitting"):
            return "请先选择要报名的岗位，然后确认报名。"
        if not pending_job:
            return "没有找到待报名的岗位信息，请重新选择。"
        return None

    @staticmethod
    def check_data_ownership(requested_uid: str, session_uid: str) -> Optional[str]:
        """检查数据归属——只能查自己的"""
        if requested_uid and session_uid and requested_uid != session_uid:
            return "只能查看您自己的信息。"
        return None

    @staticmethod
    def check_profile_completeness(profile: dict, required: list[str]) -> Optional[str]:
        """检查资料完整性"""
        missing = []
        field_map = {"name": "姓名", "phone": "电话", "age": "年龄"}
        for field in required:
            en_key = field
            cn_name = field_map.get(field, field)
            if not profile.get(en_key):
                missing.append(cn_name)
        if missing:
            return f"还差{'、'.join(missing)}"
        return None

    @staticmethod
    def check_rag_confidence(score: float, threshold: float = 1.0) -> Optional[str]:
        """
        检查 RAG 检索置信度。
        低于阈值不回答，引导用户追问。
        """
        if score < threshold:
            return "这个问题我没有查到准确的政策资料，建议您打 12333 咨询人社局。"
        return None

    @staticmethod
    def check_injection(text: str) -> bool:
        """检查 Prompt 注入"""
        for pattern in INJECTION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return True
        return False

    @staticmethod
    def validate_user_info(data: dict) -> list[str]:
        """校验用户输入的个人信息"""
        errors = []

        if "name" in data and data["name"]:
            name = data["name"].strip()
            if len(name) < 1 or len(name) > 10:
                errors.append("姓名长度不对")
            if re.search(r'[<>{}|\\^~`]', name):
                errors.append("姓名包含非法字符")

        if "age" in data and data["age"] is not None:
            age = data["age"]
            if not isinstance(age, int):
                try:
                    age = int(age)
                except (ValueError, TypeError):
                    errors.append("年龄必须是数字")
                    return errors
            if age < 16 or age > 80:
                errors.append("年龄需要在 16-80 岁之间")

        if "phone" in data and data["phone"]:
            phone = str(data["phone"]).strip()
            if not re.match(r'^1\d{10}$', phone):
                errors.append("手机号格式不对，请输入 11 位手机号")

        return errors


guard = SafetyGuard()
