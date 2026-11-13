"""EVA-level route validation and mission reporting.

EVA 级路线验证与任务报告；这里负责资源和返航检查，不重新搜索路径。
"""

import math

import numpy as np

from mars_pathfinder.models import EVAState, MissionConstraints, Point, ScienceTarget, TerrainGrid


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
    route_slopes = [float(slope[p]) for p in path[1:]]
    # This is an explicitly labeled planning proxy, not a flight-qualified
    # life-support model. 这是演示用资源代理，不是飞行级生命支持模型。
    energy_fraction = min(1.0, route_time / max(eva.remaining_time_h, 1e-9) * 0.5 + eva.payload_kg / 2000.0)
    remaining_after = min(eva.life_support_fraction, eva.battery_fraction) - energy_fraction
    target_ids = [target.target_id for target in visited_targets]
    return {
        "distance_m": route_distance,
        "walk_time_h": walk_time,
        "science_stop_time_h": science_stop_time,
        "estimated_time_h": route_time,
        "mean_slope_deg": float(np.nanmean(route_slopes)),
        "max_slope_deg": float(np.nanmax(route_slopes)),
        "estimated_resource_use": energy_fraction,
        "resource_reserve_ok": remaining_after >= eva.reserve_fraction,
        "target_ids": target_ids,
        "safety_ok": route_time <= eva.remaining_time_h and remaining_after >= eva.reserve_fraction,
    }
