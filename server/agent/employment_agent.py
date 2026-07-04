"""
智汇小玉 — 就业服务 Agent（状态机版本）

业务决策由规则控制（状态机 + 工具调用）
语言表达由模板生成（适老化、口语化）

状态机：IDLE → SHOWING_JOBS → WAITING_CONFIRM → COLLECTING_INFO → SUBMITTING → SUCCESS
"""

import json
import logging
import re
from typing import Optional

from config import settings
from agent.state import State
from agent.intent_detector import detect as detect_intent
from agent.slot_extractor import extract_slots
from agent.safety_guard import guard
from agent.profile_memory import update_profile, has_enough_for_recommend, get_profile_summary, extract_work_environment, extract_job_preferences
from agent.recommender import recommend as recommender_recommend
from agent.templates import (
    greeting, help_text, no_jobs, job_search_result, confirm_apply,
    collect_info_prompt, apply_success, apply_fail,
    no_last_jobs, invalid_index, cancel_apply, small_talk_reply,
)
from agent.tools import (
    search_jobs,
    get_job_detail,
    apply_job,
    get_application_status,
    get_user_profile,
)
from services.retriever import retrieve
from .prompts import SYSTEM_PROMPT
from models.chat_schemas import ChatResponse, ActionButton

logger = logging.getLogger(__name__)


