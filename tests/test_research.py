"""Hawksbill Gap research-package checks / Hawksbill Gap 研究包检查。"""

from pathlib import Path

import pytest

from mars_pathfinder.data.research import load_hawksbill_gap_package


@pytest.mark.skipif(not Path('docs/jezero-research').exists(), reason='research archive not present')
def test_hawksbill_package_uses_real_local_products():
    pytest.importorskip('rasterio')
    pytest.importorskip('pyproj')
    package = load_hawksbill_gap_package(Path('docs/jezero-research'))
    assert package.terrain.shape == (260, 260)
    assert package.terrain.cell_size_m == 2.0
    assert package.terrain.source.endswith('jezero-elevation-local-2m.tif')
    assert package.science_targets
    assert package.science_targets[0].source.startswith('NASA PDS')
    assert package.geology.source == 'USGS SIM 3464'
    assert package.meda_summary['pressure']['PRESSURE'] > 0


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
