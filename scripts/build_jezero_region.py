"""Build the offline Jezero atlas from published, georeferenced products."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds
from shapely import make_valid, transform as transform_geometry
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mars_pathfinder.data.jezero_region import (  # noqa: E402
    MARS_GEOGRAPHIC_CRS,
    REGION_CENTER,
    REGION_CRS,
    REGION_RADIUS_M,
    REGION_SPACING_M,
    grid_axes,
)
from mars_pathfinder.models import TerrainGrid  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402

CTX_DEM = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/"
    "ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
)
CTX_TILES = "https://trek.nasa.gov/tiles/Mars/EQ/Jezero_CTX_BlockAdj_dd/1.0.0"
THEMIS = (
    "https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mo/themis/controlled_mosaics/"
    "mc13_syrtis_major_dir/mc13_syrtis_major_dir.tif"
)
SIM3464 = (
    "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
    "Jezero_FeatureServiceFromPro/FeatureServer/8"
)
WAYPOINTS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"


def fetch(url: str, path: Path, *, expected_size: int | None = None) -> Path:
    if path.is_file() and (expected_size is None or path.stat().st_size == expected_size):
        return path
    temporary = path.with_suffix(path.suffix + ".part")
    with urlopen(url, timeout=45) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    if expected_size is not None and temporary.stat().st_size != expected_size:
        raise ValueError(f"Unexpected download size for {url}")
    temporary.replace(path)
    return path


def warp(values, source_transform, source_crs, transform, shape, resampling):
    result = np.full(shape, np.nan, dtype=np.float32)
    reproject(
        values, result, src_transform=source_transform, src_crs=source_crs, src_nodata=np.nan,
        dst_transform=transform, dst_crs=REGION_CRS, dst_nodata=np.nan, resampling=resampling,
    )
    return result


def read_raster(path, transform, shape, resampling):
    with rasterio.open(path) as src:
        bounds = rasterio.transform.array_bounds(*shape, transform)
        source_bounds = transform_bounds(REGION_CRS, src.crs, *bounds, densify_pts=21)
        window = from_bounds(*source_bounds, transform=src.transform)
        window = rasterio.windows.Window(
            math.floor(window.col_off) - 2, math.floor(window.row_off) - 2,
            math.ceil(window.width) + 5, math.ceil(window.height) + 5,
        )
        window = window.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        values = src.read(1, window=window, masked=True).astype(np.float32).filled(np.nan)
        return warp(values, src.window_transform(window), src.crs, transform, shape, resampling)


def read_ctx_tiles(cache, transform, shape):
    # The advertised level 9 is defined by a 1024 × 512 matrix of 256 px tiles.
    tile_width = 360 / 1024
    bounds = rasterio.transform.array_bounds(*shape, transform)
    west, south, east, north = transform_bounds(REGION_CRS, MARS_GEOGRAPHIC_CRS, *bounds)
    top, bottom = (math.floor((90 - value) / tile_width) for value in (north, south))
    left, right = (math.floor((value + 180) / tile_width) for value in (west, east))
    folder = cache / "trek-z9"
    folder.mkdir(exist_ok=True)
    cells = [(row, col) for row in range(top, bottom + 1) for col in range(left, right + 1)]

    def tile(cell):
        row, col = cell
        path = fetch(f"{CTX_TILES}/default/default028mm/9/{row}/{col}.png", folder / f"{row}-{col}.png")
        with Image.open(path) as image:
            values = np.asarray(image.convert("LA"))
        return np.where(values[..., 1] > 0, values[..., 0], np.nan).astype(np.float32)

    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(tile, cells))
    num_cols = right - left + 1
    mosaic = np.concatenate([
        np.concatenate(rows[index:index + num_cols], axis=1)
        for index in range(0, len(rows), num_cols)
    ])
    step = tile_width / 256
    tile_transform = from_origin(-180 + left * tile_width, 90 - top * tile_width, step, step)
    return warp(mosaic, tile_transform, MARS_GEOGRAPHIC_CRS, transform, shape, Resampling.average)


def geology_grid(cache, transform, shape):
    query = urlencode({"where": "1=1", "outFields": "OBJECTID,unit,name,symbol", "returnGeometry": "true",
                       "maxAllowableOffset": 100, "f": "json"})
    response = json.loads(fetch(f"{SIM3464}/query?{query}", cache / "sim3464-native.json").read_text(encoding="utf-8"))
    if not response.get("features") or response.get("exceededTransferLimit"):
        raise ValueError("SIM 3464 did not return a complete polygon query.")
    project = Transformer.from_crs(response["spatialReference"]["wkt"], REGION_CRS, always_xy=True)
    codes = {}
    polygons = []
    for feature in response["features"]:
        properties = feature["attributes"]
        description = properties["name"] or properties["symbol"] or "Unnamed USGS unit"
        code = codes.setdefault(description, len(codes) + 1)
        rings = [make_valid(Polygon(ring)) for ring in feature["geometry"]["rings"] if len(ring) >= 4]
        if not rings:
            continue
        polygon = rings[0]
        for ring in rings[1:]:
            polygon = polygon.symmetric_difference(ring)
        polygon = transform_geometry(polygon, project.transform, interleaved=False)
        if not polygon.is_empty:
            polygons.append((polygon, code))
    return rasterize(polygons, out_shape=shape, transform=transform, fill=0, dtype="uint16"), {
        code: name for name, code in codes.items()
    }


def write_raster(path, arrays, transform, dtype, nodata, names):
    height, width = arrays[0].shape
    with rasterio.open(
        path, "w", driver="GTiff", width=width, height=height, count=len(arrays), dtype=dtype,
        crs=REGION_CRS, transform=transform, nodata=nodata, compress="deflate", tiled=True,
    ) as dest:
        for index, (values, name) in enumerate(zip(arrays, names), start=1):
            dest.write(values.astype(dtype), index)
            dest.set_band_description(index, name)


def build(cache: Path, output: Path):
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    spacing = REGION_SPACING_M
    span = REGION_RADIUS_M + 5_000  # Coverage audit to 45 km; trimmed before saving.
    transform = from_origin(-span, span, spacing, spacing)
    size = 2 * span // spacing
    shape = (size, size)
    x, y = grid_axes(transform, shape)
    dist_squared = np.square(x)[None, :] + np.square(y)[:, None]
    inside = dist_squared <= REGION_RADIUS_M ** 2

    ctx_file = fetch(CTX_DEM, cache / "ctx-dem-source.tif", expected_size=90_345_300)
    elevation = read_raster(ctx_file, transform, shape, Resampling.average)
    audit = {}
    for radius_km in (25, 30, 35, 40, 45):
        circle = dist_squared <= (radius_km * 1_000) ** 2
        audit[radius_km] = round(float(np.isfinite(elevation[circle]).mean() * 100), 3)
    slope = slope_degrees(TerrainGrid(elevation, cell_size_m=float(spacing)))
    trim = (span - REGION_RADIUS_M) // spacing
    crop = np.s_[trim:-trim, trim:-trim]
    transform = from_origin(-REGION_RADIUS_M, REGION_RADIUS_M, spacing, spacing)
    elevation, slope, inside = elevation[crop], slope[crop], inside[crop]
    inside_height = inside & np.isfinite(elevation)
    slope = np.where(inside_height, slope, np.nan)
    elevation = np.where(inside_height, elevation, np.nan)

    optical = read_ctx_tiles(cache, transform, inside.shape)
    thermal_file = cache / "themis-source.tif"
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="25"):
        thermal = read_raster(thermal_file if thermal_file.exists() else THEMIS,
                              transform, inside.shape, Resampling.nearest)
    geology, units = geology_grid(cache, transform, inside.shape)
    geology[~inside] = 0
    coverage = {key: round(float(valid[inside].mean() * 100), 3) for key, valid in (
        ("elevation", np.isfinite(elevation)), ("slope", np.isfinite(slope)),
        ("optical", np.isfinite(optical)), ("thermal", np.isfinite(thermal)), ("geology", geology != 0),
    )}
    for key, values, name in (("optical", optical, "Mars Trek CTX DN"), ("thermal", thermal, "THEMIS DN")):
        display = np.where(np.isfinite(values) & inside, np.clip(np.rint(values), 1, 255), 0)
        write_raster(output / f"{key}.tif", [display], transform, "uint8", 0, [name])
    write_raster(output / "terrain.tif", [elevation.round(2), slope.round(2)], transform, "float32", np.nan,
                 ["CTX elevation (m)", "Slope on 100 m grid (deg)"])
    write_raster(output / "geology.tif", [geology], transform, "uint16", 0, ["SIM 3464 unit code"])
    digest = {}
    for name in ("terrain.tif", "optical.tif", "thermal.tif", "geology.tif"):
        with (output / name).open("rb") as stream:
            digest[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = {
        "id": "jezero-40km-v1", "center_lon_e_lat_n": REGION_CENTER, "radius_m": REGION_RADIUS_M,
        "grid_spacing_m": spacing, "crs": REGION_CRS, "coverage_basis": "valid cells with centres within the study circle",
        "coverage_pct": coverage, "ctx_elevation_radius_audit_pct": audit, "geologic_units": units,
        "source_spacing_m": {"ctx_dem": 20, "themis": 100}, "ctx_wmts_level": 9,
        "sha256": digest,
        "sources": {
            "ctx_dem": CTX_DEM, "ctx_wmts_capabilities": f"{CTX_TILES}/WMTSCapabilities.xml",
            "themis_cog": THEMIS, "sim3464_layer": SIM3464, "perseverance_waypoints": WAYPOINTS,
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["coverage_pct"]), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="Directory for downloaded source data")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "regional" / "jezero-40km")
    options = parser.parse_args()
    build(options.cache, options.output)
