from pathlib import Path

from mars_pathfinder.data.loaders import load_mars_trek_mola_sample, load_surface_image_evidence


def test_real_mola_sample_is_loadable():
    terrain = load_mars_trek_mola_sample(Path('data/raw/jezero_mola_256.tif'))
    assert terrain.shape == (256, 256)
    assert terrain.crs == 'EPSG:104905'
    assert terrain.source.endswith('jezero_mola_256.tif')


def test_perseverance_evidence_has_provenance():
    evidence = load_surface_image_evidence(Path('data/raw/perseverance/sol1934_sample.json'))
    assert evidence.sol == 1934
    assert evidence.instrument == 'SHERLOC_WATSON'
    assert evidence.local_path.endswith('.jpg')


def test_mars_trek_bookmarked_sample_is_loadable():
    terrain = load_mars_trek_mola_sample(
        Path('data/raw/mars_trek_views/view_-92_87_-16_32_mola_256.tif'),
        bbox=(-93.0, -16.8, -92.0, -15.8),
    )
    assert terrain.shape == (256, 256)
    assert terrain.crs == 'EPSG:104905'


def test_viking_optical_sample_is_loadable():
    from PIL import Image

    image = Image.open(Path('data/raw/mars_trek/jezero_viking_mdim21_512.jpg'))
    assert image.size == (512, 512)
