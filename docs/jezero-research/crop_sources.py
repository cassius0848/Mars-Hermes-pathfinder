"""Retrieve small, georeferenced windows from the official USGS COG catalog."""

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_bounds


ROOT = Path(__file__).resolve().parent
GEOGRAPHIC = "+proj=longlat +a=3396190 +b=3396190 +no_defs +type=crs"
LOCAL = "+proj=aeqd +lat_0=18.4588 +lon_0=77.406 +a=3396190 +b=3396190 +units=m +type=crs"
BOUNDS = (77.401, 18.454, 77.411, 18.464)
THERMAL_BOUNDS = (77.36, 18.415, 77.455, 18.505)
ASSETS = {
    "dtm": ("jezero-hirise-stac.json", "DTEEC_002387_1985_003798_1985_A01", "dtm"),
    "ortho": ("jezero-hirise-stac.json", "DTEEC_002387_1985_003798_1985_A01", "ortho_2"),
    "thermal": ("jezero-themis-stac.json", "mc13_syrtis_major_dir", "image"),
}


def extract(name, asset):
    index, item_id, asset_id = asset
    products = json.loads((ROOT / "raw" / index).read_text(encoding="utf-8"))
    item = next(item for item in products["features"] if item["id"] == item_id)
    url = item["assets"][asset_id]["href"]
    with rasterio.open(url) as source:
        area = THERMAL_BOUNDS if name == "thermal" else BOUNDS
        bounds = transform_bounds(GEOGRAPHIC, source.crs, *area, densify_pts=21)
        window = from_bounds(*bounds, transform=source.transform)
        left, top = np.floor([window.col_off, window.row_off]).astype(int)
        right = int(np.ceil(window.col_off + window.width))
        bottom = int(np.ceil(window.row_off + window.height))
        window = Window(left, top, right - left, bottom - top).intersection(
            Window(0, 0, source.width, source.height)
        )
        values = source.read(window=window)
        mask = source.dataset_mask(window=window)
        profile = source.profile.copy()
        profile.update(
            width=int(window.width), height=int(window.height),
            transform=source.window_transform(window), compress="deflate",
        )
        out = ROOT / "derived" / f"jezero-{name}-native.tif"
        with rasterio.open(out, "w", **profile) as target:
            target.write(values)
            target.write_mask(mask)
            target.update_tags(source_url=url, stac_item=item_id, stac_asset=asset_id)
        print(name, item_id, asset_id, source.crs, source.res, source.nodata, values.shape,
              float(np.count_nonzero(mask) / mask.size), flush=True)


if __name__ == "__main__":
    import sys

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="25", GDAL_HTTP_MAX_RETRY="1"):
        for name in sys.argv[1:]:
            extract(name, ASSETS[name])
