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