class EmploymentAgent:
    """就业服务 Agent — 状态机驱动 + 模板表达"""

    def __init__(self):
        self._use_llm = False
        self.tools = [
            search_jobs, get_job_detail, apply_job,
            get_application_status, get_user_profile,
        ]

        # LLM 模式（vivo AI）
        if settings.VIVO_APP_KEY and settings.VIVO_APP_KEY not in ("", "你的AppKey"):
            try:
                from services.vivo_llm import VivoLLMClient
                self.vivo = VivoLLMClient(settings)
                self._use_llm = True
                logger.info("vivo AI 大模型已初始化（%s）", settings.VIVO_MODEL)
            except Exception as e:
                logger.warning("vivo AI 初始化失败: %s，使用规则回退模式", e)
        else:
            logger.info("VIVO_APP_KEY 未配置，使用规则回退模式")

        self._sessions: dict = {}

    # ─── 公开接口 ──────────────────────────────────────────

    def process(self, user_id: str, message: str,
                location: Optional[dict] = None,
                session_id: str = "") -> ChatResponse:
        """处理用户消息 → 状态机 → 结构化响应"""
        sid = session_id or user_id
        session = self._get_or_create_session(sid, user_id)

        if location:
            session["location"] = location

        session["history"].append({"role": "user", "content": message})

        # 每次消息都尝试富集用户画像
        self._enrich_profile(message, session)

        # 如果 session 中缺少年龄等关键信息，尝试从数据库拉取
        profile = session.setdefault("profile", {})
        has_account = profile.get("name") or profile.get("phone")
        if user_id and (not profile.get("age") or (not has_account and not profile.get("idNumber"))):
            dbp = self._get_user_info(user_id)
            if dbp:
                for k in ["age", "gender", "name", "phone", "idNumber"]:
                    if dbp.get(k) and not profile.get(k):
                        profile[k] = dbp[k]

        # 先做意图识别：操作类走规则系统（有真实数据），闲聊类走 LLM
        intent_info = detect_intent(message)
        intent = intent_info.get("intent", "")
        ACTION_INTENTS = {"search_job", "recommend_job", "apply_job_by_id", "apply_job_by_index",
                          "job_detail", "confirm_apply", "cancel_apply", "provide_info",
                          "application_status", "policy_query", "interview_query"}
        if self._use_llm and intent not in ACTION_INTENTS:
            try:
                response = self._llm_process(message, session)
            except Exception as e:
                logger.warning("LLM 处理失败，降级到规则模式: %s", e)
                response = self._rule_process(message, user_id, session)
        else:
            response = self._rule_process(message, user_id, session)

        session["history"].append({"role": "assistant", "content": response.reply})
        return response

    def set_pending_apply(self, user_id: str, job_id: str, session_id: str = ""):
        """设置待报名岗位（供 /api/agent/confirm 按钮使用）"""
        sid = session_id or user_id
        session = self._get_or_create_session(sid, user_id)
        job = get_job_detail.invoke({"job_id": job_id}).get("job")
        if job:
            session["pending_job"] = job
            session["state"] = State.WAITING_CONFIRM

    # ─── 会话管理 ──────────────────────────────────────────

    def _get_or_create_session(self, sid: str, uid: str) -> dict:
        if sid not in self._sessions:
            self._sessions[sid] = {
                "user_id": uid,
                "state": State.IDLE,
                "history": [],
                "last_jobs": [],
                "pending_job": None,
                "collecting_fields": [],
                "collected_info": {},
                "profile": {},               # 持久化用户资料 {age, name, phone, job_types}
                "location": None,
                "created_at": __import__("time").time(),
            }
        return self._sessions[sid]

    # ─── 从消息中提取个人信息 ──────────────────────────────

    def _extract_info(self, msg: str) -> dict:
        """从自然语言中提取姓名/年龄/电话"""
        info = {}

        # 姓名：我叫XXX / 我是XXX / 姓X
        m = re.search(r'(?:我叫|我是|姓)(\S{1,6})(?:[，,\s]|今年|电话|$)', msg)
        if m:
            info["name"] = m.group(1).strip()

        # 年龄：XX岁 / 今年XX / 50了 / 今年62
        m = re.search(r'(?:今年|年龄|岁数|都)?(\d{1,3})(?:\s*岁|岁了)', msg)
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
        if "age" not in info:
            # 口语省略"岁"：我今年62 / 62了
            m = re.search(r'(?:今年|年龄)(\d{1,3})(?:\s*$|[\s,，]|的|，)', msg)
            if m:
                age = int(m.group(1))
                if 16 <= age <= 100:
                    info["age"] = age

        # 电话：11位数字
        m = re.search(r'(1[3-9]\d{9})', msg)
        if m:
            info["phone"] = m.group(1)

        return info

    # ─── 状态驱动处理 ──────────────────────────────────────

    def _rule_process(self, message: str, user_id: str, session: dict) -> ChatResponse:
        """规则模式：三层意图 + 可中断状态机"""
        msg = message.strip()
        intent_info = detect_intent(msg)
        intent = intent_info["intent"]
        params = intent_info["params"]
        state = session.get("state", State.IDLE)

        logger.info("[状态机] state=%s, intent=%s (layer=%s)", state.value, intent, intent_info.get("layer", 0))

        # ── 注入检查 ──
        if guard.check_injection(msg):
            return ChatResponse(
                type="text",
                reply="为了您的账号安全，我没有执行这个操作。请问您需要找工作还是查报名进度？",
                content={"text": "操作已取消。请问您需要找工作还是查报名进度？"},
            )

        # ── 提供个人信息（任何状态下都优先处理） ──
        if intent == "provide_info":
            return self._handle_provide_info(msg, user_id, session)

        # ── 可中断操作（任何状态下都能响应，不丢上下文） ──
        interruption = self._handle_interruption(intent, params, msg, session)
        if interruption:
            return interruption

        # ── 按状态分发 ──
        if state == State.IDLE or state == State.SUCCESS:
            return self._handle_idle(intent, params, msg, user_id, session)

        if state == State.SHOWING_JOBS:
            return self._handle_showing_jobs(intent, params, msg, user_id, session)

        if state == State.WAITING_CONFIRM:
            return self._handle_waiting_confirm(intent, params, msg, user_id, session)

        if state == State.COLLECTING_INFO:
            return self._handle_collecting_info(intent, params, msg, user_id, session)

        if state == State.SUBMITTING:
            return self._handle_submitting(intent, params, msg, user_id, session)

        return self._handle_idle(intent, params, msg, user_id, session)

    # ─── 用户画像富集（每次消息都尝试提取信息） ──────────────

    def _enrich_profile(self, msg: str, session: dict):
        """从用户消息中提取 profile 信息并保存"""
        profile = session.setdefault("profile", {})

        age_info = self._extract_info(msg)
        if age_info.get("age"):
            profile["age"] = age_info["age"]

        env = extract_work_environment(msg)
        if env:
            profile["work_environment"] = env

        prefs = extract_job_preferences(msg)
        if prefs:
            existing = profile.get("job_preferences", [])
            for p in prefs:
                if p not in existing:
                    existing.append(p)
            profile["job_preferences"] = existing

    # ─── 中断处理器（任何状态都能响应） ──────────────────────

    def _handle_interruption(self, intent: str, params: dict, msg: str,
                              session: dict) -> Optional[ChatResponse]:
        """
        处理可中断操作。
        这些操作在任何状态下都能响应，且不影响主任务状态。
        返回 None 表示当前 intent 不是中断类型。
        """
        if intent == "search_job":
            # 搜索会重置状态
            return None

        if intent == "recommend_job":
            return self._do_recommend(session)

        if intent == "provide_info":
            # provide_info 已在顶层处理，这里不重复
            return None

        if intent == "job_detail":
            job_id = params.get("job_id", "")
            if job_id:
                return self._do_job_detail(job_id, session)
            idx = _chinese_to_int_from_params(params)
            if idx:
                return self._do_job_detail_by_index(idx, session)
            return self._do_job_detail_by_index(1, session)

        if intent == "policy_query":
            return self._do_policy_query(params.get("text", msg))

        if intent == "interview_query":
            return ChatResponse(
                type="text",
                reply="您想查面试安排对吗？请先告诉我您的姓名或报名编号。",
                content={"text": "您想查面试安排对吗？请先告诉我您的姓名或报名编号。"},
            )

        if intent == "small_talk":
            return ChatResponse(
                type="text",
                reply=small_talk_reply(msg),
                content={"text": small_talk_reply(msg)},
            )

        if intent == "greeting":
            return ChatResponse(
                type="text",
                reply="您好。有什么需要帮忙的？找工作、查岗位、报名都可以。",
                content={"text": "您好。有什么需要帮忙的？"},
            )

        if intent == "application_status":
            return self._do_check_status(session.get("user_id", ""))

        # 取消在任何状态下都处理（但不同状态处理方式不同）
        if intent == "cancel_apply":
            if session.get("state") in (State.WAITING_CONFIRM, State.COLLECTING_INFO):
                # 清除待报名状态，回到 IDLE
                session["state"] = State.IDLE
                session["pending_job"] = None
                session["collecting_fields"] = []
                session["collected_info"] = {}
                return ChatResponse(
                    type="text",
                    reply=cancel_apply(),
                    content={"text": cancel_apply()},
                )
            # 其他状态下取消没意义
            return ChatResponse(
                type="text",
                reply="当前没有需要取消的操作。您想找工作还是查报名？",
                content={"text": "当前没有需要取消的操作。"},
            )

        return None

    # ─── 各状态处理器 ──────────────────────────────────────

    def _handle_idle(self, intent: str, params: dict, msg: str,
                      uid: str, session: dict) -> ChatResponse:
        """IDLE 状态：搜索和报名入口（其他意图由中断处理器管理）"""
        session["state"] = State.IDLE

        if intent == "search_job":
            return self._do_search(msg, session, params)

        if intent == "apply_job_by_id":
            return self._do_apply_by_id(params.get("job_id", ""), session)

        if intent == "apply_job_by_index":
            return self._do_apply_by_index(params.get("index", 0), session)

        return ChatResponse(
            type="text",
            reply=help_text(),
            content={"text": help_text()},
        )

    def _handle_showing_jobs(self, intent: str, params: dict, msg: str,
                              uid: str, session: dict) -> ChatResponse:
        """SHOWING_JOBS：选岗 / 重新搜索（中断操作已由 _handle_interruption 处理）"""
        if intent == "search_job":
            return self._do_search(msg, session, params)

        if intent == "apply_job_by_index":
            return self._do_apply_by_index(params.get("index", 0), session)

        if intent == "apply_job_by_id":
            return self._do_apply_by_id(params.get("job_id", ""), session)

        if intent == "cancel_apply":
            session["state"] = State.IDLE
            return ChatResponse(type="text", reply="好的。需要找工作再告诉我。", content={"text": "好的。需要找工作再告诉我。"})

        return ChatResponse(
            type="text",
            reply="您可以从上面选一个岗位，说「报名第一个」。或者换个条件再搜。",
            content={"text": "您可以从上面选一个岗位，说「报名第一个」。或者换个条件再搜。"},
        )

    def _handle_waiting_confirm(self, intent: str, params: dict, msg: str,
                                 uid: str, session: dict) -> ChatResponse:
        """WAITING_CONFIRM：确认 / 取消（中断操作已由 _handle_interruption 处理）"""
        if intent == "confirm_apply":
            job = session.get("pending_job", {})
            err = guard.check_apply_prerequisites("waiting_confirm", job)
            if err:
                return ChatResponse(type="text", reply=err, content={"text": err})

            # 已展示过信息概览，用户再次确认 → 直接报名
            if session.get("profile_reviewed"):
                session["profile_reviewed"] = False
                return self._do_submit_apply(uid, job, session)

            # 第一次确认：拉取用户信息，展示给用户确认（缺的显示"未填写"）
            profile = self._get_user_info(uid)
            name = profile.get("name", "") or session.get("profile", {}).get("name", "")
            phone = profile.get("phone", "") or session.get("profile", {}).get("phone", "")
            age = profile.get("age", "") or session.get("profile", {}).get("age", "")
            name_display = name if name else "未填写"
            phone_display = phone if phone else "未填写"
            age_display = f"{age}岁" if age else "未填写"
            job_title = job.get("title", "该岗位")
            company = job.get("company_name", "")

            session["profile_reviewed"] = True
            summary = (
                f"您确认用以下信息报名吗？\n"
                f"  姓名：{name}\n"
                f"  电话：{phone}\n"
                f"  年龄：{age}岁\n"
                f"  岗位：{job_title}"
                + (f"（{company}）" if company else "")
                + "\n信息无误请再点一次「确认报名」。"
            )
            return ChatResponse(
                type="confirmation",
                reply=summary,
                content={
                    "text": summary,
                    "job": job,
                    "profile": {"name": name, "phone": phone, "age": age},
                },
                actions=[
                    ActionButton(text="确认报名", type="confirm", data={"action": "apply"}),
                    ActionButton(text="取消", type="cancel", data={}),
                ],
            )

        if intent == "cancel_apply":
            session["state"] = State.IDLE
            session["pending_job"] = None
            return ChatResponse(
                type="text",
                reply=cancel_apply(),
                content={"text": cancel_apply()},
            )

        if intent == "search_job":
            return self._do_search(msg, session, params)

        return ChatResponse(
            type="text",
            reply="请确认是否报名？说「确认」或「取消」。",
            content={"text": "请确认是否报名？说「确认」或「取消」。", "state_hint": "waiting_confirm"},
        )

    def _handle_provide_info(self, msg: str, uid: str, session: dict) -> ChatResponse:
        """
        处理用户提供的个人信息——任何状态下都响应。

        行为：
          - 把信息保存到 session.profile（持久化）
          - 明确复述已记录的信息
          - 告诉用户信息会怎么影响筛选
          - 只追问下一项最必要的信息
          - 不在提供信息状态时，也做信息承接式回复
        """
        # 从消息中提取信息
        extracted = self._extract_info(msg)
        state = session.get("state", State.IDLE)

        # 更新持久化 profile
        profile = session.setdefault("profile", {})
        has_new_info = False
        for key, value in extracted.items():
            if value is not None and value != "":
                profile[key] = value
                has_new_info = True

        # 空提取 → 检查是否是环境/偏好类信息（已被 _enrich_profile 保存）
        if not has_new_info:
            profile = session.get("profile", {})
            env = profile.get("work_environment")
            prefs = profile.get("job_preferences", [])

            if env:
                env_text = {"indoor": "室内", "outdoor": "室外", "greenhouse": "大棚/温室"}.get(env, env)
                hint = f"好的，记下了：您想找{env_text}的工作。"
                if prefs:
                    hint += f"我帮您找找{prefs[-1]}相关的岗位。"
                    return self._do_recommend(session)
                hint += "您想找哪一类工作？保安、保洁还是别的？"
                return ChatResponse(type="text", reply=hint, content={"text": hint})

            if prefs:
                return ChatResponse(
                    type="text",
                    reply=f"好的，记下了：您想做{prefs[-1]}类工作。我帮您看看有没有合适的。",
                    content={"text": f"记下了：想做{prefs[-1]}类工作。"},
                )

            hint = "我没听清楚，请再说一遍。比如：我今年50岁，或者：我叫王建国。"
            return ChatResponse(
                type="text",
                reply=hint,
                content={"text": hint},
            )

        # 校验
        errors = guard.validate_user_info(extracted)
        if errors:
            return ChatResponse(
                type="text",
                reply=f"信息有误：{'、'.join(errors)}。请重新说一下。",
                content={"text": f"信息有误：{'、'.join(errors)}。请重新说一下。"},
            )

        # ── COLLECTING_INFO 状态下：报名资料收集流程 ──
        if state == State.COLLECTING_INFO:
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
                    content={
                        "text": collect_info_prompt(remaining),
                        "missing_fields": remaining,
                        "collected": {k: v for k, v in collected.items() if v},
                    },
                )
            # 收齐了，提交
            session["state"] = State.SUBMITTING
            job = session.get("pending_job", {})
            return self._do_submit_apply(uid, job, session)

        # ── 非报名流程：信息承接式回复 ──
        age = profile.get("age")
        job_type = profile.get("job_type")
        name = profile.get("name")

        # 情况1：提供了年龄
        if "age" in extracted and age:
            reply = (
                f"知道了，我记下来了：您今年 {age} 岁。\n"
                "我会优先帮您筛选年龄合适、工作稳定的岗位。"
            )
            if not job_type:
                reply += "\n您以前做过哪类工作？"
                return ChatResponse(
                    type="text",
                    reply=reply,
                    content={"text": reply, "profile_preview": f"年龄：{age}岁"},
                    actions=[
                        ActionButton(text="保安门卫", type="confirm", data={"action": "search_security"}),
                        ActionButton(text="保洁", type="confirm", data={"action": "search_cleaning"}),
                        ActionButton(text="工厂普工", type="confirm", data={"action": "search_factory"}),
                        ActionButton(text="物流分拣", type="confirm", data={"action": "search_logistics"}),
                    ],
                )
            return ChatResponse(
                type="text",
                reply=reply + f"\n您想找{job_type}类的工作，我现在帮您搜。要现在搜索吗？",
                content={"text": reply, "profile_preview": f"年龄：{age}岁"},
            )

        # 情况2：提供了工种偏好（独立提供，非搜索时）
        if "job_type" in extracted and job_type:
            age_info = f"您 {age} 岁，" if age else ""
            reply = f"好的，{age_info}想找{job_type}类的工作。我帮您搜索一下？"
            return ChatResponse(
                type="text",
                reply=reply,
                content={"text": reply},
                actions=[
                    ActionButton(text="搜一下", type="confirm", data={"action": "search_job_type", "kw": job_type}),
                    ActionButton(text="换一种", type="cancel", data={}),
                ],
            )

        # 情况3：提供了电话或姓名
        if "phone" in extracted:
            return ChatResponse(
                type="text",
                reply="好的，电话记下了。您想找什么样的工作？",
                content={"text": "好的，电话记下了。"},
            )
        if name:
            return ChatResponse(
                type="text",
                reply=f"好的，{name}。您想找什么样的工作？",
                content={"text": f"好的，{name}。您想找什么样的工作？"},
            )

        # fallback
        return ChatResponse(
            type="text",
            reply="好的，我记下来了。您想找什么样的工作？",
            content={"text": "好的，我记下来了。您想找什么样的工作？"},
        )

        if remaining:
            session["collecting_fields"] = remaining
            return ChatResponse(
                type="collect_info",
                reply=collect_info_prompt(remaining),
                content={
                    "text": collect_info_prompt(remaining),
                    "missing_fields": remaining,
                    "collected": {k: v for k, v in collected.items() if v},
                },
            )

        # 收齐了，提交
        session["state"] = State.SUBMITTING
        job = session.get("pending_job", {})
        return self._do_submit_apply(uid, job, session)

    def _handle_collecting_info(self, intent: str, params: dict, msg: str,
                                 uid: str, session: dict) -> ChatResponse:
        """COLLECTING_INFO：收资料（provide_info 由 _handle_provide_info 处理）"""
        if intent == "provide_info":
            return self._handle_provide_info(msg, uid, session)

        missing = session.get("collecting_fields", [])
        return ChatResponse(
            type="collect_info",
            reply=collect_info_prompt(missing),
            content={"text": collect_info_prompt(missing), "missing_fields": missing},
        )

    def _handle_submitting(self, intent: str, params: dict, msg: str,
                            uid: str, session: dict) -> ChatResponse:
        """SUBMITTING：结果已返回，用户说啥都回成功页"""
        # 此时 apply_job 已经调过了，结果在 session 里
        result = session.get("last_result", {"success": True, "job_title": ""})
        session["state"] = State.SUCCESS

        if result.get("success"):
            return ChatResponse(
                type="result",
                reply=apply_success(result.get("job_title", "")),
                content={
                    "status": "success",
                    "title": "报名成功！",
                    "description": apply_success(result.get("job_title", "")),
                },
                actions=[
                    ActionButton(text="查看我的报名", type="navigate",
                                 data={"url": "/pages/c/my-applications/my-applications"}),
                    ActionButton(text="继续找工作", type="cancel", data={}),
                ],
            )
        else:
            return ChatResponse(
                type="result",
                reply=apply_fail(result.get("error", "")),
                content={
                    "status": "error",
                    "title": "报名失败",
                    "description": apply_fail(result.get("error", "")),
                },
            )

    # ─── 核心动作 ──────────────────────────────────────────

    def _do_recommend(self, session: dict) -> ChatResponse:
        """推荐岗位：有画像按画像推荐，没画像直接展示全部岗位（永不提问）"""
        profile = session.setdefault("profile", {})

        if has_enough_for_recommend(profile):
            result = recommender_recommend(profile)
            if result.get("jobs"):
                jobs = result["jobs"]
                summary = result["summary"]
                actions = []
                for i, job in enumerate(jobs[:5]):
                    idx_label = ['一', '二', '三', '四', '五'][i]
                    actions.append(ActionButton(
                        text=f"报名第{idx_label}个",
                        type="confirm",
                        data={"action": "select_job", "index": i + 1, "job_id": job["job_id"]},
                    ))
                if result.get("next_hint"):
                    actions.append(ActionButton(text="换一批", type="cancel", data={}))
                session["state"] = State.SHOWING_JOBS
                session["last_jobs"] = jobs
                session["pending_job"] = None
                return ChatResponse(
                    type="job_list",
                    reply=summary,
                    content={"summary": summary, "jobs": jobs, "intro": result.get("intro", "")},
                    actions=actions,
                )

        # 没画像或推荐无结果 → 展示全部岗位（绝不提问）
        return self._do_search("", session)

    def _do_search(self, msg: str, session: dict, params: dict = None) -> ChatResponse:
        """执行搜索，优先用意图检测的 keywords，兜底展示全部岗位"""
        kw = ""
        profile = session.setdefault("profile", {})

        # ── 第一优先：使用意图检测的 keywords ──
        if params and params.get("keywords"):
            keywords = params["keywords"]
            # 过滤掉泛词（工作/岗位/活等），只保留具体工种
            GENERIC = {"工作", "岗位", "活", "场子", "厂子", "附近"}
            specific = [k for k in keywords if k not in GENERIC]
            if specific:
                kw = specific[0]

        # ── 第二优先：消息中的具体工种关键词 ──
        if not kw:
            if "保安" in msg or "门卫" in msg:
                kw = "保安"
            elif "保洁" in msg or "清洁" in msg or "打扫" in msg:
                kw = "保洁"
            elif "搬运" in msg or "装卸" in msg:
                kw = "搬运工"
            elif "建筑" in msg or "工地" in msg:
                kw = "建筑工"
            elif "家政" in msg or "保姆" in msg:
                kw = "家政"
            elif "工厂" in msg or "普工" in msg:
                kw = "工厂"
            elif "物流" in msg or "分拣" in msg or "快递" in msg:
                kw = "物流"
            elif "厨师" in msg or "做饭" in msg:
                kw = "厨师"
            elif "司机" in msg or "开车" in msg:
                kw = "司机"
            elif "采摘" in msg or "包装" in msg:
                kw = "采摘"

        # ── 第三优先：检查 profile 中的画像 ──
        if not kw:
            kw = profile.get("job_type", "")

        # ── 若有 age+工种偏好 → 走推荐引擎，更个性化 ──
        if kw and profile.get("age"):
            return self._do_recommend(session)

        # 模糊工种：用户说"场子里"之类
        if not kw and any(w in msg for w in ["场子", "那里", "那个", "这边"]):
            return ChatResponse(
                type="text",
                reply="您说的这个地方，是工厂、物流园，还是工地？我帮您选一下。",
                content={"text": "您说的这个地方，是工厂、物流园，还是工地？"},
                actions=[
                    ActionButton(text="工厂", type="confirm", data={"action": "search_factory"}),
                    ActionButton(text="物流园", type="confirm", data={"action": "search_logistics"}),
                    ActionButton(text="工地", type="confirm", data={"action": "search_construction"}),
                ],
            )

        # ── 无关键词 → 展示全部岗位（按时间倒序） ──
        result = search_jobs.invoke({
            "keyword": kw,
            "min_salary": 0,
            "provide_food": "包吃" in msg,
            "provide_housing": "包住" in msg or "住宿" in msg,
        })

        jobs = result.get("jobs", [])

        if not jobs:
            # 关键词搜不到时，尝试用工种分类找相近岗位
            if kw and not jobs:
                from agent.profile_memory import JOB_CATEGORIES
                cat = JOB_CATEGORIES.get(kw)
                if cat:
                    # 找同分类的关键词替代搜索
                    siblings = [k for k, v in JOB_CATEGORIES.items() if v == cat and k != kw]
                    for sibling in siblings:
                        result2 = search_jobs.invoke({"keyword": sibling, "min_salary": 0})
                        jobs = result2.get("jobs", [])
                        if jobs:
                            kw = sibling
                            break

        if not jobs:
            session["state"] = State.IDLE
            if kw:
                reply = no_jobs(kw)
            else:
                reply = "目前还没有发布岗位，您可以稍后再来看看。"
            return ChatResponse(type="text", reply=reply, content={"text": reply})

        session["state"] = State.SHOWING_JOBS
        session["last_jobs"] = jobs
        session["pending_job"] = None

        actions = []
        for i, job in enumerate(jobs[:5]):
            idx_label = ['一', '二', '三', '四', '五'][i]
            actions.append(ActionButton(
                text=f"报名第{idx_label}个",
                type="confirm",
                data={"action": "select_job", "index": i + 1, "job_id": job["job_id"]},
            ))

        if len(jobs) > 5:
            actions.append(ActionButton(text="查看更多", type="cancel", data={}))

        return ChatResponse(
            type="job_list",
            reply=job_search_result(jobs, kw),
            content={"summary": job_search_result(jobs, kw), "jobs": jobs},
            actions=actions,
        )

    def _do_apply_by_index(self, index: int, session: dict) -> ChatResponse:
        """按序号选岗位报名——从 session.last_jobs 取"""
        jobs = session.get("last_jobs", [])
        if not jobs:
            session["state"] = State.IDLE
            return ChatResponse(type="text", reply=no_last_jobs(), content={"text": no_last_jobs()})

        if index < 1 or index > len(jobs):
            return ChatResponse(
                type="text",
                reply=invalid_index(len(jobs)),
                content={"text": invalid_index(len(jobs))},
            )

        job = jobs[index - 1]
        session["state"] = State.WAITING_CONFIRM
        session["pending_job"] = job

        return ChatResponse(
            type="confirm_apply",
            reply=confirm_apply(job, index),
            content={
                "text": confirm_apply(job, index),
                "job": job,
                "index": index,
            },
            actions=[
                ActionButton(text="确认报名", type="confirm",
                             data={"action": "apply", "job_id": job["job_id"]}),
                ActionButton(text="取消", type="cancel", data={}),
            ],
        )

    def _do_apply_by_id(self, job_id: str, session: dict) -> ChatResponse:
        """按岗位编号直接报名——直接查数据库，不走搜索"""
        if not job_id:
            return ChatResponse(
                type="text",
                reply="请告诉我岗位编号，比如 J1003。",
                content={"text": "请告诉我岗位编号，比如 J1003。"},
            )

        # 从数据库直接查
        result = get_job_detail.invoke({"job_id": job_id})
        job_data = result.get("job") if isinstance(result, dict) else None

        if not job_data:
            return ChatResponse(
                type="text",
                reply=f"没有找到编号为 {job_id} 的岗位，请检查编号是否正确。",
                content={"text": f"没有找到编号为 {job_id} 的岗位，请检查编号是否正确。"},
            )

        session["state"] = State.WAITING_CONFIRM
        session["pending_job"] = job_data

        return ChatResponse(
            type="confirm_apply",
            reply=confirm_apply(job_data, 0),
            content={
                "text": confirm_apply(job_data, 0),
                "job": job_data,
            },
            actions=[
                ActionButton(text="确认报名", type="confirm",
                             data={"action": "apply", "job_id": job_id}),
                ActionButton(text="取消", type="cancel", data={}),
            ],
        )

    def _do_job_detail(self, job_id: str, session: dict) -> ChatResponse:
        """查看岗位详情"""
        result = get_job_detail.invoke({"job_id": job_id})
        job_data = result.get("job") if isinstance(result, dict) else None
        if not job_data:
            return ChatResponse(
                type="text",
                reply="没有找到这个岗位的信息。",
                content={"text": "没有找到这个岗位的信息。"},
            )
        return ChatResponse(
            type="job_detail",
            reply=f"{job_data['title']}，{job_data['salary']}。{job_data.get('company_name', '')}",
            content={"job": job_data, "text": ""},
            actions=[ActionButton(text="报名这个岗位", type="confirm",
                                  data={"action": "apply", "job_id": job_id})],
        )

    def _do_job_detail_by_index(self, index: int, session: dict) -> ChatResponse:
        """按序号查看岗位详情"""
        jobs = session.get("last_jobs", [])
        if not jobs:
            return ChatResponse(type="text", reply=no_last_jobs(), content={"text": no_last_jobs()})
        if index < 1 or index > len(jobs):
            return ChatResponse(type="text", reply=invalid_index(len(jobs)),
                                content={"text": invalid_index(len(jobs))})
        return self._do_job_detail(jobs[index - 1]["job_id"], session)

    def _do_check_status(self, uid: str) -> ChatResponse:
        """查报名进度"""
        result = get_application_status.invoke({"user_id": uid})
        records = result.get("records", [])
        if records:
            lines = [f"您有 {len(records)} 条报名记录："]
            for r in records[:5]:
                lines.append(f"· {r['job_title']} — {r['status_text']}")
            reply = "\n".join(lines)
        else:
            reply = "您还没有报名记录。"
        return ChatResponse(type="text", reply=reply, content={"text": reply})

    def _do_policy_query(self, query: str) -> ChatResponse:
        """政策/知识查询 — 从知识库检索，不编造"""
        results = retrieve(query, top_k=1)
        if not results:
            return ChatResponse(
                type="text",
                reply="这个问题我暂时回答不了，您可以打12333咨询人社局。",
                content={"text": "这个问题我暂时回答不了，您可以打12333咨询人社局。"},
            )

        doc = results[0]
        # 知识卡片：标题 + 内容
        reply = f"【{doc['title']}】\n{doc['content']}"
        return ChatResponse(
            type="text",
            reply=reply,
            content={"text": reply},
        )

    def _do_submit_apply(self, uid: str, job: dict, session: dict) -> ChatResponse:
        """提交报名"""
        if not job:
            session["state"] = State.IDLE
            return ChatResponse(type="text", reply="请先选择要报名的岗位。", content={"text": "请先选择要报名的岗位。"})

        collected = session.get("collected_info", {})
        profile = self._get_user_info(uid)
        profile.update(collected)

        result = apply_job.invoke({
            "job_id": job.get("job_id", ""),
            "user_id": uid,
            "user_name": profile.get("name", ""),
            "user_phone": profile.get("phone", ""),
            "user_age": profile.get("age"),
        })

        session["last_result"] = result
        session["state"] = State.SUBMITTING

        if result.get("need_info"):
            missing = result.get("missing_fields", [])
            session["state"] = State.COLLECTING_INFO
            session["collecting_fields"] = missing
            session["collected_info"] = profile
            return ChatResponse(
                type="collect_info",
                reply=result.get("prompt", collect_info_prompt(missing)),
                content={
                    "text": result.get("prompt", collect_info_prompt(missing)),
                    "missing_fields": missing,
                },
            )

        if result.get("success"):
            session["state"] = State.SUCCESS
            return ChatResponse(
                type="result",
                reply=apply_success(job.get("title", "")),
                content={
                    "status": "success",
                    "title": "报名成功！",
                    "description": apply_success(job.get("title", "")),
                },
                actions=[
                    ActionButton(text="查看我的报名", type="navigate",
                                 data={"url": "/pages/c/my-applications/my-applications"}),
                    ActionButton(text="继续找工作", type="cancel", data={}),
                ],
            )
        else:
            session["state"] = State.IDLE
            return ChatResponse(
                type="result",
                reply=apply_fail(result.get("error", "")),
                content={
                    "status": "error",
                    "title": "报名失败",
                    "description": apply_fail(result.get("error", "")),
                },
            )

    # ─── 辅助 ──────────────────────────────────────────────

    @staticmethod
    def _check_missing_fields(profile: dict) -> list:
        """检查缺少哪些报名必需字段（有身份证号可算年龄，不用问）"""
        missing = []
        if not profile.get("name"):
            missing.append("姓名")
        if not profile.get("phone"):
            missing.append("联系电话")
        if not profile.get("age") and not profile.get("idNumber"):
            missing.append("年龄")
        return missing

    def _get_user_info(self, uid: str) -> dict:
        try:
            result = get_user_profile.invoke({"user_id": uid})
            return result.get("profile", {})
        except Exception:
            return {}

    # ─── LLM 模式 ──────────────────────────────────────────

    def _llm_process(self, message: str, session: dict) -> ChatResponse:
        """调用 vivo AI 大模型生成回复（工具调用由规则系统处理）"""
        try:
            history = session.get("history", [])[-6:]
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": message})

            reply = self.vivo.chat(messages)
        except Exception as e:
            logger.error("vivo AI 调用失败: %s", e)
            reply = "服务暂时不可用，请稍后再试。"

        return ChatResponse(type="text", reply=reply, content={"text": reply})

    def _build_llm_response(self, output: str, tool_results: dict) -> ChatResponse:
        # 优先使用工具返回的真实数据生成回复，避免 LLM 编造
        if "search_jobs" in tool_results:
            data = tool_results["search_jobs"]
            jobs = data.get("jobs", []) if isinstance(data, dict) else []
            if jobs:
                return ChatResponse(
                    type="job_list",
                    reply=job_search_result(jobs),
                    content={"summary": output, "jobs": jobs},
                )
            else:
                # 工具返回空结果 — 用模板告知用户，不信任 LLM 输出
                keyword = (data or {}).get("keyword", "")
                return ChatResponse(
                    type="text",
                    reply=no_jobs(keyword),
                    content={"text": no_jobs(keyword)},
                )
        if "apply_job" in tool_results:
            data = tool_results["apply_job"]
            if isinstance(data, dict) and data.get("success"):
                # 工具返回的 message 包含岗位名称，如"报名成功！已成功报名【小区保安】..."
                title = data.get("message", "")
                # 尝试从 message 中提取岗位名称
                m = re.search(r'报名[^，。]*?([^，。]+?)(?:，|。|$)', title)
                job_title = m.group(1) if m else ""
                return ChatResponse(
                    type="result",
                    reply=apply_success(job_title),
                    content={"status": "success", "title": "报名成功！", "description": apply_success(job_title)},
                )
        # 没有工具结果 — LLM 可能未调用工具直接回复（如问候、闲聊）
        # 此时没有工具数据可编造，直接使用 LLM 输出
        return ChatResponse(type="text", reply=output, content={"text": output})


# 全局单例
_agent: Optional[EmploymentAgent] = None


def get_agent() -> EmploymentAgent:
    global _agent
    if _agent is None:
        _agent = EmploymentAgent()
    return _agent


def _chinese_to_int_from_params(params: dict) -> Optional[int]:
    """从 params 中提取数字索引"""
    idx = params.get("index")
    if idx:
        return idx
    text = params.get("index_text", "")
    if not text:
        return None
    m = re.search(r'\d+', text)
    if m:
        return int(m.group())
    cn_map = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5}
    for k, v in cn_map.items():
        if k in text:
            return v
    return None
