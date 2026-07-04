"""
ConversationOrchestrator — 对话编排器

核心职责：
  1. 接收用户消息
  2. IntentRouter 判断意图（规则或 LLM）
  3. 调用对应的后端服务执行
  4. ResponseRenderer 组装结构化响应
  5. 关键业务信息由后端模板生成，LLM 只负责润色

安全原则：
  - 所有用户身份从 session 解析，不信任前端 user_id
  - 敏感操作（报名）需要 confirm_token
  - LLM 不能直接写数据库
"""

import logging
import time
from typing import Optional

from config import settings
from models.chat_schemas import ChatResponse, ActionButton, VivoIntentResult
from agent.state import State
from agent.templates import (
    greeting as t_greeting, help_text, no_jobs,
    job_search_result, apply_success, apply_fail,
    collect_info_prompt, no_last_jobs, invalid_index, cancel_apply,
)
from agent.intent_detector import detect as legacy_detect

from services.vivo_llm import VivoLLMClient, VivoLLMError
from services.vivo_response_narrator import VivoResponseNarrator
from services.response_context_builder import (
    build_greeting_context, build_recommend_first_time_context,
    build_recommend_more_context, build_search_result_context,
    build_no_jobs_found_context, build_apply_confirm_context,
    build_apply_success_context, build_profile_question_context,
    build_application_status_context,
)
from orchestrator.intent_router import route_intent
from orchestrator.profile_service import (
    get_user_profile, get_masked_profile,
    check_profile_completeness,
)
from orchestrator.behavior_service import (
    get_behavior_profile, record_event, record_view, toggle_favorite,
)
from orchestrator.job_search_service import search_eligible_jobs
from orchestrator.recommendation_service import (
    score_and_sort_jobs, group_jobs_by_age_eligibility,
)
from orchestrator.application_service import (
    prepare_application, submit_application,
)

logger = logging.getLogger(__name__)


