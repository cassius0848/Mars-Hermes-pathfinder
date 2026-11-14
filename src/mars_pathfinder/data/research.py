"""Adapters for offline local EVA research packages.

研究归档适配器：把队友取得的 HiRISE、THEMIS、USGS 和任务航点数据转换为
项目可以直接消费的模型。该模块只读取固定版本的本地资料，不重新下载数据。
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine, array_bounds, from_origin, rowcol
from rasterio.warp import Resampling, reproject

from mars_pathfinder.data.jezero_region import MARS_GEOGRAPHIC_CRS
from mars_pathfinder.data.loaders import load_geojson_layer
from mars_pathfinder.models import Point, ScienceTarget, SurfaceImageEvidence, TerrainGrid, VectorLayer
from mars_pathfinder.terrain.derivatives import slope_degrees


LOCAL_CRS = "+proj=aeqd +lat_0=18.4588 +lon_0=77.406 +a=3396190 +b=3396190 +units=m +type=crs"
NERETVA_CENTER = (77.3030, 18.4945)
NERETVA_WIDTH_M = 1120
NERETVA_SPACING_M = 2
NERETVA_CRS = (
    f"+proj=aeqd +lat_0={NERETVA_CENTER[1]} +lon_0={NERETVA_CENTER[0]} "
    "+a=3396190 +b=3396190 +units=m +type=crs"
)


@dataclass(frozen=True)
class ObservationReference:
    """Archive a rover reference independently of the modeled walking stop."""

    target_id: str
    xy_m: tuple[float, float]
    rover_reference: str
    rover_source_url: str
    modeled_stop_offset_m: float
    photograph: SurfaceImageEvidence


@dataclass(frozen=True)
class ResearchPackage:
    """A real-data local mission package / 真实数据局部任务包。"""

    name: str
    terrain: TerrainGrid
    slope: np.ndarray
    optical_rgb: np.ndarray
    thermal: np.ndarray
    geology: VectorLayer | None
    science_targets: list[ScienceTarget]
    base_point: Point
    route_preview: dict
    meda_summary: dict[str, dict[str, float]]
    source_root: str
    transform: Affine
    thermal_transform: Affine | None = None
    observation_references: tuple[ObservationReference, ...] = ()
    quality: np.ndarray | None = None


def _read_raster(path: Path) -> np.ndarray:
    """Read a raster with rasterio and preserve its numeric values.

    使用 rasterio 读取栅格并保留数值；研究包需要 GeoTIFF 的 CRS 和变换信息。
    """

    with rasterio.open(path) as dataset:
        return dataset.read()


def _read_rgb(path: Path, grid_crs, transform: Affine, shape: tuple[int, int], *, oversampling=4) -> np.ndarray:
    """Resample and contrast-stretch the orthophoto within the DTM extent."""

    display_transform = from_origin(transform.c, transform.f, transform.a / oversampling, -transform.e / oversampling)
    display_shape = tuple(length * oversampling for length in shape)
    rgb = np.zeros((*display_shape, 3), dtype=np.uint8)
    with rasterio.open(path) as source:
        for band_number in range(1, min(3, source.count) + 1):
            values = np.full(display_shape, np.nan, dtype=np.float32)
            reproject(
                rasterio.band(source, band_number), values, dst_transform=display_transform,
                dst_crs=grid_crs, dst_nodata=np.nan, resampling=Resampling.average,
            )
            valid = np.isfinite(values)
            if valid.any():
                low, high = np.percentile(values[valid], [2, 98])
                rgb[valid, band_number - 1] = np.clip(
                    (values[valid] - low) / max(high - low, 1) * 255, 0, 255,
                ).astype(np.uint8)
        if source.count == 1:
            rgb[..., 1:] = rgb[..., :1]
    return rgb


def _lonlat_to_local(point: tuple[float, float], transform: Affine, grid_crs, shape: tuple[int, int]) -> Point:
    """Convert Mars lon/lat evidence to the local 2 m grid.

    将火星经纬度证据转换到研究包的局部米制 2 m 网格。
    """

    project = Transformer.from_crs(MARS_GEOGRAPHIC_CRS, grid_crs, always_xy=True)
    row, col = rowcol(transform, *project.transform(*point))
    if not (0 <= row < shape[0] and 0 <= col < shape[1]):
        raise ValueError(f"Archived waypoint {point} is outside the local DTM.")
    return int(row), int(col)


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
    elevation_path = next((path for path in (
        derived / "jezero-elevation-local-1m.tif",
        derived / "jezero-elevation-local-2m.tif",
    ) if path.exists()), None)
    if elevation_path is None:
        raise FileNotFoundError("No local Hawksbill elevation package was found.")
    with rasterio.open(elevation_path) as dataset:
        elevation = dataset.read(1, masked=True).astype(float).filled(np.nan)
        transform, grid_crs = dataset.transform, dataset.crs
    suffix = "1m" if elevation_path.name.endswith("1m.tif") else "2m"
    slope = _read_raster(derived / f"jezero-slope-local-{suffix}.tif")[0].astype(float)
    quality_path = derived / f"jezero-quality-local-{suffix}.tif"
    quality = _read_raster(quality_path)[0].astype(np.uint8) if quality_path.exists() else None
    if quality is not None:
        valid = quality > 0
        elevation[~valid] = np.nan
        slope[~valid] = np.nan
    thermal = _read_raster(derived / "jezero-thermal-native.tif")[0].astype(float)
    optical_rgb = _read_rgb(derived / "jezero-ortho-native.tif", grid_crs, transform, elevation.shape)
    terrain = TerrainGrid(elevation, cell_size_m=transform.a, crs=LOCAL_CRS, source=str(elevation_path))
    geology = load_geojson_layer(derived / "jezero-geology-local.json", name="Hawksbill Gap USGS geology", source="USGS SIM 3464", crs=LOCAL_CRS)
    validation = json.loads((derived / "validation.json").read_text(encoding="utf-8"))
    targets = []
    # Route goals use the archived modeled waypoints, while the evidence lon/lat
    # remains in the rationale. This preserves the documented 13–17 m offset and
    # avoids silently routing to an observation pixel that may exceed the slope cap.
    # 路线目标使用归档的模拟航点，证据坐标保留在说明中，避免把 13–17 m 偏移
    # 隐藏起来，也避免直接把可能超出坡度阈值的观测像元当作可行终点。
    modeled_names = ["A", "B"]
    offsets = validation.get("observation_stop_offset_m", {})
    for (name, evidence_lonlat), modeled_name in zip(validation["evidence_lonlat"].items(), modeled_names):
        modeled_lonlat = validation["modeled_waypoints_lonlat"][modeled_name]
        targets.append(ScienceTarget(
            target_id=f"hawksbill-{name.lower().replace(' ', '-')}",
            name=name,
            location=_lonlat_to_local(tuple(modeled_lonlat), transform, grid_crs, terrain.shape),
            science_value=1.0,
            rationale=(
                f"Real Perseverance / PDS evidence near {evidence_lonlat[0]:.6f}°E, "
                f"{evidence_lonlat[1]:.6f}°N; modeled route waypoint {modeled_name} "
                f"at {modeled_lonlat[0]:.6f}°E, {modeled_lonlat[1]:.6f}°N."
            ),
            source="NASA PDS / docs/jezero-research",
            stop_duration_min=12.0,
            position_uncertainty_m=float(offsets.get(name, 0.0)),
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
        base_point=_lonlat_to_local(tuple(validation["modeled_waypoints_lonlat"]["base"]), transform, grid_crs, terrain.shape),
        route_preview=route_preview,
        meda_summary=meda_summary,
        source_root=str(root),
        transform=transform,
        quality=quality,
    )


def load_neretva_package(root: str | Path) -> ResearchPackage:
    """Load the Bright Angel and Serpentine Rapids walking area."""

    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    extent = NERETVA_WIDTH_M / 2
    spacing = float(manifest.get("grid_spacing_m", {}).get("elevation", NERETVA_SPACING_M))
    elevation_path = root / ("elevation-1m.tif" if (root / "elevation-1m.tif").exists() else "elevation.tif")
    with rasterio.open(elevation_path) as dataset:
        elevation = dataset.read(1, masked=True).astype(float).filled(np.nan)
        transform, grid_crs = dataset.transform, dataset.crs
        if (grid_crs != CRS.from_string(NERETVA_CRS) or dataset.res != (spacing,) * 2
                or array_bounds(*dataset.shape, transform) != (-extent, -extent, extent, extent)):
            raise ValueError("Neretva Vallis elevation does not match the local planning grid.")
    quality_path = root / "quality-1m.tif"
    quality = None
    if quality_path.exists():
        with rasterio.open(quality_path) as quality_source:
            quality = quality_source.read(1).astype(np.uint8)
        valid = quality > 0
        elevation[~valid] = np.nan
    terrain = TerrainGrid(elevation, transform.a, NERETVA_CRS, str(elevation_path))
    with rasterio.open(root / "optical.tif") as source:
        if (source.crs != grid_crs or source.res != (1, 1)
                or array_bounds(*source.shape, source.transform) != array_bounds(*terrain.shape, transform)):
            raise ValueError("Neretva Vallis orthophoto does not match the local planning extent.")
    optical_rgb = _read_rgb(root / "optical.tif", grid_crs, transform, elevation.shape, oversampling=2)
    with rasterio.open(root / "thermal.tif") as source:
        if source.crs != grid_crs or source.res != (100, 100):
            raise ValueError("Neretva Vallis thermal context does not match the 100 m display grid.")
        thermal = source.read(1, masked=True).astype(np.float32).filled(np.nan)
        thermal_transform = source.transform

    project = Transformer.from_crs(MARS_GEOGRAPHIC_CRS, grid_crs, always_xy=True)
    targets, references = [], []
    for observation in manifest["observations"]:
        image = observation["image"]
        rover = observation["rover_reference"]
        targets.append(ScienceTarget(
            observation["id"], observation["name"],
            _lonlat_to_local(observation["modeled_stop_lonlat"], transform, grid_crs, terrain.shape),
            1.0, observation["science_task"], "NASA Perseverance / PDS PLACES",
            stop_duration_min=observation["stop_duration_min"],
        ))
        references.append(ObservationReference(
            observation["id"], project.transform(*rover["lonlat"]), rover["description"],
            rover["source"], observation["modeled_stop_offset_m"],
            SurfaceImageEvidence(
                image["id"], str(root / image["file"]), image["asset_url"], image["page_url"],
                "Perseverance", "SHERLOC WATSON", image["sol"], "NASA/JPL-Caltech",
            ),
        ))
    return ResearchPackage(
        name="Neretva Vallis", terrain=terrain, slope=slope_degrees(terrain), optical_rgb=optical_rgb,
        thermal=thermal, geology=None, science_targets=targets,
        base_point=_lonlat_to_local(manifest["simulated_base_lonlat"], transform, grid_crs, terrain.shape),
        route_preview={}, meda_summary={}, source_root=str(root), transform=transform,
        thermal_transform=thermal_transform, observation_references=tuple(references), quality=quality,
    )
