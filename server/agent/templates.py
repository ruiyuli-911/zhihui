"""
智慧小职 — 用户友好回复模板

所有用户可见的文字从这里输出，保证：
1. 口语化、简短
2. 一次只说一件事
3. 不用专业词
4. 每一步明确告诉用户"下一步做什么"
"""

from typing import Optional


def greeting() -> str:
    return "您好！我是智慧小职。想找什么样的工作？可以直接告诉我。"


def help_text() -> str:
    return "您可以直接说：\n“找保安工作”\n“找附近保洁”\n“查看我的报名”"


def no_jobs(keyword: str = "") -> str:
    if keyword:
        return f"没找到【{keyword}】相关的工作。换个词试试，比如保安、保洁、搬运工。"
    return "没找到合适的岗位，您试试说别的工种？"


def job_search_result(jobs: list, keyword: str = "") -> str:
    """搜索到岗位后的提示"""
    count = len(jobs)
    if count == 0:
        return no_jobs(keyword)
    return f"找到了 {count} 个岗位，您看看哪个合适？"


def confirm_apply(job: dict, index: int = 0) -> str:
    """确认报名提示"""
    title = job.get("title", "")
    salary = job.get("salary", "")
    benefits = job.get("benefits", [])
    benefit_text = "，".join(benefits[:3]) if benefits else ""
    extra = f"，{benefit_text}" if benefit_text else ""
    return f"您选的是【{title}】，{salary}{extra}。确定报名吗？"


def after_confirm_hint(job_title: str = "") -> str:
    """用户确认后的下一步提示"""
    return f"好的，我来帮您办报名。"


def collect_info_prompt(missing_fields: list[str]) -> str:
    """收集资料的提示——适老化"""
    field_names = {
        "姓名": "姓名",
        "联系电话": "电话",
        "年龄": "年龄",
    }
    names = [field_names.get(f, f) for f in missing_fields]

    if len(names) == 0:
        return ""
    if len(names) == 1:
        return f"还差{names[0]}，请告诉我。"
    if len(names) == 2:
        return f"还差{names[0]}和{names[1]}，您可以说：我叫王建国，电话138……"

    items = "、".join(names[:-1])
    return f"还差{items}和{names[-1]}。您可以一次说完，比如：我叫王建国，今年53岁，电话138……"


def info_received(field: str) -> str:
    """收到某项资料后的确认"""
    name_map = {
        "name": "姓名",
        "phone": "电话",
        "age": "年龄",
    }
    cn = name_map.get(field, field)
    return f"好的，{cn}记下了。"


def info_complete_then_apply(job_title: str = "") -> str:
    """资料收齐，开始报名"""
    return "信息齐了，现在帮您提交报名。"


def apply_success(job_title: str = "") -> str:
    if job_title:
        return f"【{job_title}】报名成功！企业会在1个工作日内联系您。"
    return "报名成功！企业会在1个工作日内联系您。"


def apply_fail(reason: str = "") -> str:
    if reason:
        return f"报名没成功：{reason}。稍后再试试？"
    return "报名没成功，请稍后再试。"


def no_last_jobs() -> str:
    return "您还没搜过岗位，先说想找什么样的工作？"


def invalid_index(total: int) -> str:
    return f"只有 {total} 个岗位，没有第几个。从第一个到第{total}个都可以选。"


def cancel_apply() -> str:
    return "好的，不报名了。还有别的需要帮忙的吗？"


def small_talk_reply(text: str) -> str:
    """闲聊回复——简短友好，不硬拽回就业"""
    text = text.strip()
    if any(w in text for w in ["谢谢", "感谢", "辛苦了"]):
        return "不客气，应该的。需要找工作随时告诉我。"
    if any(w in text for w in ["哈哈", "呵呵", "好笑", "开心"]):
        return "您高兴就好。有工作方面的事随时叫我。"
    if any(w in text for w in ["再见", "拜拜", "下次", "回头"]):
        return "好的，再见。有需要再来找我。"
    if any(w in text for w in ["天气", "下雨", "热", "冷"]):
        return "是啊，注意身体。需要找工作的时候告诉我。"
    if any(w in text for w in ["吃饭", "吃了", "饿"]):
        return "吃好喝好。有找工作的事随时说。"
    if any(w in text for w in ["无聊", "没意思"]):
        return "要不我帮您看看有什么工作？说「找保安工作」就行。"
    # 默认闲聊回复
    return "好的。您需要找工作、查岗位或者报名，随时跟我说。"


def already_applied(job_title: str = "") -> str:
    if job_title:
        return f"您已经报过【{job_title}】了，不能重复报名。"
    return "您已经报过这个岗位了。"


def what_next() -> str:
    return "还要做别的吗？可以继续找工作，或者查看报名进度。"
