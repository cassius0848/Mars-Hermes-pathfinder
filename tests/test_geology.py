from pathlib import Path

from mars_pathfinder.data.loaders import load_geojson_layer


def test_usgs_jezero_geology_layer_is_loadable():
    layer = load_geojson_layer(
        Path('data/raw/usgs/jezero_geologic_units_100m.geojson'),
        name='USGS Jezero geologic units',
        source='USGS SIM 3464',
    )
    assert layer.geometry_type == 'Polygon'
    assert len(layer.features) == 1308
    assert layer.crs == 'EPSG:4326'


def test_usgs_units_generate_real_science_target():
    from mars_pathfinder.data.loaders import science_targets_from_vector

    layer = load_geojson_layer(
        Path('data/raw/usgs/jezero_geologic_units_100m.geojson'),
        name='USGS Jezero geologic units',
        source='USGS SIM 3464',
    )
    targets = science_targets_from_vector(layer, (77.0, 18.0, 78.0, 19.0), (256, 256))
    assert targets
    assert targets[0].source == 'USGS SIM 3464'
    assert 0 < targets[0].location[0] < 255
    assert 0 < targets[0].location[1] < 255
