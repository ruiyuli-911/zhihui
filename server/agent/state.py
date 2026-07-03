"""
智慧小职 — 对话状态机

定义清晰的对话阶段，避免 Agent 随意跳转或遗忘上下文。

状态流转:
  IDLE → SHOWING_JOBS → WAITING_CONFIRM → COLLECTING_INFO → SUBMITTING → SUCCESS
                    ↓                      ↑                    ↓
                 (重新搜索)          COLLECTING_INFO      (缺资料回退)
"""

from typing import Optional
from enum import Enum


class State(str, Enum):
    IDLE = "idle"                    # 初始/空闲
    SHOWING_JOBS = "showing_jobs"    # 刚展示了岗位列表，等待用户选
    WAITING_CONFIRM = "waiting_confirm"  # 已确定岗位，等待用户确认报名
    COLLECTING_INFO = "collecting_info"  # 在收集用户资料
    SUBMITTING = "submitting"        # 正在提交报名
    SUCCESS = "success"              # 报名完成


# 可接受的输入 → 状态转移表
TRANSITIONS = {
    # (当前状态, 输入类型) → 下一状态

    # IDLE 状态下，搜索类输入 → SHOWING_JOBS
    (State.IDLE, "search"): State.SHOWING_JOBS,
    (State.SHOWING_JOBS, "search"): State.SHOWING_JOBS,  # 重新搜索

    # SHOWING_JOBS 状态下，选岗位 → WAITING_CONFIRM
    (State.SHOWING_JOBS, "select"): State.WAITING_CONFIRM,

    # WAITING_CONFIRM 状态下，确认 → 检查资料
    (State.WAITING_CONFIRM, "confirm"): State.COLLECTING_INFO,
    (State.WAITING_CONFIRM, "cancel"): State.SHOWING_JOBS,  # 取消→回到岗位列表
    (State.WAITING_CONFIRM, "search"): State.SHOWING_JOBS,  # 重新搜索

    # COLLECTING_INFO 状态下，收集信息中
    (State.COLLECTING_INFO, "provide_info"): State.COLLECTING_INFO,  # 还在收
    (State.COLLECTING_INFO, "info_complete"): State.SUBMITTING,     # 收齐了
    (State.COLLECTING_INFO, "cancel"): State.IDLE,                  # 用户放弃

    # SUBMITTING → SUCCESS
    (State.SUBMITTING, "submit_result"): State.SUCCESS,

    # SUCCESS → IDLE（用户可以继续）
    (State.SUCCESS, "search"): State.SHOWING_JOBS,
    (State.SUCCESS, "anything"): State.IDLE,

    # 任何状态下搜索都回到 SHOWING_JOBS
    (None, "search"): State.SHOWING_JOBS,
}


def next_state(current: Optional[State], input_type: str) -> Optional[State]:
    """根据当前状态和输入类型，计算下一状态"""
    key = (current, input_type)
    if key in TRANSITIONS:
        return TRANSITIONS[key]
    # 尝试通配
    key = (current, "anything")
    if key in TRANSITIONS:
        return TRANSITIONS[key]
    return current
