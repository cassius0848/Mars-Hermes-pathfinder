"""Terrain derivatives / 地形派生量计算。"""

import numpy as np

from mars_pathfinder.models import TerrainGrid


def slope_degrees(terrain: TerrainGrid) -> np.ndarray:
    """Calculate first-order slope in degrees from an elevation grid.

    根据高程网格计算一阶坡度，结果单位为度；缺失高程保持为 NaN。
    """

    # np.gradient returns derivatives along rows and columns respectively.
    # np.gradient 返回行、列方向的高程梯度。
    dz_dy, dz_dx = np.gradient(terrain.elevation, terrain.cell_size_m)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    return np.where(np.isfinite(terrain.elevation), slope, np.nan)
