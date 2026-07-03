"""
智慧小职 — 槽位提取器

从自然语言中提取岗位筛选条件。
不依赖 LLM，纯规则 + 正则，结果可控。

提取结果：
  job_type: str         岗位类型（保安/保洁/搬运等）
  location: str         地点（高新区/雁塔区等）
  distance_km: int      距离范围（默认 10）
  min_salary: int       最低工资
  max_salary: int       最高工资
  housing: bool         是否要求住宿
  food: bool            是否要求包吃
  night_shift: bool     是否夜班
  age_max: int          年龄上限
  full_time: bool       是否全职
"""

import re

# 已知岗位类型
JOB_TYPES = {
    "保安": "保安", "门卫": "保安", "看门": "保安", "巡逻": "保安",
    "保洁": "保洁", "清洁": "保洁", "打扫": "保洁", "扫地": "保洁",
    "搬运": "搬运工", "装卸": "搬运工", "搬运工": "搬运工", "跟车": "搬运工",
    "建筑": "建筑工", "工地": "建筑工", "小工": "建筑工", "杂工": "建筑工",
    "家政": "家政", "保姆": "家政", "月嫂": "家政", "护工": "护工",
    "司机": "司机", "送货": "配送", "配送": "配送",
    "电工": "电工", "焊工": "焊工", "叉车": "叉车", "库管": "库管",
    "服务员": "服务员", "厨师": "厨师", "洗碗": "厨师", "面点": "厨师",
    "营业员": "营业员", "收银": "营业员",
    "护理": "护工", "护工": "护工",
}

# 西安区域
DISTRICTS = [
    "高新区", "雁塔区", "碑林区", "莲湖区", "未央区",
    "灞桥区", "长安区", "临潼区", "阎良区", "鄠邑区",
    "新城区", "经开区", "曲江新区", "航天基地", "西咸新区",
]


def extract_slots(text: str) -> dict:
    """
    从用户查询中提取岗位筛选条件。
    返回字典，缺失字段为 None 或默认值。
    """
    text = text.strip()
    if not text:
        return _default()

    result = _default()

    # ── 1. 岗位类型 ──
    for keyword, job_type in sorted(JOB_TYPES.items(), key=lambda x: -len(x[0])):
        if keyword in text:
            result["job_type"] = job_type
            break

    # ── 2. 地点 ──
    for district in sorted(DISTRICTS, key=lambda x: -len(x)):
        if district in text:
            result["location"] = district
            break
    # "附近" → 5 公里
    if "附近" in text:
        result["distance_km"] = 5

    # ── 3. 距离 ──
    m = re.search(r'(\d+)\s*公里', text)
    if m:
        result["distance_km"] = int(m.group(1))

    # ── 4. 工资 ──
    nums = [int(n) for n in re.findall(r'\d+', text) if int(n) > 0]
    # 处理"四千"类中文数字
    cn_nums = _extract_chinese_numbers(text)
    nums = cn_nums + nums

    if "工资" in text or "薪资" in text or "钱" in text:
        # 取第一个数字作为最低工资，后一个作为最高
        valid_nums = [n for n in nums if 1000 < n < 100000]
        if valid_nums:
            result["min_salary"] = min(valid_nums)
            if len(valid_nums) > 1:
                result["max_salary"] = max(valid_nums)

    # 特殊短语处理
    if "四千" in text or "四千以上" in text:
        result["min_salary"] = 4000
    if "五千" in text:
        result["min_salary"] = 5000

    # ── 5. 福利 ──
    if "包吃" in text or "管吃" in text or "供吃" in text:
        result["food"] = True
    if "包住" in text or "管住" in text or "供住" in text or "住宿" in text:
        result["housing"] = True

    # ── 6. 夜班 ──
    if "夜班" in text or "晚班" in text or "夜间" in text or "晚上" in text:
        result["night_shift"] = True

    # ── 7. 年龄要求 ──
    m = re.search(r'(\d{2})\s*岁(?:以[下内]|以下)', text)
    if m:
        result["age_max"] = int(m.group(1))

    return result


def _extract_chinese_numbers(text: str) -> list[int]:
    """提取中文数字：四千→4000, 五千→5000"""
    cn_map = {
        "四千": 4000, "五千": 5000, "六千": 6000, "七千": 7000,
        "八千": 8000, "九千": 9000, "一万": 10000,
    }
    nums = []
    for cn, num in cn_map.items():
        if cn in text:
            nums.append(num)
    return nums


def _default() -> dict:
    return {
        "job_type": None,
        "location": None,
        "distance_km": 10,
        "min_salary": 0,
        "max_salary": 0,
        "housing": False,
        "food": False,
        "night_shift": False,
        "age_max": 0,
    }
