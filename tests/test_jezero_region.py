"""Verify the checked-in atlas boundary, alignment, and routing limits."""

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from rasterio.transform import rowcol

from mars_pathfinder.data.jezero_region import (
    REGION_RADIUS_M,
    REGIONAL_SLOPE_LIMIT_DEG,
    grid_axes,
    load_jezero_region,
)


def test_jezero_region_has_aligned_real_layers_and_enforces_radius():
    root = Path("data/regional/jezero-40km")
    region = load_jezero_region(root)
    assert region.elevation.shape == (800, 800)
    x, y = grid_axes(region.transform, region.elevation.shape)
    inside = x[None, :] ** 2 + y[:, None] ** 2 <= REGION_RADIUS_M ** 2
    assert np.array_equal(np.isfinite(region.elevation), inside)
    assert np.array_equal(np.isfinite(region.slope), inside)
    for name in ("optical", "thermal", "geology"):
        values = getattr(region, name)
        assert not np.isfinite(values[~inside]).any()
        assert round(float(np.isfinite(values[inside]).mean() * 100), 3) == region.coverage[name]

    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["sha256"].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name

    start = region.region_xy(77.45088572, 18.44462715)
    end = region.region_xy(77.406, 18.4588)
    east, north, distance, slope = region.plan_corridor(start, end)
    assert 2_600 < distance < 3_500
    assert slope <= REGIONAL_SLOPE_LIMIT_DEG
    assert np.all(np.hypot(east, north) <= REGION_RADIUS_M)
    assert rowcol(region.transform, east[0], north[0]) == rowcol(region.transform, *start)
    assert rowcol(region.transform, east[-1], north[-1]) == rowcol(region.transform, *end)
    with pytest.raises(ValueError, match="inside the 40 km"):
        region.plan_corridor(start, (41_000, 0))
