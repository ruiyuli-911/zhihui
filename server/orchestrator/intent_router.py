"""
意图路由

职责：
- 所有用户消息先进来
- 明确、高风险、格式简单的指令 → 规则直接处理（快、稳、省）
- 模糊、自然语言表达复杂的消息 → vivo AI 提取意图和参数（受约束 JSON）
- 后端校验 LLM 输出的 intent + slots + confidence

安全原则：
- intent 必须在白名单内
- job_index 必须是整数且在展示范围内
- confidence 低时走规则兜底
- LLM 不能决定报名哪个岗位（不能传 job_id）
"""

import json
import logging
import re
from typing import Optional

from config import settings
from models.chat_schemas import VivoIntentResult, VALID_INTENTS

logger = logging.getLogger(__name__)

# ─── vivo AI 意图识别 system prompt ─────────────────────

INTENT_SYSTEM_PROMPT = """你是一个智能就业助手的意图识别模块。
你的任务是从用户的自然语言中提取意图和参数。

只能返回以下 JSON 格式，不要加任何其他文字：

{
  "intent": "intent_name",
  "slots": { ... },
  "confidence": 0.0-1.0
}

可用的 intent:
- small_talk: 闲聊、打招呼、无关话题
- greeting: 明确打招呼（你好、您好）
- recommend_jobs: 推荐岗位、找工作、推荐工作
- search_jobs: 搜索特定岗位（带关键词）
- more_like_me: 再推荐一些、换几个、还有没有类似的
- apply_job_by_index: 报名第几个（slots: job_index=数字）
- confirm_application: 确认报名、确认
- cancel_application: 取消、不报名
- favorite_job: 收藏岗位
- check_application_status: 查报名进度
- policy_query: 咨询政策（社保、合同等）
- provide_info: 提供个人信息（年龄、电话、姓名等）
- job_detail: 查看岗位详情

slots 字段说明（按 intent 不同）：
- recommend_jobs: {"keyword": "保安或null", "city": "西安或null"}
- search_jobs: {"keyword": "保安", "city": "西安或null", "salary_min": 4000或null}
- more_like_me: {} （不需要额外参数）
- apply_job_by_index: {"job_index": 2}
- provide_info: {"field": "age或phone或name", "value": "62或138..."}

重要规则：
1. 不要猜测用户没有提供的信息
2. 不确定的字段设为 null
3. confidence 低于 0.6 时，优先选择 small_talk
4. 不要返回 intent 白名单之外的 intent
5. 用户说"报名第二个" → intent=apply_job_by_index, slots={"job_index": 2}
6. 用户说"确认"或"确认报名" → intent=confirm_application
7. 用户说"取消" → intent=cancel_application
"""


# ─── 强规则匹配（不调 LLM）─────────────────────────────

# 第一层：规则拦截（精确匹配，不出错）
CONFIRM_WORDS = {"确认", "确定", "是的", "对的", "嗯好", "可以", "行", "要得", "确认报名", "提交报名"}
CANCEL_WORDS = {"取消", "不要", "算了", "不报名", "取消报名", "不去了", "放弃"}


def _rule_match(text: str) -> Optional[VivoIntentResult]:
    """强规则匹配，返回 None 表示需要走 LLM"""
    t = text.strip()

    # 1. 按序号报名
    m = re.search(r"(?:报名|申请)(第[一二三四五六七八九十\d]+个)", t)
    if m:
        idx_text = m.group(1)
        cn_map = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
        idx = None
        for k, v in sorted(cn_map.items(), key=lambda x: -len(x[0])):
            if k in idx_text:
                idx = v
                break
        m2 = re.search(r'\d+', idx_text)
        if m2:
            idx = int(m2.group())
        if idx:
            return VivoIntentResult(intent="apply_job_by_index", slots={"job_index": idx}, confidence=0.98)

    # 2. 按岗位编号报名
    m = re.search(r"(?:报名|申请).{0,8}(J\d+)", t, re.IGNORECASE)
    if m:
        return VivoIntentResult(intent="apply_job_by_id", slots={"job_id": m.group(1).upper()}, confidence=0.98)

    # 3. 确认 / 取消
    if t in CONFIRM_WORDS:
        return VivoIntentResult(intent="confirm_application", confidence=0.99)
    if t in CANCEL_WORDS:
        return VivoIntentResult(intent="cancel_application", confidence=0.99)

    # 4. 查进度
    if any(w in t for w in ["报名进度", "报名记录", "我的报名", "查看报名"]):
        return VivoIntentResult(intent="check_application_status", confidence=0.95)

    # 5. 收藏/取消收藏
    if t.startswith("收藏") or "收藏这个" in t or "收藏岗位" in t:
        return VivoIntentResult(intent="favorite_job", confidence=0.90)

    return None


# ─── 意图路由入口 ──────────────────────────────────────


async def route_intent(message: str, vivo_client=None) -> VivoIntentResult:
    """
    路由意图：先走规则，规则无法处理则走 LLM（异步）。

    参数:
      message: 用户消息
      vivo_client: VivoLLMClient 实例（可选，没有则走规则兜底）

    返回:
      VivoIntentResult
    """
    # 第一关：强规则
    rule_result = _rule_match(message)
    if rule_result:
        return rule_result

    # 第二关：LLM 意图识别（异步）
    if vivo_client and settings.VIVO_APP_KEY and settings.VIVO_APP_KEY not in ("", "你的AppKey"):
        try:
            messages = [
                {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": message},
            ]
            reply = await vivo_client.chat(messages, temperature=0.1, max_tokens=300)
            result = json.loads(reply)
            intent = result.get("intent", "small_talk")
            slots = result.get("slots", {})
            confidence = float(result.get("confidence", 0.0))

            # 校验 intent 白名单
            if intent not in VALID_INTENTS:
                logger.warning("LLM 返回了非法 intent: %s", intent)
                intent = "small_talk"
                confidence = 0.0

            # 校验 job_index 类型
            if intent == "apply_job_by_index":
                idx = slots.get("job_index")
                if not isinstance(idx, int) or idx < 1:
                    logger.warning("LLM 返回了非法 job_index: %s", idx)
                    return VivoIntentResult(intent="small_talk", confidence=0.0)

            return VivoIntentResult(intent=intent, slots=slots, confidence=confidence)

        except json.JSONDecodeError:
            logger.warning("LLM 意图识别返回非 JSON: %s", reply[:100])
        except Exception as e:
            logger.warning("LLM 意图识别失败: %s", e)

    # 第三关：兜底 → small_talk
    return VivoIntentResult(intent="small_talk", confidence=0.0)
