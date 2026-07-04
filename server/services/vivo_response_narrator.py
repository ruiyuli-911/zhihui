"""
VivoResponseNarrator — 自然回复生成器（异步）

职责：
- 接收 ResponseContextBuilder 整理的安全摘要
- 调用 vivo AI 生成自然、亲切的回复文本（reply）
- 只生成 reply 字段，不接触任何结构化业务数据
- LLM 失败时使用后端 fallback 模板，不影响业务流程
"""

import json
import logging
from services.vivo_llm import VivoLLMClient

logger = logging.getLogger(__name__)

FALLBACK_REPLIES = {
    "greeting": "您好！我是智汇小玉，可以帮您找工作、推荐岗位、报名、查进度。有什么可以帮您的吗？",
    "recommend_first_time": (
        "帮您找到了几个合适的岗位，您看看有没有感兴趣的。"
    ),
    "recommend_more": (
        "好的，我重新帮您挑了一批岗位，避开了刚才那些。您看看有没有更合适的？"
    ),
    "search_result": "帮您搜到了几个相关岗位，您可以看看。",
    "no_jobs_found": (
        "目前没有找到完全合适的岗位。您可以换个关键词试试，"
        "或者跟我说说您想做什么类型的工作，我帮您再找找。"
    ),
    "apply_confirm": "我已帮您核对好报名信息，请确认无误后提交。",
    "apply_success": (
        "报名已成功提交！招聘方会通过电话联系您，请留意来电。"
    ),
    "profile_question": "好的，请先告诉您的信息，我来帮您登记。",
    "application_status": "这是您的报名记录。",
    "error": "请稍后再试。",
}

NARRATOR_SYSTEM_PROMPT = """你是一个亲切的就业助手，专门帮助中老年人找工作。

你的任务是根据后端提供的业务摘要（facts），生成自然、简短、亲切的回复。

规则：
1. 只能依据 facts 字段中的信息说话，不要编造任何额外信息
2. 不要编造：岗位名称、薪资、地址、年龄要求、福利、联系方式、联系人
3. 不要透露：身份证号、完整手机号、完整姓名
4. 除非 facts.success=true，否则不能说"已经报名成功"
5. 使用简短、亲切、易懂的中文，适合中老年用户
6. 每次回复不超过 2-3 句话
7. 避免"根据您的需求""系统已为您"等生硬表达

只返回 JSON 格式：
{"reply": "你的回复内容"}
"""


class VivoResponseNarrator:
    """自然回复生成器（异步）"""

    def __init__(self, vivo_client: VivoLLMClient = None):
        self._vivo = vivo_client

    async def narrate(self, context: dict) -> str:
        """
        根据业务上下文生成自然回复（异步）。

        参数:
          context: ResponseContextBuilder 构建的上下文字典
                   {scene, facts, instruction}

        返回:
          reply 文本（字符串）
        """
        if not self._vivo:
            return self._fallback(context)

        scene = context.get("scene", "")
        facts = context.get("facts", {})
        instruction = context.get("instruction", "")

        messages = [
            {"role": "system", "content": NARRATOR_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({
                "scene": scene,
                "facts": facts,
                "instruction": instruction,
            }, ensure_ascii=False)},
        ]

        try:
            reply_text = await self._vivo.chat(messages, temperature=0.5, max_tokens=300)
            result = json.loads(reply_text)
            reply = result.get("reply", "").strip()
            if reply:
                return reply
        except json.JSONDecodeError:
            logger.warning("Narrator 返回非 JSON: %s", reply_text[:100])
        except Exception as e:
            logger.warning("Narrator 调用失败: %s", e)

        return self._fallback(context)

    def _fallback(self, context: dict) -> str:
        """LLM 不可用时使用 fallback 模板"""
        scene = context.get("scene", "")
        return FALLBACK_REPLIES.get(scene, FALLBACK_REPLIES["error"])