class ConversationOrchestrator:
    """对话编排器"""

    def __init__(self):
        self._vivo = None
        self._narrator = None
        if settings.VIVO_APP_KEY and settings.VIVO_APP_KEY not in ("", "你的AppKey"):
            try:
                self._vivo = VivoLLMClient(settings)
                self._narrator = VivoResponseNarrator(self._vivo)
                logger.info("vivo AI 已初始化（%s）", settings.VIVO_MODEL)
            except Exception as e:
                logger.warning("vivo AI 初始化失败: %s", e)
                self._narrator = VivoResponseNarrator()
        else:
            self._narrator = VivoResponseNarrator()
        self._sessions = {}

    # ─── 会话管理 ───────────────────────────────────────

    def _get_session(self, sid: str, uid: str) -> dict:
        if sid not in self._sessions:
            self._sessions[sid] = {
                "user_id": uid,
                "state": State.IDLE,
                "history": [],
                "last_jobs": [],
                "shown_job_ids": [],
                "pending_job": None,
                "pending_confirm_token": "",
                "collected_info": {},
                "collecting_fields": [],
                "profile": {},
                "location": None,
                "created_at": time.time(),
            }
        return self._sessions[sid]

    # ─── 主入口 ─────────────────────────────────────────

    async def process(self, user_id: str, message: str,
                      location: dict = None, session_id: str = "") -> ChatResponse:
        """处理用户消息"""
        sid = session_id or user_id
        session = self._get_session(sid, user_id)
        profile = session.setdefault("profile", {})

        if location:
            session["location"] = location

        session["history"].append({"role": "user", "content": message})

        # 加载用户资料
        if not profile.get("age"):
            try:
                dbp = get_user_profile(user_id)
                if dbp:
                    for k in ["name", "phone", "age", "gender", "idNumber"]:
                        if dbp.get(k) and not profile.get(k):
                            profile[k] = dbp[k]
            except Exception:
                pass

        # 意图路由
        intent_result = await route_intent(message, self._vivo)
        intent = intent_result.intent
        slots = intent_result.slots
        state = session.get("state", State.IDLE)

        logger.info("[编排器] state=%s, intent=%s (conf=%.2f)", state.value, intent, intent_result.confidence)

        # ── 状态机分发 ──
        response = await self._dispatch(state, intent, slots, message, user_id, session)
        session["history"].append({"role": "assistant", "content": response.reply})
        return response

    # ─── 状态分发 ───────────────────────────────────────

    async def _dispatch(self, state: State, intent: str, slots: dict,
                        msg: str, uid: str, session: dict) -> ChatResponse:
        """按状态机分发"""
        if intent == "cancel_application":
            return await self._handle_cancel(session)
        if intent == "check_application_status":
            return await self._handle_check_status(uid)
        if intent == "provide_info":
            return await self._handle_provide_info(msg, uid, session)

        if state == State.IDLE:
            return await self._handle_idle(intent, slots, msg, uid, session)
        if state == State.SHOWING_JOBS:
            return await self._handle_showing_jobs(intent, slots, msg, uid, session)
        if state in (State.PREPARING_APPLICATION, State.WAITING_CONFIRM):
            return await self._handle_preparing_application(intent, slots, msg, uid, session)
        if state == State.WAITING_APPLY_CONFIRM:
            return await self._handle_waiting_apply_confirm(intent, slots, msg, uid, session)
        if state == State.COLLECTING_INFO:
            return await self._handle_collecting_info(intent, slots, msg, uid, session)
        if state in (State.SUBMITTING, State.SUCCESS):
            session["state"] = State.IDLE
            return await self._handle_idle(intent, slots, msg, uid, session)

        return await self._handle_idle(intent, slots, msg, uid, session)

    # ─── IDLE 状态 ──────────────────────────────────────

    async def _handle_idle(self, intent: str, slots: dict, msg: str,
                           uid: str, session: dict) -> ChatResponse:
        """IDLE：搜索/推荐/聊天"""
        session["state"] = State.IDLE

        if intent in ("recommend_jobs", "search_jobs", "more_like_me"):
            return await self._do_recommend_or_search(intent, slots, msg, uid, session)

        if intent == "greeting":
            return ChatResponse(type="text", reply=t_greeting(), content={"text": t_greeting()})

        if intent == "apply_job_by_index":
            idx = slots.get("job_index", 1)
            return await self._do_select_job(idx, session)

        if intent == "job_detail":
            return await self._do_job_detail(slots, session)

        if intent == "confirm_application":
            return ChatResponse(type="text", reply="好的，有什么需要帮您的吗？", content={"text": "好的，有什么需要帮您的吗？"})

        if self._vivo:
            return await self._llm_chat(msg, session)

        return ChatResponse(type="text", reply=help_text(), content={"text": help_text()})

    # ─── SHOWING_JOBS 状态 ──────────────────────────────

    async def _handle_showing_jobs(self, intent: str, slots: dict, msg: str,
                                   uid: str, session: dict) -> ChatResponse:
        """SHOWING_JOBS：选岗/重新搜索"""
        if intent in ("search_jobs", "recommend_jobs", "more_like_me"):
            return await self._do_recommend_or_search(intent, slots, msg, uid, session)

        if intent == "apply_job_by_index":
            idx = slots.get("job_index", 1)
            return await self._do_select_job(idx, session)

        return ChatResponse(
            type="text",
            reply="您可以从上面选一个岗位，说「报名第一个」。或者换个条件再搜。",
            content={"text": "您可以从上面选一个岗位，说「报名第一个」。或者换个条件再搜。"},
        )

    # ─── PREPARING_APPLICATION 状态 ──────────────────────

    async def _handle_preparing_application(self, intent: str, slots: dict, msg: str,
                                            uid: str, session: dict) -> ChatResponse:
        """PREPARING_APPLICATION：已选岗，准备核验资料"""
        if intent == "confirm_application":
            return await self._do_prepare_apply(uid, session)
        if intent == "cancel_application":
            return await self._handle_cancel(session)
        if intent in ("search_jobs", "recommend_jobs", "more_like_me"):
            return await self._do_recommend_or_search(intent, slots, msg, uid, session)
        return ChatResponse(type="text", reply="请确认是否报名？说「确认」或「取消」。", content={"text": "请确认是否报名？"})

    # ─── WAITING_APPLY_CONFIRM 状态 ──────────────────────

    async def _handle_waiting_apply_confirm(self, intent: str, slots: dict, msg: str,
                                            uid: str, session: dict) -> ChatResponse:
        """WAITING_APPLY_CONFIRM：确认卡已展示，等用户最终确认"""
        if intent == "confirm_application":
            token = session.get("pending_confirm_token", "")
            return await self._do_submit(uid, session, token)
        if intent == "cancel_application":
            return await self._handle_cancel(session)
        return ChatResponse(type="text", reply="请点「确认报名」按钮提交，或说「取消」。",
                           content={"text": "请点「确认报名」按钮提交，或说「取消」。",
                                    "hint": "waiting_apply_confirm"})

    # ─── COLLECTING_INFO 状态 ────────────────────────────

    async def _handle_collecting_info(self, intent: str, slots: dict, msg: str,
                                      uid: str, session: dict) -> ChatResponse:
        """COLLECTING_INFO：收集中，收齐后准备报名"""
        if intent == "provide_info":
            return await self._handle_provide_info(msg, uid, session)
        if intent == "cancel_application":
            return await self._handle_cancel(session)
        return ChatResponse(type="text", reply=collect_info_prompt(session.get("collecting_fields", [])),
                           content={"text": collect_info_prompt(session.get("collecting_fields", []))})

    # ─── 核心动作 ───────────────────────────────────────

    async def _do_recommend_or_search(self, intent: str, slots: dict, msg: str,
                                      uid: str, session: dict) -> ChatResponse:
        """推荐或搜索岗位"""
        profile = session.get("profile", {})
        age = profile.get("age")
        preferences = profile.get("job_preferences", [])
        city = profile.get("city", "")

        # 获取关键词
        keyword = slots.get("keyword", "")
        if not keyword:
            # 从消息中提取
            for kw in ["保安", "保洁", "搬运", "采摘", "建筑", "家政", "工厂", "物流", "厨师", "司机"]:
                if kw in msg:
                    keyword = kw
                    break

        # 获取行为画像
        behavior = {}
        try:
            behavior = get_behavior_profile(uid)
        except Exception:
            pass

        # 排除已展示
        exclude_ids = session.get("shown_job_ids", [])

        # 搜索岗位（含年龄筛选）
        jobs = search_eligible_jobs(
            keyword=keyword,
            city=city,
            age=age,
            exclude_job_ids=exclude_ids,
            page_size=30,
        )

        if not jobs:
            session["state"] = State.IDLE
            reply = no_jobs(keyword) if keyword else "目前还没有发布的岗位。"
            return ChatResponse(type="text", reply=reply, content={"text": reply})

        # 算分排序
        scored = score_and_sort_jobs(jobs, age, preferences, behavior, city)

        # 按年龄分组
        if age:
            groups = group_jobs_by_age_eligibility(scored, age)
            # 按年龄合格→不限年龄→不合格排序
            ordered = groups["age_eligible"] + groups["no_age_limit"] + groups["age_mismatch"]
        else:
            ordered = scored

        # 取前 N 个
        top_jobs = ordered[:10]

        # 记录到 session
        session["state"] = State.SHOWING_JOBS
        session["last_jobs"] = top_jobs
        new_ids = [j.get("job_id") for j in top_jobs if j.get("job_id")]
        session["shown_job_ids"] = list(set(session.get("shown_job_ids", []) + new_ids))
        session["pending_job"] = None

        # 记录展示事件
        for j in top_jobs:
            try:
                record_event(uid, j.get("job_id", ""), "impression", {"title": j.get("title")})
            except Exception:
                pass

        # 用 narrator 生成自然回复
        scene = intent if intent in ("recommend_jobs", "more_like_me") else "search_result"
        if scene == "more_like_me":
            ctx = build_recommend_more_context(
                message=msg, job_count=len(top_jobs),
                excluded_count=len(session.get("shown_job_ids", [])),
                reasons=[r for j in top_jobs[:3] for r in j.get("reasons", [])],
            )
        elif scene == "recommend_jobs":
            ctx = build_recommend_first_time_context(
                message=msg, job_count=len(top_jobs), age=age,
                preferences=preferences,
                reasons=[r for j in top_jobs[:3] for r in j.get("reasons", [])],
                has_more=len(top_jobs) > 5,
            )
        else:
            ctx = build_search_result_context(
                message=msg, job_count=len(top_jobs), keyword=keyword,
                reasons=[r for j in top_jobs[:3] for r in j.get("reasons", [])],
            )
        summary = await self._narrator.narrate(ctx) if hasattr(self, '_narrator') and self._narrator else f"找到了 {len(top_jobs)} 个岗位。"

        actions = []
        for i, job in enumerate(top_jobs[:5]):
            idx_label = ['一', '二', '三', '四', '五'][i]
            actions.append(ActionButton(
                text=f"报名第{idx_label}个",
                type="confirm",
                data={"action": "select_job", "index": i + 1, "job_id": job.get("job_id")},
            ))

        if len(top_jobs) > 5:
            actions.append(ActionButton(text="查看更多", type="cancel", data={}))

        return ChatResponse(
            type="job_list",
            reply=summary,
            content={"summary": summary, "jobs": top_jobs},
            actions=actions,
            state=State.SHOWING_JOBS.value,
        )

    async def _do_select_job(self, index: int, session: dict) -> ChatResponse:
        """用户选岗"""
        jobs = session.get("last_jobs", [])
        if not jobs:
            session["state"] = State.IDLE
            return ChatResponse(type="text", reply=no_last_jobs(), content={"text": no_last_jobs()})

        if index < 1 or index > len(jobs):
            return ChatResponse(type="text", reply=invalid_index(len(jobs)),
                               content={"text": invalid_index(len(jobs))})

        job = jobs[index - 1]
        session["pending_job"] = job
        session["state"] = State.PREPARING_APPLICATION

        job_title = job.get('title', '')
        reply_text = f"您选的是【{job_title}】，{job.get('salary', '')}。确定报名吗？"
        if hasattr(self, '_narrator') and self._narrator:
            ctx = {
                "scene": "apply_confirm",
                "facts": {"job_title": job_title, "job_salary": job.get('salary', '')},
                "instruction": f"用户选了{job_title}。用一句话确认用户是否要报名这个岗位。不超过20字。",
            }
            narrated = await self._narrator.narrate(ctx)
            if narrated:
                reply_text = narrated

        return ChatResponse(
            type="confirm_apply",
            reply=reply_text,
            content={"text": reply_text,
                     "job": job, "index": index},
            actions=[
                ActionButton(text="确认报名", type="confirm", data={"action": "apply"}),
                ActionButton(text="取消", type="cancel", data={}),
            ],
        )

    async def _do_prepare_apply(self, uid: str, session: dict) -> ChatResponse:
        """准备报名：生成确认卡片"""
        job = session.get("pending_job", {})
        if not job:
            return ChatResponse(type="text", reply="请先选择要报名的岗位。", content={"text": "请先选择要报名的岗位。"})

        job_id = job.get("job_id", "")
        sid = uid  # 用 uid 作为 session_id 简化

        result = prepare_application(uid, job_id, sid)

        if not result.get("ready"):
            error = result.get("error", "")
            if error:
                return ChatResponse(type="text", reply=error, content={"text": error})

            # 缺资料
            missing = result.get("missing_fields", [])
            if missing:
                session["state"] = State.COLLECTING_INFO
                session["collecting_fields"] = missing
                session["collected_info"] = {k: v for k, v in result.get("profile", {}).items() if v}
                return ChatResponse(
                    type="collect_info",
                    reply=collect_info_prompt(missing),
                    content={"text": collect_info_prompt(missing), "missing_fields": missing, "job": job},
                )

        # 资料完整 → 展示确认卡
        confirm_token = result.get("confirm_token", "")
        session["pending_confirm_token"] = confirm_token
        session["state"] = State.WAITING_APPLY_CONFIRM
        masked = result.get("profile", {})
        job_data = result.get("job", job)

        # 用 narrator 生成自然引导语
        reply_text = f"您确认用以下信息报名吗？\n  姓名：{masked.get('name', '未填写')}\n  电话：{masked.get('phone_masked', '未填写')}\n  年龄：{masked.get('age', '未填写')}岁\n  岗位：{job_data.get('title', '')}\n信息无误请再点一次「确认报名」。"
        if hasattr(self, '_narrator') and self._narrator:
            ctx = build_apply_confirm_context(
                job_title=job_data.get('title', ''),
                company=job_data.get('company_name', ''),
                has_profile=bool(masked.get('name')),
            )
            narrated = await self._narrator.narrate(ctx)
            if narrated:
                reply_text = narrated + f"\n\n{reply_text}"

        return ChatResponse(
            type="apply_confirm",
            reply=reply_text,
            content={
                "text": reply_text,
                "job": job_data,
                "profile": masked,
                "confirm_token": confirm_token,
            },
            actions=[
                ActionButton(text="确认报名", type="submit_application",
                            data={"confirm_token": confirm_token}),
                ActionButton(text="取消", type="cancel", data={}),
            ],
            state=State.WAITING_APPLY_CONFIRM.value,
        )

    async def _do_submit(self, uid: str, session: dict, confirm_token: str = "") -> ChatResponse:
        """提交报名"""
        job = session.get("pending_job", {})
        job_id = job.get("job_id", "")
        sid = uid

        token = confirm_token or session.get("pending_confirm_token", "")
        result = submit_application(uid, job_id, token, sid)

        if result.get("success"):
            session["state"] = State.SUCCESS
            session["pending_job"] = None
            session["pending_confirm_token"] = ""
            job_title = job.get("title", "")
            success_reply = apply_success(job_title)
            if hasattr(self, '_narrator') and self._narrator:
                ctx = build_apply_success_context(job_title=job_title)
                narrated = await self._narrator.narrate(ctx)
                if narrated:
                    success_reply = narrated
            return ChatResponse(
                type="application_success",
                reply=success_reply,
                content={
                    "status": "success",
                    "title": "报名成功！",
                    "description": success_reply,
                },
                actions=[
                    ActionButton(text="查看我的报名", type="navigate",
                                data={"url": "/pages/c/my-applications/my-applications"}),
                    ActionButton(text="继续找工作", type="cancel", data={}),
                ],
                state=State.SUCCESS.value,
            )

        return ChatResponse(
            type="text",
            reply=result.get("error", "报名失败，请稍后再试。"),
            content={"text": result.get("error", "报名失败。")},
        )

    async def _handle_provide_info(self, msg: str, uid: str, session: dict) -> ChatResponse:
        """处理用户提供的个人信息"""
        extracted = self._extract_info(msg)
        profile = session.setdefault("profile", {})

        has_new = False
        for key, value in extracted.items():
            if value is not None and value != "":
                profile[key] = value
                has_new = True

        # COLLECTING_INFO 状态：收集报名资料
        if session.get("state") == State.COLLECTING_INFO:
            collected = session.get("collected_info", {})
            collected.update(extracted)
            session["collected_info"] = collected

            field_map = {"姓名": "name", "联系电话": "phone", "年龄": "age"}
            remaining = []
            for cn_field in session.get("collecting_fields", []):
                en_key = field_map.get(cn_field, cn_field)
                if not collected.get(en_key):
                    remaining.append(cn_field)

            if remaining:
                session["collecting_fields"] = remaining
                return ChatResponse(
                    type="collect_info",
                    reply=collect_info_prompt(remaining),
                    content={"text": collect_info_prompt(remaining), "missing_fields": remaining},
                )

            # 收齐了 → 准备报名
            session["state"] = State.WAITING_CONFIRM
            return await self._do_prepare_apply(uid, session)

        # 非报名流程：记录偏好
        if not has_new:
            return ChatResponse(type="text", reply="好的，记下了。", content={"text": "好的，记下了。"})

        return ChatResponse(type="text", reply=f"好的，记下了。", content={"text": "好的，记下了。"})

    async def _handle_cancel(self, session: dict) -> ChatResponse:
        """取消操作"""
        session["state"] = State.IDLE
        session["pending_job"] = None
        session["pending_confirm_token"] = ""
        session["collecting_fields"] = []
        session["collected_info"] = {}
        return ChatResponse(type="text", reply=cancel_apply(), content={"text": cancel_apply()})

    async def _handle_check_status(self, uid: str) -> ChatResponse:
        """查报名进度"""
        from agent.tools import get_application_status
        result = get_application_status.invoke({"user_id": uid})
        records = result.get("records", [])
        if not records:
            return ChatResponse(type="text", reply="您还没有报名记录。", content={"text": "您还没有报名记录。"})
        text = f"您有 {len(records)} 条报名记录：\n"
        for r in records:
            text += f"· {r.get('job_title', '')}（{r.get('company_name', '')}）— {r.get('status_text', '')}\n"
        return ChatResponse(type="text", reply=text, content={"text": text})

    async def _do_job_detail(self, slots: dict, session: dict) -> ChatResponse:
        """查看岗位详情"""
        from agent.tools import get_job_detail
        job_id = slots.get("job_id", "")
        if not job_id:
            return ChatResponse(type="text", reply="请指定要查看的岗位。", content={"text": "请指定要查看的岗位。"})
        result = get_job_detail.invoke({"job_id": job_id})
        job = result.get("job")
        if not job:
            return ChatResponse(type="text", reply="岗位不存在。", content={"text": "岗位不存在。"})
        return ChatResponse(type="job_detail", reply=job.get("title", ""),
                           content={"job": job},
                           actions=[ActionButton(text="报名", type="confirm", data={"action": "apply", "job_id": job_id})])

    async def _llm_chat(self, msg: str, session: dict) -> ChatResponse:
        """LLM 闲聊"""
        try:
            history = session.get("history", [])[-6:]
            messages = [{"role": "system", "content": "你是智汇小玉，一个面向大龄求职者的语音就业助手。请用简短、口语化的方式回复。"}]
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
            reply = await self._vivo.chat(messages)
        except Exception as e:
            logger.error("LLM 闲聊失败: %s", e)
            reply = "您好，有什么可以帮您的吗？"
        return ChatResponse(type="text", reply=reply, content={"text": reply})

    # ─── 工具 ───────────────────────────────────────────

    @staticmethod
    def _extract_info(msg: str) -> dict:
        """从自然语言中提取姓名/年龄/电话"""
        import re
        info = {}
        m = re.search(r'(?:我叫|我是|姓)(\S{1,6})(?:[，,\s]|今年|电话|$)', msg)
        if m:
            info["name"] = m.group(1).strip()
        m = re.search(r'(?:今年|年龄|岁数|都)?(\d{1,3})(?:\s*岁|岁了)', msg)
        if m:
            age = int(m.group(1))
            if 16 <= age <= 100:
                info["age"] = age
        if "age" not in info:
            m = re.search(r'(?:今年|年龄)(\d{1,3})(?:\s*$|[\s,，])', msg)
            if m:
                age = int(m.group(1))
                if 16 <= age <= 100:
                    info["age"] = age
        if "age" not in info:
            m = re.search(r'(?:今年|都)?(\d{2})\s*了', msg)
            if m:
                age = int(m.group(1))
                if 16 <= age <= 80:
                    info["age"] = age
        m = re.search(r'(1[3-9]\d{9})', msg)
        if m:
            info["phone"] = m.group(1)
        return info
