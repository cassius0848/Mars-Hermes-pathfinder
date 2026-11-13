"""Structured AI context and response models / AI 结构化上下文与响应模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class MissionContext:
    """Small, auditable context sent to an AI provider.

    发送给 AI provider 的精简、可审计上下文。原始栅格不直接进入 prompt。
    """

    mission_id: str
    data_mode: str
    constraints: dict[str, Any]
    targets: list[dict[str, Any]]
    route_candidates: list[dict[str, Any]]
    data_sources: list[str]
    missing_data: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the context for an API or MockProvider."""

        return {
            "mission_id": self.mission_id,
            "data_mode": self.data_mode,
            "constraints": self.constraints,
            "targets": self.targets,
            "route_candidates": self.route_candidates,
            "data_sources": self.data_sources,
            "missing_data": self.missing_data,
        }


@dataclass(frozen=True)
class Recommendation:
    """Validated provider output / 已校验的 provider 输出。"""

    route_id: str
    recommendation: str
    reasons: list[str]
    risks: list[str]
    citations: list[str]
    missing_data: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "route_id": self.route_id,
            "recommendation": self.recommendation,
            "reasons": self.reasons,
            "risks": self.risks,
            "citations": self.citations,
            "missing_data": self.missing_data,
        }
