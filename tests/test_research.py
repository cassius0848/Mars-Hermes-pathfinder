"""Hawksbill Gap research-package checks / Hawksbill Gap 研究包检查。"""

import json
from pathlib import Path

import pytest
from pyproj import Transformer
from rasterio.transform import xy

from mars_pathfinder.data.jezero_region import MARS_GEOGRAPHIC_CRS
from mars_pathfinder.data.research import load_hawksbill_gap_package


@pytest.mark.skipif(not Path('docs/jezero-research').exists(), reason='research archive not present')
def test_hawksbill_package_uses_real_local_products():
    pytest.importorskip('rasterio')
    pytest.importorskip('pyproj')
    package = load_hawksbill_gap_package(Path('docs/jezero-research'))
    expected_step = 1.0 if Path('docs/jezero-research/derived/jezero-elevation-local-1m.tif.b64').exists() else 2.0
    expected_size = 520 if expected_step == 1.0 else 260
    assert package.terrain.shape == (expected_size, expected_size)
    assert package.terrain.cell_size_m == expected_step
    assert package.terrain.source.endswith(f'jezero-elevation-local-{int(expected_step)}m.tif')
    assert package.science_targets
    assert package.science_targets[0].source.startswith('NASA PDS')
    assert package.geology.source == 'USGS SIM 3464'
    assert package.meda_summary['pressure']['PRESSURE'] > 0
    expected_optical = expected_size * (4 if expected_step == 1.0 else 4)
    assert package.optical_rgb.shape == (expected_optical, expected_optical, 3)
    archived = json.loads(Path('docs/jezero-research/derived/validation.json').read_text())
    inverse = Transformer.from_crs(package.terrain.crs, MARS_GEOGRAPHIC_CRS, always_xy=True)
    for point, name in zip([package.base_point, *(target.location for target in package.science_targets)], ('base', 'A', 'B')):
        lonlat = inverse.transform(*xy(package.transform, *point))
        assert lonlat == pytest.approx(archived['modeled_waypoints_lonlat'][name], abs=2e-5)


def test_hawksbill_targets_support_closed_loop_planning():
    pytest.importorskip('rasterio')
    pytest.importorskip('pyproj')
    import numpy as np

    from mars_pathfinder.models import EVAState, MissionConstraints
    from mars_pathfinder.analysis.mission import evaluate_eva_route
    from mars_pathfinder.routing.mission import closed_loop_route
    from mars_pathfinder.terrain.costs import build_eva_cost

    package = load_hawksbill_gap_package(Path('docs/jezero-research'))
    science = np.zeros(package.terrain.shape)
    for target in package.science_targets:
        science[target.location] = target.science_value
    cost = build_eva_cost(package.slope, science_value=science, weather_weight=0, radiation_weight=0, max_slope_deg=18)
    path, _, _ = closed_loop_route(cost, package.base_point, [target.location for target in package.science_targets])
    report = evaluate_eva_route(path, package.terrain, package.slope, EVAState(remaining_time_h=24), MissionConstraints(max_slope_deg=18), package.science_targets)
    assert path[0] == path[-1] == package.base_point
    assert report['resource_status'] == 'unconfigured'
    assert report['safety_ok'] is False
    assert set(report['target_ids']) == {target.target_id for target in package.science_targets}
