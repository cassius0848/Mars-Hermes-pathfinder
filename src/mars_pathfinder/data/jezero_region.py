"""Offline Jezero regional assets on a shared Mars metric grid."""

from __future__ import annotations

import json
from dataclasses import dataclass
from math import hypot
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine, array_bounds, rowcol, xy

from mars_pathfinder.routing.search import shortest_path
from mars_pathfinder.terrain.costs import build_eva_cost


MARS_GEOGRAPHIC_CRS = "+proj=longlat +a=3396190 +b=3396190 +type=crs"
REGION_CENTER = (77.74, 18.44)
REGION_RADIUS_M = 40_000
REGION_SPACING_M = 100
REGION_CRS = (
    f"+proj=aeqd +lat_0={REGION_CENTER[1]} +lon_0={REGION_CENTER[0]} "
    "+a=3396190 +b=3396190 +units=m +type=crs"
)
REGIONAL_SLOPE_LIMIT_DEG = 25.0


def grid_axes(transform: Affine, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Return cell-centre coordinates of a north-up raster in its own CRS."""
    height, width = shape
    x = transform.c + (np.arange(width) + 0.5) * transform.a
    y = transform.f + (np.arange(height) + 0.5) * transform.e
    return x, y


@dataclass(frozen=True)
class JezeroRegion:
    elevation: np.ndarray
    slope: np.ndarray
    optical: np.ndarray
    thermal: np.ndarray
    geology: np.ndarray
    transform: Affine
    coverage: dict[str, float]
    units: dict[int, str]

    def region_xy(self, longitude, latitude):
        return Transformer.from_crs(MARS_GEOGRAPHIC_CRS, REGION_CRS, always_xy=True).transform(
            longitude, latitude
        )

    def plan_corridor(self, start: tuple[float, float], goal: tuple[float, float]):
        """Route between projected endpoints using the CTX screening grid."""
        cells = []
        for name, point in (("Start", start), ("Destination", goal)):
            east, north = point
            if not np.isfinite(point).all() or hypot(east, north) > REGION_RADIUS_M:
                raise ValueError(f"{name} must be inside the 40 km regional boundary.")
            row, col = rowcol(self.transform, east, north)
            if not (0 <= row < self.slope.shape[0] and 0 <= col < self.slope.shape[1]):
                raise ValueError(f"{name} is outside the regional grid.")
            slope = self.slope[row, col]
            if not np.isfinite(slope) or slope > REGIONAL_SLOPE_LIMIT_DEG:
                raise ValueError(f"{name} is in a data gap or exceeds the terrain slope limit.")
            cells.append((row, col))
        if cells[0] == cells[1]:
            raise ValueError("Choose endpoints in different 100 m cells.")

        cost = build_eva_cost(self.slope, max_slope_deg=REGIONAL_SLOPE_LIMIT_DEG)
        path, _ = shortest_path(cost, *cells)
        rows, cols = zip(*path)
        easting, northing = xy(self.transform, rows, cols)
        distance = float(np.hypot(np.diff(easting), np.diff(northing)).sum())
        return easting, northing, distance, float(self.slope[rows, cols].max())


def load_jezero_region(root: Path) -> JezeroRegion:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    with rasterio.open(root / "terrain.tif") as terrain:
        elevation, slope = terrain.read(masked=True).filled(np.nan)
        transform = terrain.transform
        crs = terrain.crs
        spacing = (REGION_SPACING_M, REGION_SPACING_M)
        radius = REGION_RADIUS_M
        if terrain.res != spacing or array_bounds(*terrain.shape, transform) != (-radius, -radius, radius, radius):
            raise ValueError("Jezero terrain does not match the 40 km atlas grid.")
    arrays = []
    for name in ("optical", "thermal", "geology"):
        with rasterio.open(root / f"{name}.tif") as source:
            if (source.transform, source.crs, source.shape) != (transform, crs, elevation.shape):
                raise ValueError(f"Jezero layer {name} does not match the regional grid.")
            band = source.read(1, masked=True).astype(np.float32)
            arrays.append(band.filled(np.nan))
    return JezeroRegion(
        elevation, slope, *arrays, transform, manifest["coverage_pct"],
        {int(index): name for index, name in manifest["geologic_units"].items()},
    )
