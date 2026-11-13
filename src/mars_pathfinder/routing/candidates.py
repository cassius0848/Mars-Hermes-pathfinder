"""Mission route candidates and Pareto filtering / 路线候选与 Pareto 筛选。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from mars_pathfinder.analysis.mission import evaluate_eva_route
from mars_pathfinder.models import EVAState, MissionConstraints, Point, ScienceTarget, TerrainGrid
from mars_pathfinder.routing.mission import closed_loop_route


@dataclass(frozen=True)
class RouteCandidate:
    """One reproducible closed-loop route candidate / 一个可复现闭环候选。"""

    route_id: str
    stop_ids: tuple[str, ...]
    path: list[Point]
    planning_cost: float
    segments: list[dict[str, Any]]
    report: dict[str, Any]


def generate_candidates(
    cost_grid: np.ndarray,
    start: Point,
    targets: list[ScienceTarget],
    terrain: TerrainGrid,
    slope: np.ndarray,
    eva: EVAState,
    constraints: MissionConstraints,
) -> list[RouteCandidate]:
    """Generate forward, reverse, and single-stop route candidates.

    生成正序、反序和单站闭环候选；不隐藏重排序，所有候选保留顺序证据。
    """

    if not targets:
        raise ValueError("at least one target is required")
    orders: list[tuple[ScienceTarget, ...]] = []
    if len(targets) == 1:
        orders = [tuple(targets)]
    else:
        orders.extend([tuple(targets), tuple(reversed(targets))])
        orders.extend((target,) for target in targets)
    candidates: list[RouteCandidate] = []
    seen: set[tuple[str, ...]] = set()
    for order in orders:
        stop_ids = tuple(target.target_id for target in order)
        if stop_ids in seen:
            continue
        seen.add(stop_ids)
        path, planning_cost, segments = closed_loop_route(
            cost_grid, start, [target.location for target in order]
        )
        report = evaluate_eva_route(path, terrain, slope, eva, constraints, list(order))
        candidates.append(RouteCandidate(
            route_id="route-" + "-".join(stop_ids),
            stop_ids=stop_ids,
            path=path,
            planning_cost=float(planning_cost),
            segments=segments,
            report=report,
        ))
    return candidates


def pareto_filter(candidates: list[RouteCandidate], *, require_safety: bool = False) -> list[RouteCandidate]:
    """Keep candidates not dominated on time, slope, and distance.

    保留在时间、最大坡度和距离上不被完全支配的候选。
    """

    pool = [candidate for candidate in candidates if not require_safety or candidate.report["safety_ok"]]
    if not pool:
        pool = list(candidates)
    metrics = lambda c: (
        float(c.report["estimated_time_h"]),
        float(c.report["max_slope_deg"]),
        float(c.report["distance_m"]),
    )
    result = []
    for candidate in pool:
        current = metrics(candidate)
        dominated = any(
            all(a <= b for a, b in zip(metrics(other), current))
            and any(a < b for a, b in zip(metrics(other), current))
            for other in pool
            if other.route_id != candidate.route_id
        )
        if not dominated:
            result.append(candidate)
    return result


def select_recommended(candidates: list[RouteCandidate]) -> RouteCandidate:
    """Select the fastest safe candidate, otherwise the least-time candidate."""

    if not candidates:
        raise ValueError("no route candidates")
    safe = [candidate for candidate in candidates if candidate.report["safety_ok"]]
    return min(safe or candidates, key=lambda candidate: float(candidate.report["estimated_time_h"]))
