"""
智汇小玉 — 知识库检索服务（RAG）

基于关键词匹配 + TF 排序的轻量检索器。
不需要向量数据库，不需要 embedding 模型，不编造内容。

接口：
  retrieve(query) → 返回最相关的文档列表
"""

import re
import math
from typing import Counter

from knowledge.documents import KNOWLEDGE_DOCS


# ─── 构建倒排索引 ───────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """简单中文分词：按字/词切分（单字+双字）"""
    text = text.lower()
    # 去掉标点
    text = re.sub(r'[，。！？、；：""''「」【】《》（）\s+]', '', text)
    # 生成双字词（相邻两个字符）
    tokens = set()
    for i in range(len(text) - 1):
        tokens.add(text[i:i + 2])
    # 也包含单字
    for c in text:
        tokens.add(c)
    return list(tokens)


# 预处理所有文档
_doc_tokens = []
_all_tokens = Counter()

for doc in KNOWLEDGE_DOCS:
    # 关键词 + 标题 + 内容一起建索引
    text_for_index = ' '.join(doc['keywords']) + ' ' + doc['title'] + ' ' + doc['content']
    tokens = _tokenize(text_for_index)
    _doc_tokens.append((doc, Counter(tokens)))
    _all_tokens.update(tokens)


def _tf(query_tokens: list, doc_counter: Counter) -> float:
    """计算 TF 得分"""
    score = 0
    for t in query_tokens:
        if t in doc_counter:
            score += 1.0 + math.log(doc_counter[t] + 1)
    return score


def _idf(query_tokens: list) -> dict:
    """计算 IDF"""
    n = len(KNOWLEDGE_DOCS)
    idf_dict = {}
    for t in query_tokens:
        df = sum(1 for _, counter in _doc_tokens if t in counter)
        idf_dict[t] = math.log((n + 1) / (df + 1)) + 1
    return idf_dict


def retrieve(query: str, top_k: int = 1) -> list[dict]:
    """
    检索知识库，返回最相关的文档列表

    参数:
        query: 用户问题
        top_k: 返回前几条

    返回:
        [{id, title, content, category, score}]
    """
    if not query or not query.strip():
        return []

    query_tokens = _tokenize(query)
    idf_dict = _idf(query_tokens)

    scored = []
    for doc, counter in _doc_tokens:
        score = 0
        for t in query_tokens:
            if t in counter:
                score += idf_dict.get(t, 1) * (1.0 + math.log(counter[t] + 1))
        scored.append((doc, score))

    # 按得分排序
    scored.sort(key=lambda x: -x[1])

    results = []
    for doc, score in scored[:top_k]:
        # 低于阈值不返回
        if score < 0.5:
            continue
        results.append({
            "id": doc["id"],
            "title": doc["title"],
            "content": doc["content"],
            "category": doc["category"],
            "score": round(score, 2),
        })

    return results


def retrieve_by_keywords(keywords: list[str], top_k: int = 1) -> list[dict]:
    """按关键词直接检索（用于意图识别前置过滤）"""
    query = ' '.join(keywords)
    return retrieve(query, top_k)
