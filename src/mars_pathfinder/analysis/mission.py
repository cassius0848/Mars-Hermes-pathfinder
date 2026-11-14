"""EVA-level route validation and mission reporting.

EVA 级路线验证与任务报告；这里负责资源和返航检查，不重新搜索路径。
"""

import math

import numpy as np

from mars_pathfinder.models import EVAState, MissionConstraints, Point, ScienceTarget, TerrainGrid


STEEP_TERRAIN_DEG = 12.0  # Demonstration threshold for comparing exposure along valid routes.


def evaluate_eva_route(
    path: list[Point],
    terrain: TerrainGrid,
    slope: np.ndarray,
    eva: EVAState,
    constraints: MissionConstraints,
    targets: list[ScienceTarget] | None = None,
) -> dict[str, object]:
    """Return route metrics and explicit safety checks for an EVA plan.

    返回距离、时间、坡度、资源余量、科学目标和安全状态。
    """

    if len(path) < 2:
        raise ValueError("an EVA route needs at least a start and destination")
    distances = [math.dist(a, b) * terrain.cell_size_m for a, b in zip(path, path[1:])]
    route_distance = float(sum(distances))
    walk_time = route_distance / constraints.speed_m_per_h
    visited_targets = [target for target in (targets or []) if target.location in path]
    science_stop_time = sum(target.stop_duration_min for target in visited_targets) / 60.0
    route_time = walk_time + science_stop_time
    usable_time = eva.remaining_time_h * (1.0 - eva.reserve_fraction)
    time_margin = usable_time - route_time
    route_slopes = [float(slope[p]) for p in path[1:]]
    heights = terrain.elevation[tuple(np.asarray(path).T)]
    edge_slopes = np.maximum(np.r_[slope[path[0]], route_slopes[:-1]], route_slopes)
    steep_distance = float(np.sum(np.asarray(distances)[edge_slopes >= STEEP_TERRAIN_DEG]))
    if eva.metabolic_rate_kj_h is None:
        # Unknown is intentionally not treated as safe.
        # 未配置资源模型时不能把路线标记为安全。
        resource_status = "unconfigured"
        resource_used_kj = None
        resource_available_kj = None
        resource_reserve_ok = False
    else:
        resource_status = "configured"
        resource_used_kj = route_time * eva.metabolic_rate_kj_h * eva.crew_size
        resource_available_kj = eva.resource_budget_kj * (1.0 - eva.reserve_fraction)
        resource_reserve_ok = resource_used_kj <= resource_available_kj
    target_ids = [target.target_id for target in visited_targets]
    max_position_uncertainty = max((target.position_uncertainty_m for target in visited_targets), default=0.0)
    return {
        "distance_m": route_distance,
        "walk_time_h": walk_time,
        "science_stop_time_h": science_stop_time,
        "estimated_time_h": route_time,
        "time_budget_ok": time_margin >= 0,
        "time_margin_h": time_margin,
        "mean_slope_deg": float(np.nanmean(route_slopes)),
        "max_slope_deg": float(np.nanmax(route_slopes)),
        "steep_distance_m": steep_distance,
        "ascent_m": float(np.maximum(np.diff(heights), 0).sum()),
        "resource_status": resource_status,
        "resource_source": eva.resource_source,
        "resource_used_kj": resource_used_kj,
        "resource_available_kj": resource_available_kj,
        "resource_reserve_ok": resource_reserve_ok,
        "target_ids": target_ids,
        "max_position_uncertainty_m": max_position_uncertainty,
        "alignment_review_required": max_position_uncertainty > 0.0,
        "safety_ok": time_margin >= 0 and resource_reserve_ok,
    }
