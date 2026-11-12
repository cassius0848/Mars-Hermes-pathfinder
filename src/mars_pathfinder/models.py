"""Shared data models used by the ingestion and planning layers."""

from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class TerrainGrid:
    """A normalized elevation grid.

    ``elevation`` is stored in meters. ``cell_size_m`` is the ground spacing
    between adjacent cells. ``nodata`` values should be represented by NaN.
    """

    elevation: np.ndarray
    cell_size_m: float = 1.0
    crs: Optional[str] = None
    source: str = "unknown"

    def __post_init__(self) -> None:
        elevation = np.asarray(self.elevation, dtype=float)
        if elevation.ndim != 2:
            raise ValueError("elevation must be a two-dimensional array")
        if self.cell_size_m <= 0:
            raise ValueError("cell_size_m must be positive")
        object.__setattr__(self, "elevation", elevation)

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape
