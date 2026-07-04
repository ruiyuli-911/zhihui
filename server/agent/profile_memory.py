"""
智汇小玉 — 用户画像存储器

功能：
  1. 将用户零散表达累积到 session.profile
  2. 判断当前信息是否足够发起一次推荐
  3. 生成推荐上下文摘要（用于推荐理由）
"""

from typing import Optional

# 工种→分类映射（用于推荐归类）
JOB_CATEGORIES = {
    "保安": "security", "门卫": "security", "巡逻": "security",
    "保洁": "cleaning", "清洁": "cleaning", "打扫": "cleaning",
    "搬运": "logistics", "装卸": "logistics", "物流": "logistics", "分拣": "logistics",
    "建筑": "construction", "工地": "construction", "小工": "construction",
    "家政": "domestic", "保姆": "domestic", "护工": "domestic",
    "工厂": "factory", "普工": "factory", "包装": "factory", "采摘": "factory",
    "农活": "factory", "种地": "factory", "下地": "factory", "干农活": "factory", "养殖": "factory",
    "厨师": "catering", "服务员": "catering",
    "司机": "driver", "配送": "driver", "送货": "driver",
}


def update_profile(profile: dict, new_info: dict) -> dict:
    """
    把用户新提供的信息合并到 profile 中。
    不会覆盖已存在的值（除非新值更具体）。
    """
    for key, value in new_info.items():
        if value is None or value == "":
            continue
        if key == "job_preferences":
            existing = profile.get("job_preferences", [])
            if isinstance(value, list):
                for v in value:
                    if v not in existing:
                        existing.append(v)
            elif value not in existing:
                existing.append(value)
            profile["job_preferences"] = existing
        else:
            # 已有值不覆盖（用户明确修改时再覆盖）
            if key not in profile or profile[key] is None:
                profile[key] = value
    return profile


def has_enough_for_recommend(profile: dict) -> bool:
    """
    判断 profile 是否足够发起一次岗位推荐。
    至少需要满足以下任意两条：
      - 有年龄
      - 有工种偏好
      - 有工作环境(室内/室外)
      - 有地点
    """
    conditions = 0
    if profile.get("age"):
        conditions += 1
    if profile.get("job_preferences"):
        conditions += 1
    if profile.get("work_environment"):
        conditions += 1
    if profile.get("location"):
        conditions += 1
    return conditions >= 1  # 至少有一条就可搜索


def get_profile_summary(profile: dict) -> str:
    """生成 profile 摘要，用于「为您推荐的理由」"""
    parts = []
    pref = profile.get("job_preferences", [])
    env = profile.get("work_environment")
    age = profile.get("age")
    loc = profile.get("location")

    if age:
        parts.append(f"适合 {age} 岁左右求职者")
    if pref:
        parts.append(f"对{pref[0]}类工作感兴趣")
    if env:
        env_text = {"indoor": "室内工作", "outdoor": "室外工作", "greenhouse": "大棚/温室"}.get(env, env)
        parts.append(f"倾向{env_text}")
    if loc:
        parts.append(f"在{loc}附近")

    return "，".join(parts) if parts else "根据您的综合条件"


def extract_work_environment(text: str) -> Optional[str]:
    """判断用户说的工作环境"""
    if any(w in text for w in ["室内", "屋里", "厂房", "车间", "仓库"]):
        return "indoor"
    if any(w in text for w in ["室外", "户外", "露天", "外勤"]):
        return "outdoor"
    if any(w in text for w in ["大棚", "温室"]):
        return "greenhouse"
    return None


def extract_job_preferences(text: str) -> list:
    """从文本中提取工种偏好"""
    found = []
    for keyword, category in sorted(JOB_CATEGORIES.items(), key=lambda x: -len(x[0])):
        if keyword in text and category not in found:
            found.append(keyword)
            break  # 每种分类只取一个
    return found
