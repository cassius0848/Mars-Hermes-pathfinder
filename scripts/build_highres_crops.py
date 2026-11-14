import io
import math
import ssl
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
import tifffile
from pyproj import CRS
from rasterio.transform import from_origin


SOURCE = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
SOURCE_SIZE = 1_839_545_409
RADIUS = 3_396_190.0
SOURCE_TAG = (4577366.0, 1106618.0)
SOURCE_SCALE = 1.0
SOURCE_WIDTH = 21400
SOURCE_HEIGHT = 21488
LOCAL_CRS = lambda lon, lat: CRS.from_proj4(
    f"+proj=aeqd +lat_0={lat} +lon_0={lon} +a=3396190 +b=3396190 +units=m"
)


class RangeFile(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos, self.cache = url, size, 0, {}
        self.context = ssl._create_unverified_context()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        elif whence == io.SEEK_END:
            self.pos = self.size + offset
        else:
            raise ValueError(whence)
        return self.pos

    def read(self, size=-1):
        if size == 0:
            return b""
        if size < 0:
            raise OSError("unbounded reads are not allowed")
        first, last = self.pos, self.pos + size - 1
        key = (first, last)
        if key not in self.cache:
            request = urllib.request.Request(self.url, headers={"Range": f"bytes={first}-{last}"})
            with urllib.request.urlopen(request, timeout=120, context=self.context) as response:
                data = response.read()
            if len(data) != size:
                raise OSError(f"short range: {first}-{last} -> {len(data)} bytes")
            self.cache[key] = data
        data = self.cache[key]
        self.pos += len(data)
        return data


def crop(page, name, lon, lat, span=520):
    x = RADIUS * math.radians(lon)
    y = RADIUS * math.radians(lat)
    col = round((x - SOURCE_TAG[0]) / SOURCE_SCALE)
    row = round((SOURCE_TAG[1] - y) / SOURCE_SCALE)
    half = span // 2
    first_row, last_row = row - half, row + half - 1
    first_col, last_col = col - half, col + half - 1
    if first_row < 0 or last_row >= SOURCE_HEIGHT or first_col < 0 or last_col >= SOURCE_WIDTH:
        raise ValueError(f"{name} crop is outside the source DTM")
    offsets = page.dataoffsets
    counts = page.databytecounts
    first_byte = offsets[first_row]
    last_byte = offsets[last_row] + SOURCE_WIDTH * 4 - 1
    request = urllib.request.Request(SOURCE, headers={"Range": f"bytes={first_byte}-{last_byte}"})
    with urllib.request.urlopen(request, timeout=180, context=ssl._create_unverified_context()) as response:
        raw = response.read()
    expected = (last_row - first_row + 1) * page.tags["ImageWidth"].value * 4
    if len(raw) != expected:
        raise OSError(f"{name}: expected {expected} bytes, received {len(raw)}")
    all_rows = np.frombuffer(raw, dtype="<f4").reshape(last_row - first_row + 1, SOURCE_WIDTH)
    values = all_rows[:, first_col:last_col + 1].copy()
    nodata = np.float32(-3.4028226550889045e38)
    valid = np.isfinite(values) & (values != nodata) & (values > -10000) & (values < 10000)
    values[~valid] = np.nan
    if valid.mean() < 0.99:
        raise ValueError(f"{name}: only {valid.mean() * 100:.2f}% valid pixels")
    slope_y, slope_x = np.gradient(values, 1.0, 1.0)
    slope = np.degrees(np.arctan(np.hypot(slope_x, slope_y))).astype("float32")
    quality = valid.astype("uint8")
    out = (Path("docs/jezero-research/derived") if name == "hawksbill"
           else Path("data/local/neretva-vallis"))
    out.mkdir(parents=True, exist_ok=True)
    prefix = "jezero-" if name == "hawksbill" else ""
    transform = from_origin(-half, half, 1, 1)
    crs = LOCAL_CRS(lon, lat)
    profile = dict(driver="GTiff", width=span, height=span, count=1, dtype="float32",
                   crs=crs, transform=transform, nodata=np.nan, compress="deflate", predictor=3)
    with rasterio.open(out / f"{prefix}elevation-local-1m.tif" if prefix else out / "elevation-1m.tif", "w", **profile) as dst:
        dst.write(values, 1)
    with rasterio.open(out / f"{prefix}slope-local-1m.tif" if prefix else out / "slope-1m.tif", "w", **profile) as dst:
        dst.write(slope, 1)
    with rasterio.open(out / f"{prefix}quality-local-1m.tif" if prefix else out / "quality-1m.tif", "w",
                       **{**profile, "dtype": "uint8", "nodata": 0, "predictor": 2}) as dst:
        dst.write(quality, 1)
    print(name, {"source_window": [first_col, first_row, span, span],
                 "coverage": round(float(valid.mean() * 100), 3),
                 "elevation_m": [round(float(np.nanmin(values)), 2), round(float(np.nanmax(values)), 2)],
                 "slope_deg": round(float(np.nanmax(slope)), 2)})


with tifffile.TiffFile(RangeFile(SOURCE, SOURCE_SIZE)) as tif:
    page = tif.pages[0]
    crop(page, "hawksbill", 77.406, 18.4588)
    crop(page, "neretva", 77.3030, 18.4945, span=1120)

