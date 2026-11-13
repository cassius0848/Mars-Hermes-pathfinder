"""Data loaders and a synthetic mission fixture for development."""

from pathlib import Path

import numpy as np

from mars_pathfinder.models import MapLayer, ScienceTarget, TerrainGrid


def load_synthetic_terrain(shape: tuple[int, int] = (50, 50), seed: int = 7) -> TerrainGrid:
    """Return a clearly labeled synthetic DEM for development and tests."""

    rows, cols = shape
    y, x = np.mgrid[-1:1:complex(rows), -1:1:complex(cols)]
    hill = 35.0 * np.exp(-4.0 * (x**2 + y**2))
    ridge = 6.0 * np.sin(5.0 * x) * np.cos(3.0 * y)
    rng = np.random.default_rng(seed)
    elevation = hill + ridge + rng.normal(0.0, 0.5, size=shape)
    return TerrainGrid(elevation, cell_size_m=10.0, source="synthetic-demo")


def load_synthetic_mission(shape: tuple[int, int] = (50, 50)) -> tuple[TerrainGrid, dict[str, MapLayer], list[ScienceTarget]]:
    """Create a labeled local-EVA fixture until official resources arrive.

    The layers are algorithm fixtures, not NASA observations. Their provenance
    makes it difficult to accidentally present them as measured data.
    """

    terrain = load_synthetic_terrain(shape)
    rng = np.random.default_rng(11)
    weather = np.clip(0.25 + 0.15 * rng.random(shape), 0, 1)
    radiation = np.clip(0.20 + 0.10 * rng.random(shape), 0, 1)
    optical = terrain.elevation - np.nanmin(terrain.elevation)
    layers = {
        "optical_demo": MapLayer("Optical context (demo)", "optical", optical, "relative", "synthetic-demo", "synthetic"),
        "weather_demo": MapLayer("Weather risk (demo)", "weather", weather, "0-1", "synthetic-demo", "synthetic"),
        "radiation_demo": MapLayer("Radiation risk (demo)", "radiation", radiation, "0-1", "synthetic-demo", "synthetic"),
    }
    targets = [
        ScienceTarget("target-1", "Sedimentary outcrop (demo)", (shape[0] // 2, shape[1] // 2), 1.0, "Synthetic science target for interface testing.", "synthetic-demo"),
        ScienceTarget("target-2", "Mineral context (demo)", (shape[0] // 3, shape[1] * 2 // 3), 0.7, "Synthetic science target for interface testing.", "synthetic-demo"),
    ]
    return terrain, layers, targets


def load_mars_trek_mola_sample(
    path: str | Path, bbox: tuple[float, float, float, float] = (77.0, 18.0, 78.0, 19.0)
) -> TerrainGrid:
    """Load the bounded MOLA TIFF exported from NASA Mars Trek.

    The Mars Trek service uses EPSG:104905 for this geographic export. When
    rasterio is unavailable, Pillow can still read the sample TIFF; the local
    Mars ground spacing is approximated from the latitude span.
    """

    path = Path(path)
    try:
        import rasterio
    except ImportError:
        from PIL import Image

        with Image.open(path) as image:
            elevation = np.asarray(image, dtype=float)
        mars_radius_m = 3_389_500.0
        cell_size_m = abs(bbox[3] - bbox[1]) * np.pi * mars_radius_m / 180.0 / elevation.shape[0]
        return TerrainGrid(elevation, cell_size_m=cell_size_m, crs="EPSG:104905", source=str(path))

    with rasterio.open(path) as dataset:
        elevation = dataset.read(1).astype(float)
        if dataset.nodata is not None:
            elevation[elevation == dataset.nodata] = np.nan
        # The service export is in degrees; convert latitude spacing to meters.
        mars_radius_m = 3_389_500.0
        cell_size_m = abs(bbox[3] - bbox[1]) * np.pi * mars_radius_m / 180.0 / elevation.shape[0]
        crs = dataset.crs.to_string() if dataset.crs else "EPSG:104905"
    return TerrainGrid(elevation, cell_size_m=cell_size_m, crs=crs, source=str(path))


def load_raster(path: str | Path) -> TerrainGrid:
    """Load a single-band elevation GeoTIFF into the common terrain model."""

    try:
        import rasterio
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("Raster loading requires rasterio") from exc

    path = Path(path)
    with rasterio.open(path) as dataset:
        elevation = dataset.read(1).astype(float)
        if dataset.nodata is not None:
            elevation[elevation == dataset.nodata] = np.nan
        cell_size = float(abs(dataset.transform.a))
        crs = dataset.crs.to_string() if dataset.crs else None
    return TerrainGrid(elevation, cell_size_m=cell_size, crs=crs, source=str(path))
