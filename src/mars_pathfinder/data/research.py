"""Adapters for the archived Hawksbill Gap research package.

研究归档适配器：把队友取得的 HiRISE、THEMIS、USGS 和任务航点数据转换为
项目可以直接消费的模型。该模块只读取固定版本的本地资料，不重新下载数据。
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from mars_pathfinder.data.loaders import load_geojson_layer
from mars_pathfinder.models import Point, ScienceTarget, TerrainGrid, VectorLayer


LOCAL_CRS = "+proj=aeqd +lat_0=18.4588 +lon_0=77.406 +a=3396190 +b=3396190 +units=m +type=crs"


@dataclass(frozen=True)
class ResearchPackage:
    """A real-data local mission package / 真实数据局部任务包。"""

    name: str
    terrain: TerrainGrid
    slope: np.ndarray
    optical_rgb: np.ndarray
    thermal: np.ndarray
    geology: VectorLayer
    science_targets: list[ScienceTarget]
    base_point: Point
    route_preview: dict
    meda_summary: dict[str, dict[str, float]]
    source_root: str


def _read_raster(path: Path) -> np.ndarray:
    """Read a raster with rasterio and preserve its numeric values.

    使用 rasterio 读取栅格并保留数值；研究包需要 GeoTIFF 的 CRS 和变换信息。
    """

    try:
        import rasterio
    except ImportError as exc:  # pragma: no cover - optional research dependency
        raise RuntimeError("Hawksbill Gap integration requires rasterio / 研究包需要 rasterio") from exc
    with rasterio.open(path) as dataset:
        return dataset.read()


def _read_rgb(path: Path) -> np.ndarray:
    """Read and normalize the first three bands for display / 读取三波段显示图。"""

    bands = _read_raster(path)
    if bands.shape[0] == 1:
        bands = np.repeat(bands, 3, axis=0)
    bands = bands[:3].astype(float)
    output = np.zeros_like(bands, dtype=np.uint8)
    for index, band in enumerate(bands):
        valid = np.isfinite(band)
        if not valid.any():
            continue
        low, high = np.nanpercentile(band[valid], [2, 98])
        if high <= low:
            high = low + 1.0
        output[index] = np.clip((band - low) / (high - low) * 255, 0, 255).astype(np.uint8)
    return np.moveaxis(output, 0, -1)


def _lonlat_to_local(point: tuple[float, float], shape: tuple[int, int]) -> Point:
    """Convert Mars lon/lat evidence to the local 2 m grid.

    将火星经纬度证据转换到研究包的局部米制 2 m 网格。
    """

    try:
        from pyproj import Transformer
    except ImportError as exc:  # pragma: no cover - optional research dependency
        raise RuntimeError("Hawksbill Gap integration requires pyproj / 研究包需要 pyproj") from exc
    transformer = Transformer.from_crs("+proj=longlat +a=3396190 +b=3396190", LOCAL_CRS, always_xy=True)
    east, north = transformer.transform(*point)
    row = round((260.0 - north) / 2.0)
    col = round((east + 260.0) / 2.0)
    return (max(0, min(shape[0] - 1, row)), max(0, min(shape[1] - 1, col)))


def _summarize_csv(path: Path, prefix: str) -> dict[str, float]:
    """Summarize real MEDA probe columns without spatially broadcasting them."""

    values: dict[str, list[float]] = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            for key, value in row.items():
                if not key.startswith(prefix) and key != "PRESSURE":
                    continue
                try:
                    values.setdefault(key, []).append(float(value))
                except (TypeError, ValueError):
                    continue
    return {key: round(float(np.mean(items)), 3) for key, items in values.items() if items}


def load_hawksbill_gap_package(root: str | Path) -> ResearchPackage:
    """Load the fixed Hawksbill Gap package into runtime models.

    加载固定版本的 Hawksbill Gap 真实数据包：HiRISE DTM、坡度、正射、THEMIS、
    USGS 局部地质和 Perseverance 证据点。MEDA 样本保留在归档中，但不会被
    复制到每个像元或虚构成空间天气栅格。
    """

    root = Path(root)
    derived = root / "derived"
    raw = root / "raw"
    elevation = _read_raster(derived / "jezero-elevation-local-2m.tif")[0].astype(float)
    slope = _read_raster(derived / "jezero-slope-local-2m.tif")[0].astype(float)
    thermal = _read_raster(derived / "jezero-thermal-native.tif")[0].astype(float)
    optical_rgb = _read_rgb(derived / "jezero-ortho-native.tif")
    terrain = TerrainGrid(elevation, cell_size_m=2.0, crs=LOCAL_CRS, source=str(derived / "jezero-elevation-local-2m.tif"))
    geology = load_geojson_layer(derived / "jezero-geology-local.json", name="Hawksbill Gap USGS geology", source="USGS SIM 3464", crs=LOCAL_CRS)
    validation = json.loads((derived / "validation.json").read_text(encoding="utf-8"))
    targets = []
    for name, lonlat in validation["evidence_lonlat"].items():
        targets.append(ScienceTarget(
            target_id=f"hawksbill-{name.lower().replace(' ', '-')}",
            name=name,
            location=_lonlat_to_local(tuple(lonlat), terrain.shape),
            science_value=1.0,
            rationale=f"Real Perseverance / PDS evidence point near {lonlat[0]:.6f}°E, {lonlat[1]:.6f}°N.",
            source="NASA PDS / docs/jezero-research",
        ))
    route_preview = json.loads((derived / "jezero-route-preview.json").read_text(encoding="utf-8"))
    meda_summary = {
        "air_temperature": _summarize_csv(root / "probes" / "meda-518-ats-sample.csv", "ATS_LOCAL_TEMP"),
        "pressure": _summarize_csv(root / "probes" / "meda-518-ps-sample.csv", "PRESSURE"),
    }
    return ResearchPackage(
        name="Hawksbill Gap research package",
        terrain=terrain,
        slope=slope,
        optical_rgb=optical_rgb,
        thermal=thermal,
        geology=geology,
        science_targets=targets,
        base_point=_lonlat_to_local(tuple(validation["modeled_waypoints_lonlat"]["base"]), terrain.shape),
        route_preview=route_preview,
        meda_summary=meda_summary,
        source_root=str(root),
    )
