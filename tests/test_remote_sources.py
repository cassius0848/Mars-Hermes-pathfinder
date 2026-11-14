from mars_pathfinder.data.remote_sources import (
    build_mola_export_url,
    build_usgs_geology_query_url,
)


def test_mola_export_url_is_bounded_and_metric():
    url = build_mola_export_url((77.0, 18.0, 78.0, 19.0), size=128)
    assert "size=128%2C128" in url
    assert "bboxSR=104905" in url
    assert "pixelType=F32" in url
    assert "format=tiff" in url


def test_usgs_query_url_is_bounded_geojson():
    url = build_usgs_geology_query_url(limit=12)
    assert "resultRecordCount=12" in url
    assert "returnGeometry=true" in url
    assert "f=geojson" in url
