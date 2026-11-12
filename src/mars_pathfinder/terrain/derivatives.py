"""Terrain derivatives."""

import numpy as np

from mars_pathfinder.models import TerrainGrid


def slope_degrees(terrain: TerrainGrid) -> np.ndarray:
    """Calculate first-order slope in degrees from an elevation grid."""

    dz_dy, dz_dx = np.gradient(terrain.elevation, terrain.cell_size_m)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    return np.where(np.isfinite(terrain.elevation), slope, np.nan)
