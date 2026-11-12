"""EVA-level route validation and mission reporting."""

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
    """Return route metrics and explicit safety checks for an EVA plan."""

    if len(path) < 2:
        raise ValueError("an EVA route needs at least a start and destination")
    distances = [math.dist(a, b) * terrain.cell_size_m for a, b in zip(path, path[1:])]
    route_distance = float(sum(distances))
    route_time = route_distance / constraints.speed_m_per_h
    route_slopes = [float(slope[p]) for p in path[1:]]
    energy_fraction = min(1.0, route_time / max(eva.remaining_time_h, 1e-9) * 0.5 + eva.payload_kg / 2000.0)
    remaining_after = min(eva.life_support_fraction, eva.battery_fraction) - energy_fraction
    target_ids = [target.target_id for target in (targets or []) if target.location in path]
    return {
        "distance_m": route_distance,
        "estimated_time_h": route_time,
        "mean_slope_deg": float(np.nanmean(route_slopes)),
        "max_slope_deg": float(np.nanmax(route_slopes)),
        "estimated_resource_use": energy_fraction,
        "resource_reserve_ok": remaining_after >= eva.reserve_fraction,
        "target_ids": target_ids,
        "safety_ok": route_time <= eva.remaining_time_h and remaining_after >= eva.reserve_fraction,
    }
