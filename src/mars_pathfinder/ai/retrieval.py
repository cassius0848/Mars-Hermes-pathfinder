"""Lightweight lexical retrieval before embeddings / 向量化前的轻量检索。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DocumentChunk:
    """A source-preserving document chunk / 保留来源信息的文档块。"""

    chunk_id: str
    text: str
    source: str
    metadata: dict[str, str]


class KeywordRetriever:
    """Deterministic local retriever; no embeddings or API required."""

    def __init__(self, chunks: list[DocumentChunk]):
        self.chunks = chunks

    @staticmethod
    def _terms(text: str) -> set[str]:
        words = re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]", text.lower())
        return set(words)

    def search(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        """Return chunks ranked by lexical overlap / 按词面重叠返回文档块。"""

        query_terms = self._terms(query)
        scored = []
        for chunk in self.chunks:
            score = len(query_terms & self._terms(chunk.text))
            if score:
                scored.append((score, chunk))
        scored.sort(key=lambda item: (-item[0], item[1].chunk_id))
        return [chunk for _, chunk in scored[:top_k]]


def build_research_corpus(root: str | Path, max_chars: int = 1600) -> list[DocumentChunk]:
    """Chunk research Markdown/JSON/XML with source metadata.

    将研究 Markdown/JSON/XML 切块并保留文件来源；后续可替换为 embedding 检索。
    """

    root = Path(root)
    paths = sorted([*root.rglob("*.md"), *root.rglob("*.json"), *root.rglob("*.xml")])
    chunks: list[DocumentChunk] = []
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        for index in range(0, len(text), max_chars):
            part = text[index : index + max_chars].strip()
            if part:
                chunks.append(DocumentChunk(
                    chunk_id=f"{path.relative_to(root)}#{index}",
                    text=part,
                    source=str(path),
                    metadata={"path": str(path.relative_to(root))},
                ))
    return chunks
