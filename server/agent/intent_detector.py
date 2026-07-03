"""
智慧小职 — 三层意图路由

第一层：强规则拦截（精确匹配，不出错）
第二层：轻量语义分类（关键词 + 规则）
第三层：LLM 兜底（仅输出 JSON，不执行业务，预留）
"""

import re
from typing import Optional

# ═════════════════════════════════════════════════════════════
# 第一层：强规则拦截
# ═════════════════════════════════════════════════════════════

# 岗位类型词库
JOB_KEYWORDS = [
    "保安", "门卫", "看门", "巡逻",
    "保洁", "清洁", "打扫", "扫地",
    "搬运", "装卸", "搬运工", "跟车",
    "建筑", "工地", "小工", "杂工",
    "家政", "保姆", "月嫂",
    "司机", "配送", "送货",
    "电工", "焊工", "叉车", "库管",
    "服务员", "厨师", "洗碗", "面点",
    "营业员", "收银",
    "护理", "护工",
    "工作", "岗位", "活",
]

# 政策/知识关键词
POLICY_KEYWORDS = [
    "社保", "医保", "养老", "失业", "工伤", "生育",
    "合同", "辞退", "开除", "裁员", "补偿", "劳动法",
    "工资", "欠薪", "讨薪", "拖欠",
    "培训", "学技术", "学手艺", "技能",
    "维权", "投诉", "举报", "12333", "12348", "法律援助",
    "政策", "补贴", "4050", "灵活就业", "退休",
    "工地受伤", "受伤", "工伤认定", "摔伤",
]

# 确认词
CONFIRM_WORDS = {"确认", "确定", "是的", "对的", "嗯好", "好", "可以", "行", "要得"}

# 取消词
CANCEL_WORDS = {"取消", "不要", "算了", "不报名", "取消报名", "不去了", "放弃"}


def detect(text: str) -> dict:
    """
    三层意图检测。

    返回:
        {"intent": intent_name, "params": {dict}, "layer": 1|2|3}
    """
    text = text.strip()
    if not text:
        return {"intent": "unknown", "params": {}, "layer": 0}

    # ──────── 第一层：强规则拦截 ────────

    # 1.1 按岗位编号报名
    m = re.search(r"(?:报名|申请).{0,8}(J\d+)", text, re.IGNORECASE)
    if m:
        return {"intent": "apply_job_by_id", "params": {"job_id": m.group(1).upper()}, "layer": 1}

    # 1.2 按序号报名
    m = re.search(r"(?:报名|申请)(第[一二三四五六七八九十\d]+个)", text)
    if m:
        idx = _chinese_to_int(m.group(1))
        return {"intent": "apply_job_by_index", "params": {"index_text": m.group(1), "index": idx}, "layer": 1}

    # 1.3 提供个人信息（精确匹配）
    m = re.search(r'(?:我叫|我是|姓)(\S{1,6})(?:[，,\s]|今年|电话|$)', text)
    if m:
        return {"intent": "provide_info", "params": {"field": "name", "value": m.group(1)}, "layer": 1}
    m = re.search(r'(?:今年|年龄|岁数)?(\d{1,3})\s*岁', text)
    if m:
        age = int(m.group(1))
        if 16 <= age <= 80:
            return {"intent": "provide_info", "params": {"field": "age", "value": age}, "layer": 1}
    m = re.search(r'(1[3-9]\d{9})', text)
    if m:
        return {"intent": "provide_info", "params": {"field": "phone", "value": m.group(1)}, "layer": 1}

    # 1.5 精确确认
    if text in CONFIRM_WORDS:
        return {"intent": "confirm_apply", "params": {}, "layer": 1}

    # 1.6 精确取消
    if text in CANCEL_WORDS:
        return {"intent": "cancel_apply", "params": {}, "layer": 1}

    # 1.7 查岗位详情（含编号）
    if any(w in text for w in ["详情", "怎么样", "做什么的", "介绍"]):
        m = re.search(r"(J\d+)", text, re.IGNORECASE)
        if m:
            return {"intent": "job_detail", "params": {"job_id": m.group(1).upper()}, "layer": 1}
        m = re.search(r"(?:第[一二三四五六七八九十\d]+个)", text)
        if m:
            return {"intent": "job_detail", "params": {"index_text": m.group()}, "layer": 1}

    # ──────── 第二层：语义分类 ────────

    # 2.1 搜索岗位
    if "找" in text and any(kw in text for kw in JOB_KEYWORDS):
        matched = _match_keywords(text, JOB_KEYWORDS)
        return {"intent": "search_job", "params": {"keywords": matched}, "layer": 2}
    if any(kw in text for kw in ["搜", "查岗位", "推荐", "有什么"]) and \
       any(kw in text for kw in JOB_KEYWORDS):
        matched = _match_keywords(text, JOB_KEYWORDS)
        return {"intent": "search_job", "params": {"keywords": matched}, "layer": 2}

    # 2.2 政策/知识查询（排除个人查询）
    if any(kw in text for kw in POLICY_KEYWORDS):
        if "我的" not in text and "进度" not in text and "记录" not in text:
            return {"intent": "policy_query", "params": {"text": text}, "layer": 2}

    # 2.3 查报名进度
    if any(w in text for w in ["报名进度", "报名记录", "我的报名", "报名成功", "报名状态", "查看报名"]):
        return {"intent": "application_status", "params": {}, "layer": 2}
    if ("报名" in text and "进度" in text) or ("报名" in text and "记录" in text):
        return {"intent": "application_status", "params": {}, "layer": 2}

    # 2.4 查面试
    if "面试" in text:
        return {"intent": "interview_query", "params": {}, "layer": 2}

    # 2.5 更多搜索入口
    if "附近" in text and any(kw in text for kw in ["工作", "岗位", "活"]):
        return {"intent": "search_job", "params": {"keywords": ["附近"]}, "layer": 2}
    if any(kw in text for kw in JOB_KEYWORDS) and len(text) < 10:
        matched = _match_keywords(text, JOB_KEYWORDS)
        return {"intent": "search_job", "params": {"keywords": matched}, "layer": 2}

    # 2.6 打招呼
    if any(w in text for w in ["你好", "您好", "嗨", "hello", "hi", "在吗", "在不在"]):
        return {"intent": "greeting", "params": {}, "layer": 2}

    # 2.7 简短闲聊
    if len(text) <= 4:
        return {"intent": "small_talk", "params": {}, "layer": 2}

    # ──────── 第三层：LLM 兜底（预留） ────────
    # 有 DeepSeek Key 时调用 LLM 分类
    # 无 Key 时默认 small_talk

    return {"intent": "small_talk", "params": {}, "layer": 3}


def _match_keywords(text: str, keywords: list) -> list:
    """返回文本中匹配的关键词列表"""
    return [kw for kw in keywords if kw in text]


def _chinese_to_int(s: str) -> Optional[int]:
    """中文数字 → int"""
    m = re.search(r'\d+', s)
    if m:
        return int(m.group())
    cn_map = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
    for k, v in sorted(cn_map.items(), key=lambda x: -len(x[0])):
        if k in s:
            return v
    return None
