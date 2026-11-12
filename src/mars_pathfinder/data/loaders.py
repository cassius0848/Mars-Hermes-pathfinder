"""Terrain data loaders.

The synthetic loader keeps the MVP runnable before official datasets arrive.
The raster loader converts a GeoTIFF into the common TerrainGrid interface.
"""

from pathlib import Path

import numpy as np

from mars_pathfinder.models import TerrainGrid


def load_synthetic_terrain(shape: tuple[int, int] = (50, 50), seed: int = 7) -> TerrainGrid:
    """Return a clearly labeled synthetic DEM for development and tests."""

    rows, cols = shape
    y, x = np.mgrid[-1:1:complex(rows), -1:1:complex(cols)]
    hill = 120.0 * np.exp(-4.0 * (x**2 + y**2))
    ridge = 20.0 * np.sin(5.0 * x) * np.cos(3.0 * y)
    rng = np.random.default_rng(seed)
    elevation = hill + ridge + rng.normal(0.0, 1.5, size=shape)
    return TerrainGrid(elevation, cell_size_m=10.0, source="synthetic-demo")


def load_raster(path: str | Path) -> TerrainGrid:
    """Load a single-band elevation GeoTIFF.

    Rasterio is imported lazily so algorithm tests do not require geospatial
    system libraries. The source metadata is retained for provenance.
    """

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
