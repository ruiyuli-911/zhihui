"""
智慧小职 — 就业服务 Agent（状态机版本）

业务决策由规则控制（状态机 + 工具调用）
语言表达由模板生成（适老化、口语化）

状态机：IDLE → SHOWING_JOBS → WAITING_CONFIRM → COLLECTING_INFO → SUBMITTING → SUCCESS
"""

import json
import logging
import re
from typing import Optional

from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from config import settings
from agent.state import State
from agent.intent_detector import detect as detect_intent
from agent.slot_extractor import extract_slots
from agent.safety_guard import guard
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

        # LLM 模式（可选）
        if settings.DEEPSEEK_API_KEY and \
           settings.DEEPSEEK_API_KEY not in ("", "sk-你的Key", "your-deepseek-api-key-here"):
            try:
                llm_base = settings.DEEPSEEK_API_URL.rstrip("/chat/completions").rstrip("/") + "/v1"
                self.llm = ChatOpenAI(
                    model="deepseek-chat",
                    openai_api_key=settings.DEEPSEEK_API_KEY,
                    openai_api_base=llm_base,
                    temperature=0.3, max_tokens=1500,
                )
                prompt = ChatPromptTemplate.from_messages([
                    ("system", "你是智慧小职，一个面向大龄求职者的语音就业助手。按工具调用结果回复。"),
                    ("placeholder", "{chat_history}"),
                    ("human", "{input}"),
                    ("placeholder", "{agent_scratchpad}"),
                ])
                agent = create_tool_calling_agent(self.llm, self.tools, prompt)
                self.executor = AgentExecutor(
                    agent=agent, tools=self.tools,
                    verbose=True, handle_parsing_errors=True,
                    max_iterations=5, return_intermediate_steps=True,
                )
                self._use_llm = True
                logger.info("LLM Agent 模式已初始化")
            except Exception as e:
                logger.warning("LLM 初始化失败: %s", e)
        else:
            logger.info("规则回退模式")

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

        if self._use_llm:
            response = self._llm_process(message, session)
        else:
            response = self._rule_process(message, user_id, session)

        session["history"].append({"role": "assistant", "content": response.reply})
        return response

    # ─── 会话管理 ──────────────────────────────────────────

    def _get_or_create_session(self, sid: str, uid: str) -> dict:
        if sid not in self._sessions:
            self._sessions[sid] = {
                "user_id": uid,
                "state": State.IDLE,
                "history": [],
                "last_jobs": [],
                "pending_job": None,        # {"job_id": ..., "title": ...}
                "collecting_fields": [],     # 还在收的字段 ["name","phone","age"]
                "collected_info": {},        # 已收的 {"name":"张三","age":52}
                "location": None,
                "created_at": __import__("time").time(),
            }
        return self._sessions[sid]

    # ─── 意图分类（委托独立模块） ──────────────────────────

    def _classify(self, msg: str) -> str:
        """使用精确的意图路由"""
        result = detect_intent(msg)
        return result["intent"]

    # ─── 从消息中提取个人信息 ──────────────────────────────

    def _extract_info(self, msg: str) -> dict:
        """从自然语言中提取姓名/年龄/电话"""
        info = {}

        # 姓名：我叫XXX / 我是XXX / 姓X
        m = re.search(r'(?:我叫|我是|姓)(\S{1,6})(?:[，,\s]|今年|电话|$)', msg)
        if m:
            info["name"] = m.group(1).strip()

        # 年龄：XX岁 / 今年XX
        m = re.search(r'(?:今年|年龄|岁数)?(\d{1,3})(?:\s*岁)', msg)
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
            return self._do_search(msg, session)

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
            return self._do_search(msg, session)

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

            profile = self._get_user_info(uid)
            missing = self._check_missing_fields(profile)
            if missing:
                session["state"] = State.COLLECTING_INFO
                session["collecting_fields"] = missing
                session["collected_info"] = {k: v for k, v in profile.items() if v}
                return ChatResponse(
                    type="collect_info",
                    reply=collect_info_prompt(missing),
                    content={"text": collect_info_prompt(missing), "missing_fields": missing, "job": job},
                )

            return self._do_submit_apply(uid, job, session)

        if intent == "cancel_apply":
            session["state"] = State.IDLE
            session["pending_job"] = None
            return ChatResponse(
                type="text",
                reply=cancel_apply(),
                content={"text": cancel_apply()},
            )

        if intent == "search_job":
            return self._do_search(msg, session)

        return ChatResponse(
            type="text",
            reply="请确认是否报名？说「确认」或「取消」。",
            content={"text": "请确认是否报名？说「确认」或「取消」。", "state_hint": "waiting_confirm"},
        )

    def _handle_provide_info(self, msg: str, uid: str, session: dict) -> ChatResponse:
        """提供个人信息——任何状态下都响应"""
        state = session.get("state", State.IDLE)

        # 只有在 COLLECTING_INFO 状态下才收资料
        if state != State.COLLECTING_INFO:
            return ChatResponse(
                type="text",
                reply="好的，我记下了。您需要找工作还是查报名进度？",
                content={"text": "好的，我记下了。您需要找工作还是查报名进度？"},
            )

        # 从消息中提取信息
        extracted = self._extract_info(msg)
        if not extracted:
            return ChatResponse(
                type="collect_info",
                reply="我没听清您的信息，请再说一遍。比如：我叫王建国，今年52岁，电话13800138000。",
                content={"text": "我没听清您的信息，请再说一遍。",
                         "missing_fields": session.get("collecting_fields", [])},
            )

        # 校验
        errors = guard.validate_user_info(extracted)
        if errors:
            return ChatResponse(
                type="collect_info",
                reply=f"信息有误：{'、'.join(errors)}。请重新说一下。",
                content={"text": f"信息有误：{'、'.join(errors)}。请重新说一下。",
                         "missing_fields": session.get("collecting_fields", [])},
            )

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

    def _do_search(self, msg: str, session: dict) -> ChatResponse:
        """执行搜索"""
        kw = ""
        if "保安" in msg:
            kw = "保安"
        elif "保洁" in msg:
            kw = "保洁"
        elif "搬运" in msg or "装卸" in msg:
            kw = "搬运工"
        elif "建筑" in msg:
            kw = "建筑工"
        elif "家政" in msg:
            kw = "家政"

        result = search_jobs.invoke({
            "keyword": kw,
            "min_salary": 0,
            "provide_food": "包吃" in msg,
            "provide_housing": "包住" in msg or "住宿" in msg,
        })

        jobs = result.get("jobs", [])

        if not jobs:
            session["state"] = State.IDLE
            return ChatResponse(type="text", reply=no_jobs(kw), content={"text": no_jobs(kw)})

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
        """检查缺少哪些报名必需字段"""
        missing = []
        if not profile.get("name"):
            missing.append("姓名")
        if not profile.get("phone"):
            missing.append("联系电话")
        if not profile.get("age"):
            missing.append("年龄")
        return missing

    def _get_user_info(self, uid: str) -> dict:
        try:
            result = get_user_profile.invoke({"user_id": uid})
            return result.get("profile", {})
        except Exception:
            return {}


