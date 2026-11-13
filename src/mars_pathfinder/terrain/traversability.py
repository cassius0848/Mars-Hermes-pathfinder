"""Convert terrain derivatives into a routing cost surface.

将坡度派生量转换为路线代价面；超过坡度阈值的像元设为不可通行。
"""

import numpy as np


def slope_cost(slope: np.ndarray, max_slope_degrees: float = 25.0) -> np.ndarray:
    """Return a normalized cost surface; impassable cells are infinity.

    返回归一化代价面；不可通行区域使用 infinity 表示。
    """

    if max_slope_degrees <= 0:
        raise ValueError("max_slope_degrees must be positive")
    cost = 1.0 + np.nan_to_num(slope, nan=np.inf) / max_slope_degrees
    return np.where(np.isfinite(slope) & (slope <= max_slope_degrees), cost, np.inf)
