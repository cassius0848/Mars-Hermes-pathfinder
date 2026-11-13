"""Route metrics shared by the UI and reporting layers.

供界面和报告层复用的路线指标计算。
"""

import math

import numpy as np

from mars_pathfinder.models import TerrainGrid


def route_metrics(path: list[tuple[int, int]], terrain: TerrainGrid, slope: np.ndarray) -> dict[str, float]:
    """Compute interpretable metrics for a grid route.

    计算距离、平均坡度、最大坡度和可解释的能耗代理指标。
    """

    if len(path) < 2:
        return {"distance_m": 0.0, "mean_slope_deg": 0.0, "max_slope_deg": 0.0, "energy_units": 0.0}
    distances = []
    slopes = []
    for current, nxt in zip(path, path[1:]):
        distances.append(math.dist(current, nxt) * terrain.cell_size_m)
        slopes.append(float(slope[nxt]))
    distance = float(sum(distances))
    mean_slope = float(np.nanmean(slopes))
    max_slope = float(np.nanmax(slopes))
    energy = distance * (1.0 + mean_slope / 45.0)
    return {
        "distance_m": distance,
        "mean_slope_deg": mean_slope,
        "max_slope_deg": max_slope,
        "energy_units": energy,
    }
