"""Build the offline Neretva Vallis site from USGS and NASA map crops."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.io import MemoryFile
from rasterio.transform import array_bounds, from_origin, rowcol, xy
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from build_jezero_region import fetch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mars_pathfinder.data.jezero_region import MARS_GEOGRAPHIC_CRS, grid_axes  # noqa: E402
from mars_pathfinder.data.research import (  # noqa: E402
    NERETVA_CENTER, NERETVA_CRS, NERETVA_SPACING_M, NERETVA_WIDTH_M,
)
from mars_pathfinder.models import TerrainGrid  # noqa: E402
from mars_pathfinder.routing.search import RouteUnavailable, shortest_path  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402


TRN = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
DTM = TRN + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first"
TILES = f"https://trek.nasa.gov/tiles/Mars/EQ/{ORTHO}_dd/1.0.0"
PLACES = "https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rover_places/data_localizations/best_interp.csv"
REGIONAL = ROOT / "data" / "regional" / "jezero-40km"
DTM_BYTES = 1_839_545_409
DTM_HEADER_BYTES = 172_609
DTM_HEADER_SHA256 = "81f630ce3680d12bacf102e78f8ac3ab80c99fccb1493fde650a3680910d41b1"
STOP_SEARCH_RADIUS_M = 25
OBSERVATIONS = (
    {
        "id": "cheyava-falls",
        "name": "Bright Angel · Cheyava Falls",
        "science_task": "Document pale sulfate veins and dark-rimmed spots in the Bright Angel outcrop. Compare their textures with the southern exposure.",
        "rover_reference": {
            "lonlat": [77.30519089, 18.49748444],
            "description": "Nearby NASA end-of-drive position 56_0 · Sol 1210",
            "source": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
            "rmc": "56_0",
            "localization_sol": 1210,
            "elevation_m": -2354.03125,
        },
        "image": {
            "id": "PIA26368 Figure A",
            "sol": 1212,
            "page_url": "https://science.nasa.gov/resource/perseverance-finds-a-rock-with-leopard-spots/",
            "asset_url": "https://science.nasa.gov/wp-content/uploads/2024/07/pia26368-perseverance-finds-a-rock-with-leopard-spots-annotated.jpg",
            "file": "cheyava-falls.jpg",
        },
    },
    {
        "id": "malgosa-crest",
        "name": "Serpentine Rapids · Malgosa Crest",
        "science_task": "Compare the red bedrock, pale patches and millimeter-scale green spots at the southern exposure. The composition of the green spots is undetermined.",
        "rover_reference": {
            "lonlat": [77.301089466, 18.491949884],
            "description": "PDS PLACES rover reference 56_3438 · localization Sol 1231",
            "source": PLACES,
            "rmc": "56_3438",
            "localization_sol": 1231,
            "spacecraft_clock_s": 776226101,
            "elevation_m": -2347.830,
        },
        "image": {
            "id": "SIF_1243_0777313998_496EBY_N0563438SRLC09814_0000LMJ",
            "sol": 1243,
            "page_url": "https://science.nasa.gov/blog/red-rocks-with-green-spots-at-serpentine-rapids/",
            "asset_url": "https://science.nasa.gov/wp-content/uploads/2024/10/mars-perseverance-sif-1243-0777313998-496eby-n0563438srlc09814-0000lmj.png?resize=900,655",
            "file": "malgosa-crest.png",
        },
    },
)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_range(cache, first, last):
    path = cache / f"dtm-bytes-{first}-{last}"
    count = last - first + 1
    if path.is_file() and path.stat().st_size == count:
        return path.read_bytes()
    for attempt in range(4):
        # Include the range in the URL so an intermediary cannot reuse a different slice.
        request = Request(f"{DTM}?window=neretva-v1-{first}-{last}-{attempt}", headers={"Range": f"bytes={first}-{last}"})
        try:
            with urlopen(request, timeout=40) as response:
                expected = f"bytes {first}-{last}/{DTM_BYTES}"
                if response.status != 206 or response.headers.get("Content-Range") != expected:
                    raise ValueError(f"USGS did not return the requested range {expected}.")
                data = response.read(count + 1)
            if len(data) != count:
                raise ValueError(f"USGS returned an incomplete DTM range at byte {first}.")
            part = path.with_suffix(".part")
            part.write_bytes(data)
            part.replace(path)
            return data
        except (OSError, HTTPException, ValueError):
            if attempt == 3:
                raise


def read_elevation(cache, transform, shape):
    header = read_range(cache, 0, DTM_HEADER_BYTES - 1)
    if hashlib.sha256(header).hexdigest() != DTM_HEADER_SHA256:
        raise ValueError("The source GeoTIFF header changed. Verify the new USGS product before rebuilding.")
    with MemoryFile(header) as memory, memory.open() as source:
        bounds = transform_bounds(NERETVA_CRS, source.crs, *array_bounds(*shape, transform))
        raw_window = from_bounds(*bounds, source.transform)
        col = math.floor(raw_window.col_off) - 2
        row = math.floor(raw_window.row_off) - 2
        width = math.ceil(raw_window.width) + 4
        height = math.ceil(raw_window.height) + 4
        native_transform = source.window_transform(Window(col, row, width, height))
        native_crs, nodata, strip_width = source.crs, source.nodata, source.width
        row_bytes = strip_width * 4
        row_groups = [(first, min(40, row + height - first)) for first in range(row, row + height, 40)]
        # The pinned TIFF is little-endian float32, uncompressed, with one contiguous strip per row.
        ranges = [(DTM_HEADER_BYTES + start * row_bytes, DTM_HEADER_BYTES + (start + count) * row_bytes - 1)
                  for start, count in row_groups]

        def strip(byte_range):
            data = read_range(cache, *byte_range)
            values = np.frombuffer(data, dtype="<f4").reshape(-1, strip_width)
            return values[:, col:col + width].copy()

        with ThreadPoolExecutor(max_workers=8) as workers:
            native = np.concatenate(list(workers.map(strip, ranges)))
    native[native == nodata] = np.nan
    result = np.full(shape, np.nan, dtype=np.float32)
    reproject(native, result, src_crs=native_crs, src_transform=native_transform, src_nodata=np.nan,
              dst_crs=NERETVA_CRS, dst_transform=transform, dst_nodata=np.nan, resampling=Resampling.average)
    return np.round(result, 2), {"window_col_row_width_height": [col, row, width, height],
                                "range_transfer_bytes": DTM_HEADER_BYTES + height * row_bytes}


def read_optical(cache, transform, shape):
    level = 16
    tile_degrees = 360 / (2 ** (level + 1))
    west, south, east, north = transform_bounds(NERETVA_CRS, MARS_GEOGRAPHIC_CRS, *array_bounds(*shape, transform))
    top, bottom = (math.floor((90 - value) / tile_degrees) for value in (north, south))
    left, right = (math.floor((value + 180) / tile_degrees) for value in (west, east))
    folder = cache / f"z{level}"
    folder.mkdir(exist_ok=True)
    cells = [(row, col) for row in range(top, bottom + 1) for col in range(left, right + 1)]

    def tile(cell):
        row, col = cell
        path = fetch(f"{TILES}/default/default028mm/{level}/{row}/{col}.png", folder / f"{row}-{col}.png")
        with Image.open(path) as image:
            values = np.asarray(image.convert("LA"))
        if values.shape != (256, 256, 2):
            raise ValueError(f"Unexpected size for Mars Trek tile {cell}.")
        return np.where(values[:, :, 1] > 0, values[:, :, 0], np.nan).astype(np.float32)

    with ThreadPoolExecutor(max_workers=6) as workers:
        tiles = list(workers.map(tile, cells))
    columns = right - left + 1
    mosaic = np.block([tiles[index:index + columns] for index in range(0, len(cells), columns)])
    step = tile_degrees / 256
    tile_transform = from_origin(-180 + left * tile_degrees, 90 - top * tile_degrees, step, step)
    values = np.full(shape, np.nan, dtype=np.float32)
    reproject(mosaic, values, src_crs=MARS_GEOGRAPHIC_CRS, src_transform=tile_transform, src_nodata=np.nan,
              dst_crs=NERETVA_CRS, dst_transform=transform, dst_nodata=np.nan, resampling=Resampling.average)
    return values, {"wmts_level": level, "tile_count": len(cells), "tile_bounds_col_row": [left, top, right, bottom]}


def write_raster(path, values, transform):
    with rasterio.open(
        path, "w", driver="GTiff", width=values.shape[1], height=values.shape[0], count=1,
        dtype=values.dtype, crs=NERETVA_CRS, transform=transform, compress="deflate",
        predictor=3 if values.dtype.kind == "f" else 2, nodata=np.nan if values.dtype.kind == "f" else None,
    ) as dataset:
        dataset.write(values, 1)


def choose_stops(elevation, transform):
    grid = TerrainGrid(elevation, NERETVA_SPACING_M, NERETVA_CRS)
    slope = slope_degrees(grid)
    base = tuple(int(value) for value in rowcol(transform, -29, -15))
    passable = np.where(slope <= 18, 1.0, np.inf)
    if not np.isfinite(passable[base]):
        raise ValueError("The simulated base is impassable on the prepared grid.")
    x, y = grid_axes(transform, slope.shape)
    project = Transformer.from_crs(MARS_GEOGRAPHIC_CRS, NERETVA_CRS, always_xy=True)
    inverse = Transformer.from_crs(NERETVA_CRS, MARS_GEOGRAPHIC_CRS, always_xy=True)
    observations = []
    for entry in OBSERVATIONS:
        east, north = project.transform(*entry["rover_reference"]["lonlat"])
        distances = np.hypot(x[None, :] - east, y[:, None] - north)
        nearby = np.argwhere((slope <= 10) & (distances <= STOP_SEARCH_RADIUS_M))
        for row, col in sorted(nearby, key=lambda cell: distances[tuple(cell)]):
            stop = int(row), int(col)
            try:
                shortest_path(passable, base, stop)
            except RouteUnavailable:
                continue
            break
        else:
            raise ValueError(f"No reachable observation stop near {entry['name']}.")
        observations.append({
            **entry, "modeled_stop_lonlat": inverse.transform(*xy(transform, *stop)),
            "modeled_stop_offset_m": round(float(distances[stop]), 3),
            "modeled_stop_slope_deg": round(float(slope[stop]), 3), "stop_duration_min": 12,
        })
    return inverse.transform(*xy(transform, *base)), observations


def build(cache, output):
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    extent = NERETVA_WIDTH_M / 2
    terrain_transform = from_origin(-extent, extent, NERETVA_SPACING_M, NERETVA_SPACING_M)
    size = NERETVA_WIDTH_M // NERETVA_SPACING_M
    elevation, dtm_window = read_elevation(cache, terrain_transform, (size, size))
    optical_transform = from_origin(-extent, extent, 1, 1)
    optical, wmts_crop = read_optical(cache, optical_transform, (NERETVA_WIDTH_M, NERETVA_WIDTH_M))
    thermal_transform = from_origin(-600, 600, 100, 100)
    thermal = np.full((12, 12), np.nan, dtype=np.float32)
    with rasterio.open(REGIONAL / "thermal.tif") as source:
        reproject(rasterio.band(source, 1), thermal, dst_crs=NERETVA_CRS, dst_transform=thermal_transform,
                  dst_nodata=np.nan, resampling=Resampling.nearest)
    masks = {name: np.isfinite(values) for name, values in (
        ("elevation", elevation), ("optical", optical), ("thermal", thermal),
    )}
    coverage = {name: round(float(mask.mean() * 100), 3) for name, mask in masks.items()}
    if not all(mask.all() for mask in masks.values()):
        raise ValueError(f"The selected site has missing pixels: {coverage}.")
    base, observations = choose_stops(elevation, terrain_transform)
    for name, values, transform in (
        ("elevation", elevation, terrain_transform), ("optical", np.rint(optical).astype(np.uint8), optical_transform),
        ("thermal", thermal, thermal_transform),
    ):
        write_raster(output / f"{name}.tif", values, transform)
    files = ["elevation.tif", "optical.tif", "thermal.tif"]
    for observation in observations:
        image = observation["image"]
        path = fetch(image["asset_url"], cache / image["file"])
        with Image.open(path) as photo:
            photo.verify()
        (output / path.name).write_bytes(path.read_bytes())
        files.append(path.name)
    regional_manifest = json.loads((REGIONAL / "manifest.json").read_text(encoding="utf-8"))
    manifest = {
        "id": "neretva-vallis-v1", "center_lon_e_lat_n": NERETVA_CENTER, "width_m": NERETVA_WIDTH_M,
        "crs": NERETVA_CRS, "grid_spacing_m": {"elevation": 2, "optical": 1, "thermal": 100},
        "valid_pixel_pct": coverage, "dtm_source_crop": dtm_window, "optical_tile_crop": wmts_crop,
        "simulated_base_lonlat": base, "observations": observations,
        "observation_offset_basis": "Planar distance from each archived rover reference to its modeled stop cell centre. The rock location and absolute accuracy are separate questions.",
        "thermal_basis": "Nearest cell from the 100 m regional THEMIS mosaic. Relative infrared DN, for context.",
        "sources": {
            "usgs_trn_publication": "https://doi.org/10.5066/P9REJ9JN",
            "usgs_trn_dtm_1m": DTM, "dtm_header_sha256": DTM_HEADER_SHA256,
            "usgs_trn_ortho_025m": TRN + ORTHO + ".tif", "mars_trek_ortho_wmts": TILES + "/WMTSCapabilities.xml",
            "themis_source_cog": regional_manifest["sources"]["themis_cog"],
            "thermal_input_sha256": sha256(REGIONAL / "thermal.tif"),
        },
        "sha256": {name: sha256(output / name) for name in files},
    }
    with (output / "manifest.json").open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "survey-cache" / "neretva")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "local" / "neretva-vallis")
    options = parser.parse_args()
    build(options.cache, options.output)
