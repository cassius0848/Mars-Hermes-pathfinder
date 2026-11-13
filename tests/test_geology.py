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
