"""
智汇小玉 — 对话状态机（v2）

统一状态机：
  IDLE → SHOWING_JOBS → (选岗) → WAITING_CONFIRM
  WAITING_CONFIRM → (缺资料) → COLLECTING_INFO → WAITING_CONFIRM
  WAITING_CONFIRM → (资料完整) → SUBMITTING → SUCCESS → IDLE

  任何状态下：
    cancel_application → IDLE
    search/recommend → SHOWING_JOBS
"""

from typing import Optional
from enum import Enum


class State(str, Enum):
    IDLE = "idle"                          # 初始/空闲
    SHOWING_JOBS = "showing_jobs"          # 展示岗位列表，等用户选
    PREPARING_APPLICATION = "preparing_application"  # 已选岗位，正在核验资料
    COLLECTING_INFO = "collecting_info"    # 缺资料，一次收集一个字段
    WAITING_APPLY_CONFIRM = "waiting_apply_confirm"  # 确认卡已展示，等用户最终确认
    SUBMITTING = "submitting"              # 后端正在提交
    SUCCESS = "success"                    # 报名完成

    # 兼容旧状态名
    @classmethod
    def _missing_(cls, value):
        aliases = {
            "waiting_confirm": cls.PREPARING_APPLICATION,
        }
        return aliases.get(value)


def next_state(current: Optional[State], input_type: str) -> Optional[State]:
    """根据当前状态和输入类型，计算下一状态"""
    from agent.state import TRANSITIONS
    key = (current, input_type)
    if key in TRANSITIONS:
        return TRANSITIONS[key]
    key = (current, "anything")
    if key in TRANSITIONS:
        return TRANSITIONS[key]
    return current


TRANSITIONS = {
    (State.IDLE, "search"): State.SHOWING_JOBS,
    (State.IDLE, "recommend"): State.SHOWING_JOBS,
    (State.SHOWING_JOBS, "search"): State.SHOWING_JOBS,
    (State.SHOWING_JOBS, "recommend"): State.SHOWING_JOBS,
    (State.SHOWING_JOBS, "select"): State.PREPARING_APPLICATION,
    (State.PREPARING_APPLICATION, "confirm"): State.COLLECTING_INFO,
    (State.PREPARING_APPLICATION, "cancel"): State.IDLE,
    (State.PREPARING_APPLICATION, "search"): State.SHOWING_JOBS,
    (State.PREPARING_APPLICATION, "recommend"): State.SHOWING_JOBS,
    (State.PREPARING_APPLICATION, "info_complete"): State.WAITING_APPLY_CONFIRM,
    (State.WAITING_APPLY_CONFIRM, "submit"): State.SUBMITTING,
    (State.WAITING_APPLY_CONFIRM, "cancel"): State.IDLE,
    (State.COLLECTING_INFO, "provide_info"): State.COLLECTING_INFO,
    (State.COLLECTING_INFO, "info_complete"): State.PREPARING_APPLICATION,
    (State.COLLECTING_INFO, "cancel"): State.IDLE,
    (State.SUBMITTING, "submit"): State.SUCCESS,
    (State.SUBMITTING, "cancel"): State.IDLE,
    (State.SUCCESS, "search"): State.SHOWING_JOBS,
    (State.SUCCESS, "anything"): State.IDLE,
    (None, "search"): State.SHOWING_JOBS,
}