def _chinese_to_int_from_params(params: dict) -> Optional[int]:
    """从 params 中提取数字索引"""
    idx = params.get("index")
    if idx:
        return idx
    text = params.get("index_text", "")
    if not text:
        return None
    m = __import__("re").search(r'\d+', text)
    if m:
        return int(m.group())
    cn_map = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5}
    for k, v in cn_map.items():
        if k in text:
            return v
    return None


# ─── LLM 模式 ──────────────────────────────────────────

    def _llm_process(self, message: str, session: dict) -> ChatResponse:
        try:
            result = self.executor.invoke({
                "input": message,
                "chat_history": session.get("history", [])[-6:],
            })
            output = result.get("output", "")
            steps = result.get("intermediate_steps", [])
        except Exception as e:
            logger.error("LLM Agent 失败: %s", e)
            return ChatResponse(type="text", reply="服务暂时不可用。", content={"text": "服务暂时不可用。"})

        # 提取 tool 结果
        tool_results = {}
        for action, observation in steps:
            if isinstance(observation, str):
                try:
                    observation = json.loads(observation)
                except Exception:
                    pass
            tool_results[action.tool] = observation

        return self._build_llm_response(output, tool_results)

    def _build_llm_response(self, output: str, tool_results: dict) -> ChatResponse:
        if "search_jobs" in tool_results:
            data = tool_results["search_jobs"]
            jobs = data.get("jobs", []) if isinstance(data, dict) else []
            if jobs:
                return ChatResponse(
                    type="job_list",
                    reply=output,
                    content={"summary": output, "jobs": jobs},
                )
        if "apply_job" in tool_results:
            data = tool_results["apply_job"]
            if isinstance(data, dict) and data.get("success"):
                return ChatResponse(
                    type="result",
                    reply=output,
                    content={"status": "success", "title": "报名成功！", "description": output},
                )
        return ChatResponse(type="text", reply=output, content={"text": output})


# 全局单例
_agent: Optional[EmploymentAgent] = None


def get_agent() -> EmploymentAgent:
    global _agent
    if _agent is None:
        _agent = EmploymentAgent()
    return _agent
