"""Export the regional atlas and two local packages for the browser planner."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.features import rasterize
from rasterio.transform import rowcol
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mars_pathfinder.data.jezero_region import (  # noqa: E402
    MARS_GEOGRAPHIC_CRS, REGION_CENTER, REGION_CRS, load_jezero_region,
)
from mars_pathfinder.data.research import (  # noqa: E402
    NERETVA_CENTER, load_hawksbill_gap_package, load_neretva_package,
)
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402

HAWKSBILL = ROOT / "docs" / "jezero-research"
NERETVA = ROOT / "data" / "local" / "neretva-vallis"
ATLAS = ROOT / "data" / "regional" / "jezero-40km"
ROVER_PATH = HAWKSBILL / "raw" / "perseverance-waypoints.json"
STAC = "https://stac.astrogeology.usgs.gov/api/search?collections=mro_hirise_socet_dtms&bbox=77.401,18.454,77.411,18.464&limit=20"
GEOLOGY = "https://doi.org/10.3133/sim3464"
THEMIS = "https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/"
ROVER = "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/"
PALETTES = {
    "optical": ["1e201f", "eee4d6"],
    "elevation": ["21272a", "536456", "a97d52", "e6cc9e", "f2ecda"],
    "slope": ["242623", "6b5838", "d4a762", "be5c42", "fbe3b9"],
    "thermal": ["1c1834", "603477", "be5b54", "ffd990"],
}
GEOLOGY_COLORS = ["b8a174", "cc925f", "ebc886", "87996d", "9e674c", "677e8d", "86a196", "a29277",
                  "b87d70", "c0b875", "ad8262", "8ea4b0", "cc8479", "9eaa66", "ddb58a"]
THREE_FILES = {
    "build/three.module.min.js": "979c1ae4b0579c9901eacf797602c0b46df129d87102c6443d14be4a1f790b70",
    "build/three.core.min.js": "295a28f4a9786dd24a2a357a4ce90921eb041127e53a508335b9a0556c1e0875",
    "LICENSE": "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601",
}


def verify_checksums(folder, expected):
    for name, checksum in expected.items():
        if hashlib.sha256((folder / name).read_bytes()).hexdigest() != checksum:
            raise ValueError(f"Archived data checksum mismatch: {folder / name}")


def archived_checksums(folder, files):
    records = (line.split(maxsplit=1) for line in (folder / "sha256.txt").read_text(encoding="utf-8").splitlines())
    checksums = {name: checksum for checksum, name in records if name in files}
    if checksums.keys() != set(files):
        raise ValueError(f"Checksum file does not cover the exported assets in {folder}.")
    return checksums


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def copy_three(output, cache):
    folder = output / "vendor"
    folder.mkdir(exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    for relative, checksum in THREE_FILES.items():
        name = Path(relative).name
        path = cache / name
        if path.exists():
            data = path.read_bytes()
        else:
            with urlopen(f"https://cdn.jsdelivr.net/npm/three@0.181.2/{relative}", timeout=25) as response:
                data = response.read(500_000)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError(f"Unexpected Three.js file: {name}")
        if not path.exists():
            path.write_bytes(data)
        (folder / name).write_bytes(data)


def raster_rgb(values, bounds, palette):
    colors = np.array([[int(color[n:n + 2], 16) for n in (0, 2, 4)] for color in palette])
    mask = np.isfinite(values)
    low, high = bounds
    scaled = (values[mask] - low) / max(high - low, 0.01)
    rgb = np.full((*values.shape, 3), (29, 28, 26), dtype=np.uint8)
    rgb[mask] = np.column_stack([np.interp(scaled, np.linspace(0, 1, len(colors)), col) for col in colors.T])
    return rgb


def write_layers(folder, elevation, slope, optical, thermal, geology=None, units=None, quality=None):
    valid = np.isfinite(elevation)
    if quality is not None:
        valid &= quality > 0
    e_min, e_max = map(float, (elevation[valid].min(), elevation[valid].max()))
    z_offset = int(np.floor(e_min))
    z_step = 0.01 if e_max - z_offset < 655 else 0.1
    encoded = np.full(elevation.shape, 65535, dtype="<u2")
    encoded[valid] = np.rint((elevation[valid] - z_offset) / z_step).astype(np.uint16)
    encoded.tofile(folder / "elevation.bin")
    slope.astype("<f4").tofile(folder / "slope.bin")
    if quality is not None:
        quality.astype("uint8").tofile(folder / "quality.bin")
    images = {"elevation": raster_rgb(elevation, (e_min, e_max), PALETTES["elevation"]),
              "slope": raster_rgb(slope, (0, 35), PALETTES["slope"]),
              "thermal": raster_rgb(thermal, (0, 255), PALETTES["thermal"]),
              "optical": optical}
    coverage = {"elevation": round(float(np.isfinite(elevation[valid]).mean() * 100), 3),
                "slope": round(float(np.isfinite(slope[valid]).mean() * 100), 3),
                "thermal": round(float(np.isfinite(thermal[valid]).mean() * 100), 3)}
    if quality is not None:
        coverage["quality"] = round(float((quality > 0).mean() * 100), 3)
    if geology is not None:
        colors = GEOLOGY_COLORS if units else []
        image = np.full((*geology.shape, 3), (29, 28, 26), dtype=np.uint8)
        for code, color in zip(units, colors):
            image[geology == code] = tuple(int(color[n:n + 2], 16) for n in (0, 2, 4))
        images["geology"] = image
        coverage["geology"] = round(float(np.isfinite(geology[valid]).mean() * 100), 3)
    for name, pixels in images.items():
        Image.fromarray(pixels).save(folder / f"{name}.webp", quality=92, method=4)
    return {"offset": z_offset, "scale": z_step, "min": e_min, "max": e_max}, coverage


def read_context(path, crs, transform, shape):
    target = np.full(shape, np.nan, dtype=np.float32)
    with rasterio.open(path) as source:
        reproject(rasterio.band(source, 1), target, dst_crs=crs, dst_transform=transform,
                  dst_nodata=np.nan, resampling=Resampling.nearest)
    return target


def rover_trace(crs, transform, shape):
    lonlat = [(*f["geometry"]["coordinates"][:2], f["properties"]["sol"])
              for f in load_json(ROVER_PATH)["features"] if f["geometry"]]
    east, north = Transformer.from_crs(MARS_GEOGRAPHIC_CRS, crs, always_xy=True).transform(*zip(*(c[:2] for c in lonlat)))
    rows, cols = rowcol(transform, east, north)
    return [[round(e, 1), round(n, 1), sol] if 0 <= r < shape[0] and 0 <= c < shape[1] else None
            for e, n, (_, _, sol), r, c in zip(east, north, lonlat, rows, cols)]


def grid_metadata(crs, transform, elevation):
    coord = CRS(crs).coordinate_operation.params
    center = [next(p.value for p in coord if word in p.name.lower()) for word in ("longitude", "latitude")]
    return {"rows": elevation.shape[0], "cols": elevation.shape[1], "step": transform.a,
            "left": transform.c, "top": transform.f, "center": center}


def photo(folder, path):
    with Image.open(path) as picture:
        picture.thumbnail((1100, 780))
        name = Path(path).stem + ".webp"
        picture.convert("RGB").save(folder / name, quality=90)
    return name


def build_local(assets, site_id, package):
    folder = assets / site_id
    folder.mkdir(exist_ok=True)
    is_hawksbill = site_id == "hawksbill"
    crs, transform, elevation = package.terrain.crs, package.transform, package.terrain.elevation
    thermal_path = (HAWKSBILL / "derived" / "jezero-thermal-native.tif") if is_hawksbill else NERETVA / "thermal.tif"
    thermal = read_context(thermal_path, crs, transform, elevation.shape)
    geology, units = None, {}
    if is_hawksbill:
        polygons = []
        for feature in package.geology.features:
            name, shape = feature["properties"].get("name"), feature["geometry"]
            if name and shape["type"] in ("Polygon", "MultiPolygon"):
                code = next((index for index, unit in units.items() if name == unit), len(units) + 1)
                units[code] = name
                polygons.append((shape, code))
        codes = rasterize(polygons, elevation.shape, transform=transform, dtype="uint8")
        geology = np.where(codes, codes, np.nan)
    depth, coverage = write_layers(folder, elevation, package.slope, package.optical_rgb, thermal, geology, units, package.quality)
    coverage["optical"] = 100.0
    slope_delta = float(np.nanmax(np.abs(slope_degrees(package.terrain) - package.slope)))
    if slope_delta > 0.0001:
        raise ValueError(f"Packaged slope differs from the elevation derivatives at {site_id}.")
    audit_note = ("地形与正射采用同一 HiRISE 立体产品。源样点与模拟观察站有 13–17 米偏移。" if is_hawksbill else
                  "采用覆盖完整的 2020 HiRISE 地形。新版西缘高程未覆盖两条预设任务路线，沿线微地形待独立核验。")
    if is_hawksbill:
        cases = [("Swift Run", "对照 Skinner Ridge 的砂岩颗粒和层理。", "https://science.nasa.gov/resource/two-perseverance-sampling-locations-in-jezeros-delta/"),
                 ("Hazeltop", "观察 Wildcat Ridge 细粒沉积岩和含硫酸盐的蚀变证据。", "https://science.nasa.gov/resource/two-perseverance-sampling-locations-in-jezeros-delta/")]
        image_name = photo(folder, HAWKSBILL / "raw" / "perseverance-pia24924-fig-a.png")
        gallery = {"image": photo(folder, HAWKSBILL / "raw" / "perseverance-sol518-mastcam-z.png"),
                   "credit": "Sol 518 · Mastcam-Z 左相机 · NASA/JPL-Caltech/ASU",
                   "url": "https://mars.nasa.gov/mars2020/multimedia/raw-images/index.cfm?mission=mars2020&urlpath=ZL0_0518_0712926829_693ECM_N0261222ZCAM01003_1100LMJ"}
        references = load_json(HAWKSBILL / "derived" / "validation.json")["evidence_lonlat"]
        project = Transformer.from_crs(MARS_GEOGRAPHIC_CRS, crs, always_xy=True)
        targets = [{"name": name, "task": task, "url": url, "image": image_name, "cell": target.location,
                    "reference": project.transform(*references[name]), "offset": target.position_uncertainty_m,
                    "credit": "NASA/JPL-Caltech/ASU/MSSS · Mastcam-Z 标注图"}
                   for (name, task, url), target in zip(cases, package.science_targets)]
        sources = {"HiRISE 立体高程与配套正射": STAC, "USGS Jezero 地质图": GEOLOGY, "Mars Odyssey THEMIS": THEMIS,
                   "NASA PDS MEDA": "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html"}
        meda = {"air_k": round(package.meda_summary["air_temperature"]["ATS_LOCAL_TEMP1"], 1),
                "pressure_pa": round(package.meda_summary["pressure"]["PRESSURE"], 1)}
        files = ["derived/jezero-elevation-local-2m.tif", "derived/jezero-slope-local-2m.tif", "derived/jezero-ortho-native.tif",
                 "derived/jezero-thermal-native.tif", "derived/jezero-geology-local.json", "raw/perseverance-pia24924-fig-a.png",
                 "raw/perseverance-sol518-mastcam-z.png",
                 "probes/meda-518-ats-sample.csv", "probes/meda-518-ps-sample.csv"]
        hashes = archived_checksums(HAWKSBILL, files)
        verify_checksums(HAWKSBILL, hashes)
    else:
        sources = {"USGS HiRISE 地形": "https://doi.org/10.5066/P9REJ9JN", "NASA Mars Trek 正射影像": "https://trek.nasa.gov/mars/",
                   "Mars Odyssey THEMIS": THEMIS, "NASA PDS PLACES": "https://pds-geosciences.wustl.edu/missions/mars2020/places.htm"}
        targets = [{"name": target.name, "task": target.rationale, "url": ref.photograph.page_url,
                    "image": photo(folder, ref.photograph.local_path), "cell": target.location, "reference": ref.xy_m,
                    "offset": ref.modeled_stop_offset_m, "credit": f"Sol {ref.photograph.sol} · SHERLOC WATSON · NASA/JPL-Caltech"}
                   for target, ref in zip(package.science_targets, package.observation_references)]
        targets[0]["task"] = "记录北岸露头的浅色硫酸盐脉和深边斑点，再与南岸岩石对照。"
        targets[1]["task"] = "对照南岸的红色基岩、浅色斑块和毫米级绿斑。绿斑成分仍待确定。"
        hashes = load_json(NERETVA / "manifest.json")["sha256"]
        verify_checksums(NERETVA, hashes)
        meda = gallery = None
    return {**grid_metadata(crs, transform, elevation), "id": site_id, "name": "Hawksbill Gap" if is_hawksbill else "Neretva Vallis",
            "depth": depth, "coverage": coverage, "layers": [*PALETTES, *(["geology"] if units else [])], "base": package.base_point,
            "targets": targets, "rovers": rover_trace(crs, transform, elevation.shape), "sources": sources, "note": audit_note,
            "meda": meda, "gallery": gallery, "hashes": len(hashes), "sourceSpacing": {"thermal": 100, "terrain": float(transform.a)},
            "units": [[name, color] for name, color in zip(units.values(), GEOLOGY_COLORS)],
            "budget": 80 if is_hawksbill else 100}


def build(output, vendor_cache):
    shutil.copytree(ROOT / "web", output, dirs_exist_ok=True)
    copy_three(output, vendor_cache)
    assets = output / "assets"
    atlas_folder = assets / "jezero"
    atlas_folder.mkdir(parents=True, exist_ok=True)
    regional_manifest = load_json(ATLAS / "manifest.json")
    verify_checksums(ATLAS, regional_manifest["sha256"])
    verify_checksums(HAWKSBILL, archived_checksums(HAWKSBILL, ["raw/perseverance-waypoints.json"]))
    atlas = load_jezero_region(ATLAS)
    optical = raster_rgb(atlas.optical, (0, 255), PALETTES["optical"])
    depth, coverage = write_layers(atlas_folder, atlas.elevation, atlas.slope, optical, atlas.thermal, atlas.geology, atlas.units)
    coverage["optical"] = regional_manifest["coverage_pct"]["optical"]
    def cell(lon, lat):
        return [int(v) for v in rowcol(atlas.transform, *atlas.region_xy(lon, lat))]
    hawks = build_local(assets, "hawksbill", load_hawksbill_gap_package(HAWKSBILL))
    neretva = build_local(assets, "neretva", load_neretva_package(NERETVA))
    regional = {**grid_metadata(REGION_CRS, atlas.transform, atlas.elevation), "id": "jezero", "name": "Jezero 区域图",
                "regional": True, "depth": depth, "coverage": coverage, "layers": [*PALETTES, "geology"],
                "base": cell(77.45088572, 18.44462715), "targets": [
                    {"name": "Hawksbill Gap", "cell": cell(*hawks["center"]), "site": "hawksbill"},
                    {"name": "Neretva Vallis", "cell": cell(*NERETVA_CENTER), "site": "neretva"},
                ], "rovers": rover_trace(REGION_CRS, atlas.transform, atlas.elevation.shape),
                "sources": {"NASA Mars Trek CTX": "https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars",
                            "USGS/JPL CTX 地形": regional_manifest["sources"]["ctx_dem"],
                            "USGS Jezero 地质图": GEOLOGY, "Mars Odyssey THEMIS": THEMIS, "NASA 毅力号路线": ROVER},
                "note": "半径 40 km。100 米网格用于区域走廊筛查。点击步行区进入米级导航。",
                "units": [[name, color] for name, color in zip(atlas.units.values(), GEOLOGY_COLORS)],
                "hashes": len(regional_manifest["sha256"]), "sourceSpacing": {"terrain": 100, "thermal": 100}}
    data = {"sites": [regional, hawks, neretva], "archiveSol": int(max(item[2] for item in regional["rovers"] if item)),
            "archiveCount": sum(item is not None for item in regional["rovers"]), "palettes": PALETTES}
    (assets / "sites.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    route_archive = [{"geometry": {"type": "Point", "coordinates": f["geometry"]["coordinates"][:2]},
                      "properties": {key: f["properties"][key] for key in ("RMC", "sol")}}
                     for f in load_json(ROVER_PATH)["features"] if (f.get("geometry") or {}).get("type") == "Point"]
    (assets / "rover-waypoints.json").write_text(json.dumps({"features": route_archive}, separators=(",", ":")), encoding="utf-8")
    print(f"Browser package: {sum(p.stat().st_size for p in output.rglob('*') if p.is_file()) / 1e6:.2f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--vendor-cache", type=Path, default=ROOT / "survey-cache" / "web-vendor")
    options = parser.parse_args()
    build(options.output, options.vendor_cache)
