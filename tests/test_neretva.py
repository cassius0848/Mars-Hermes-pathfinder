"""Check the offline Neretva data and its two-station mission."""

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import xy

from mars_pathfinder.data.research import load_neretva_package
from mars_pathfinder.models import EVAState, MissionConstraints
from mars_pathfinder.routing.candidates import generate_candidates, pareto_filter, select_recommended


ROOT = Path("data/local/neretva-vallis")


def test_packaged_layers_and_rover_reference_markers():
    package = load_neretva_package(ROOT)
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    expected_step = float(manifest["grid_spacing_m"]["elevation"])
    expected_size = 1120 if expected_step == 1 else 560
    assert package.terrain.shape == (expected_size, expected_size)
    assert package.terrain.cell_size_m == expected_step
    assert np.isfinite(package.terrain.elevation).all()
    assert np.isfinite(package.slope).all()
    assert package.optical_rgb.shape in ((1120, 1120, 3), (2240, 2240, 3))
    assert np.ptp(package.optical_rgb) > 0
    assert package.thermal.shape == (12, 12)
    assert np.isfinite(package.thermal).all()
    assert package.thermal_transform.a == 100
    assert len(package.observation_references) == len(package.science_targets) == 2
    for target, reference in zip(package.science_targets, package.observation_references):
        assert target.target_id == reference.target_id
        stop_xy = xy(package.transform, *target.location)
        assert np.linalg.norm(np.subtract(stop_xy, reference.xy_m)) == pytest.approx(
            reference.modeled_stop_offset_m, abs=0.001,
        )
        assert package.slope[target.location] <= 10
        assert Path(reference.photograph.local_path).is_file()

    with rasterio.open(ROOT / "elevation.tif") as dtm:
        for observation, reference in zip(manifest["observations"], package.observation_references):
            actual = float(next(dtm.sample([reference.xy_m]))[0])
            assert abs(actual - observation["rover_reference"]["elevation_m"]) < 1.5
    for name, expected in manifest["sha256"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    if expected_step == 1:
        assert (ROOT / "elevation-1m.tif").is_file()
        assert (ROOT / "slope-1m.tif").is_file()
        assert (ROOT / "quality-1m.tif").is_file()
        assert np.isfinite(package.quality).all()
        assert package.quality.shape == package.terrain.shape


@pytest.mark.parametrize("budget,expected_stops", [(100, 2), (45, 1)])
def test_route_tradeoffs_and_shortened_time_budget(budget, expected_stops):
    package = load_neretva_package(ROOT)
    max_slope = 18
    passable = package.slope <= max_slope
    shortest = np.where(passable, 1.0, np.inf)
    gentle = np.where(passable, 1.0 + 4.0 * (package.slope / max_slope) ** 2, np.inf)
    candidates = generate_candidates(
        shortest, package.base_point, package.science_targets, package.terrain, package.slope,
        EVAState(remaining_time_h=budget / 60, reserve_fraction=8 / budget),
        MissionConstraints(speed_m_per_h=900, max_slope_deg=max_slope), gentle_cost_grid=gentle,
    )
    choices = pareto_filter(candidates)
    best = select_recommended(choices)
    assert best.path[0] == best.path[-1] == package.base_point
    assert len(best.stop_ids) == expected_stops
    assert best.report["time_budget_ok"]
    assert best.report["max_slope_deg"] <= max_slope
    assert best.report["resource_status"] == "unconfigured"
    assert not best.report["safety_ok"]
    if budget == 45:
        assert best.stop_ids == ("malgosa-crest",)
    else:
        slope_weighted = next(candidate for candidate in choices
                              if candidate.stop_ids == best.stop_ids and candidate.profile == "Slope-weighted")
        assert best.report["distance_m"] < slope_weighted.report["distance_m"]
        assert slope_weighted.report["steep_distance_m"] < best.report["steep_distance_m"]
