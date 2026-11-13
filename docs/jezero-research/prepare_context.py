"""Preserve Mars CRS while preparing the Mars Trek and USGS context layers."""

import json

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from shapely import box, make_valid, transform, union_all
from shapely.geometry import LineString, Polygon, mapping

from crop_sources import GEOGRAPHIC, LOCAL, ROOT


def mosaic_trek_tiles():
    directory = ROOT / "raw" / "mars-trek-wmts-z16"
    tiles = {tuple(map(int, p.stem.split("-"))): p for p in directory.glob("*.png")}
    top, bottom = min(r for r, _ in tiles), max(r for r, _ in tiles)
    left, right = min(c for _, c in tiles), max(c for _, c in tiles)
    width, height = (right-left+1)*256, (bottom-top+1)*256
    pixels = np.zeros((height, width, 4), dtype=np.uint8)
    for row in range(top, bottom+1):
        for col in range(left, right+1):
            with Image.open(tiles[row, col]) as tile:
                assert tile.size == (256, 256)
                x, y = (col-left)*256, (row-top)*256
                pixels[y:y+256, x:x+256] = np.asarray(tile.convert("RGBA"))
    step = 360 / (131072 * 256)
    northwest = (-180 + left*256*step, 90 - top*256*step)
    with rasterio.open(ROOT / "derived" / "jezero-mars-trek-wmts.tif", "w", driver="GTiff",
                       width=width, height=height, count=4, dtype="uint8", compress="deflate",
                       crs=CRS.from_string(GEOGRAPHIC), transform=from_origin(*northwest, step, step),
                       photometric="RGB") as target:
        target.write(pixels.transpose(2, 0, 1))
        target.colorinterp = [rasterio.enums.ColorInterp[name] for name in ("red", "green", "blue", "alpha")]
        target.update_tags(mission="Mars Reconnaissance Orbiter HiRISE", source="NASA JPL Mars Trek WMTS",
                           layer="JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", matrix="16")
    print(f"Mars Trek mosaic {width}×{height} from {len(tiles)} tiles, opaque fraction {(pixels[...,3]>0).mean():.4f}")


def geology_context():
    source = ROOT / "raw"
    layer_info = json.loads((source / "jezero-geology-layer.json").read_text(encoding="utf-8"))
    crs = layer_info["extent"]["spatialReference"]["wkt"]
    project = Transformer.from_crs(crs, LOCAL, always_xy=True).transform
    task_area = box(-260, -260, 260, 260)
    counts = {}
    features = []
    for layer in (5, 7, 8):
        records = json.loads((source / f"sim3464-layer-{layer}.json").read_text(encoding="utf-8"))["features"]
        count = 0
        for record in records:
            geometry = record["geometry"]
            if "paths" in geometry:
                shape = union_all([LineString(points) for points in geometry["paths"]])
            else:
                rings = [make_valid(Polygon(ring)) for ring in geometry["rings"]]
                shape = rings[0]
                for ring in rings[1:]:
                    shape = shape.symmetric_difference(ring)
            clipped = transform(shape, project, interleaved=False).intersection(task_area)
            if not clipped.is_empty:
                count += 1
                attributes = record["attributes"]
                props = {key: attributes[key] for key in ("OBJECTID", "name", "symbol", "TYPE") if key in attributes}
                features.append({"layer": layer, "properties": props, "geometry": mapping(clipped)})
        counts[layer] = count
    (ROOT / "derived" / "jezero-geology-local.json").write_text(json.dumps({
        "coordinate_reference": LOCAL, "source": "USGS SIM 3464", "features": features,
    }, indent=2), encoding="utf-8")
    print(f"SIM 3464 features intersecting the 520 m square, by layer: {counts}")


if __name__ == "__main__":
    mosaic_trek_tiles()
    geology_context()
