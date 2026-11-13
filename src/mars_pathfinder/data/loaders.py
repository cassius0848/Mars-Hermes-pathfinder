"""Data loaders and a synthetic mission fixture for development.

数据加载器与开发用合成任务 fixture。真实数据加载器必须保留来源和坐标信息；
合成 fixture 只用于测试，不能冒充 NASA / USGS 观测。
"""

import json
from pathlib import Path

import numpy as np

from mars_pathfinder.models import MapLayer, RouteReference, ScienceTarget, SurfaceImageEvidence, TerrainGrid, VectorLayer


def load_geojson_layer(path: str | Path, *, name: str, source: str, crs: str = "EPSG:4326") -> VectorLayer:
    """Load a GeoJSON feature collection without requiring geopandas.

    在不依赖 geopandas 的情况下加载 GeoJSON 要素集合。
    """

    payload = json.loads(Path(path).read_text())
    features = payload.get("features", [])
    geometry_type = "unknown"
    if features and features[0].get("geometry"):
        geometry_type = features[0]["geometry"].get("type", "unknown")
    return VectorLayer(name=name, geometry_type=geometry_type, features=features, crs=crs, source=source)


def load_route_reference(metadata_path: str | Path) -> RouteReference:
    """Load a cited historical mission-route asset.

    加载有出处的历史任务路线素材；该素材只用于背景参考。
    """

    metadata = json.loads(Path(metadata_path).read_text())
    return RouteReference(**metadata)


def load_surface_image_evidence(metadata_path: str | Path) -> SurfaceImageEvidence:
    """Load image provenance exported from the Perseverance raw-image page.

    加载 Perseverance 原始图像的 Sol、仪器、URL 和署名信息。
    """

    metadata = json.loads(Path(metadata_path).read_text())
    return SurfaceImageEvidence(**metadata)


def load_synthetic_terrain(shape: tuple[int, int] = (50, 50), seed: int = 7) -> TerrainGrid:
    """Return a clearly labeled synthetic DEM for development and tests.

    返回明确标记为 synthetic-demo 的 DEM，仅用于开发和算法测试。
    """

    rows, cols = shape
    y, x = np.mgrid[-1:1:complex(rows), -1:1:complex(cols)]
    # Keep the fixture smooth enough for deterministic routing tests.
    # 保持 fixture 平滑，便于获得稳定、可复现的路线测试结果。
    hill = 35.0 * np.exp(-4.0 * (x**2 + y**2))
    ridge = 6.0 * np.sin(5.0 * x) * np.cos(3.0 * y)
    rng = np.random.default_rng(seed)
    elevation = hill + ridge + rng.normal(0.0, 0.5, size=shape)
    return TerrainGrid(elevation, cell_size_m=10.0, source="synthetic-demo")


def science_targets_from_vector(
    layer: VectorLayer,
    bbox: tuple[float, float, float, float],
    shape: tuple[int, int],
    *,
    max_targets: int = 4,
) -> list[ScienceTarget]:
    """Derive candidate science stops from mapped USGS geologic units.

    The coordinates are approximate centroids of the published vector features.
    The normalized value is a planner priority, not a measured scientific score.

    从 USGS 地质单元生成候选科学停留点。坐标是公开矢量要素的近似中心，
    normalized value 只是规划优先级，不是实测科学评分。
    """

    def points(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            yield (float(value[0]), float(value[1]))
        elif isinstance(value, list):
            for child in value:
                yield from points(child)

    candidates = []
    min_lon, min_lat, max_lon, max_lat = bbox
    for feature in layer.features:
        geometry = feature.get("geometry") or {}
        vertices = list(points(geometry.get("coordinates", [])))
        if not vertices:
            continue
        lon = sum(point[0] for point in vertices) / len(vertices)
        lat = sum(point[1] for point in vertices) / len(vertices)
        # Ignore centroids on the export boundary, which are often clipped
        # polygons rather than representative target locations.
        # 忽略导出边界上的中心点，避免把裁剪多边形误当作目标。
        margin = min(lon - min_lon, max_lon - lon, lat - min_lat, max_lat - lat)
        if margin < 0.02:
            continue
        properties = feature.get("properties") or {}
        name = properties.get("name") or "Unnamed geologic unit"
        symbol = properties.get("symbol") or properties.get("unit") or "unknown"
        row = round((max_lat - lat) / (max_lat - min_lat) * (shape[0] - 1))
        col = round((lon - min_lon) / (max_lon - min_lon) * (shape[1] - 1))
        candidates.append((name, symbol, (max(0, min(shape[0] - 1, row)), max(0, min(shape[1] - 1, col))), lon, lat, margin))

    # These are mission-relevant units from the USGS product, not invented names.
    # 以下名称来自 USGS 产品，不是项目虚构标签。
    preferred = ["Jezero fan 2 unit", "Jezero floor unit", "Rugged bright unit", "Nili Planum fan unit", "Crater rim unit"]
    candidates.sort(key=lambda item: (preferred.index(item[0]) if item[0] in preferred else len(preferred), -item[5]))
    selected: list[ScienceTarget] = []
    seen: set[str] = set()
    for name, symbol, location, lon, lat, _margin in candidates:
        if name in seen:
            continue
        seen.add(name)
        selected.append(ScienceTarget(
            target_id=f"usgs-{symbol}",
            name=f"{name} ({symbol})",
            location=location,
            science_value=1.0,
            rationale=f"Mapped geologic unit from USGS SIM 3464 near {lon:.3f}°E, {lat:.3f}°N.",
            source=layer.source,
        ))
        if len(selected) >= max_targets:
            break
    return selected


def load_synthetic_mission(shape: tuple[int, int] = (50, 50)) -> tuple[TerrainGrid, dict[str, MapLayer], list[ScienceTarget]]:
    """Create a labeled local-EVA fixture until official resources arrive.

    The layers are algorithm fixtures, not NASA observations. Their provenance
    makes it difficult to accidentally present them as measured data.

    创建带来源标记的本地 EVA fixture。这里的图层不是 NASA 观测，不能用于
    科学模型训练或正式结论。
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

    加载 NASA Mars Trek 导出的 MOLA TIFF。服务使用 EPSG:104905；没有
    rasterio 时用 Pillow 读取样本，并按火星纬度范围近似地面像元间距。
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
        # 服务导出单位是度，这里换算为米供坡度计算使用。
        mars_radius_m = 3_389_500.0
        cell_size_m = abs(bbox[3] - bbox[1]) * np.pi * mars_radius_m / 180.0 / elevation.shape[0]
        crs = dataset.crs.to_string() if dataset.crs else "EPSG:104905"
    return TerrainGrid(elevation, cell_size_m=cell_size_m, crs=crs, source=str(path))


def load_raster(path: str | Path) -> TerrainGrid:
    """Load a single-band elevation GeoTIFF into the common terrain model.

    将单波段高程 GeoTIFF 转换为统一 TerrainGrid 模型。
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
