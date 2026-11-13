"""Build compact AI context from deterministic planner outputs."""

from __future__ import annotations

from typing import Any

from mars_pathfinder.ai.schemas import MissionContext


def build_mission_context(
    *,
    mission_id: str,
    data_mode: str,
    constraints: dict[str, Any],
    targets: list[dict[str, Any]],
    route_candidates: list[dict[str, Any]],
    data_sources: list[str],
    missing_data: list[str],
) -> MissionContext:
    """Keep only route metrics, constraints, sources, and explicit gaps.

    只保留路线指标、约束、来源和明确缺口，不把原始栅格塞入模型上下文。
    """

    return MissionContext(
        mission_id=mission_id,
        data_mode=data_mode,
        constraints=constraints,
        targets=targets,
        route_candidates=route_candidates,
        data_sources=data_sources,
        missing_data=missing_data,
    )
