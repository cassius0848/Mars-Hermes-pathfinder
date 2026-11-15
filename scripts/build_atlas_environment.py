"""Build the atlas routing data bundle from the PDS raster pair and original Zarr chunks."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from numcodecs import blosc
import zstandard

TES_URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/"
ARCO_URL = "https://huggingface.co/datasets/ananyo01/ARCO-OpenMars/resolve/main/openmars_MY24-27.zarr"
TILES = (
    ("jezero", 75, 16, 81, 21),
    ("gale", 134, -8, 141, -2),
    ("endeavour", -9, -6, -2, 2),
    ("eberswalde", -37, -28, -30, -20),
)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def archive_array(directory, key):
    metadata = json.loads((directory / f"{key}.zarr.json").read_text())
    packed = (directory / f"{key}.chunk").read_bytes()
    name = metadata["codecs"][-1]["name"]
    if name == "blosc":
        values = blosc.decompress(packed)
    elif name == "zstd":
        values = zstandard.decompress(packed)
    else:
        raise ValueError(f"Unsupported codec {name} in {key}")
    return np.frombuffer(values, dtype=np.dtype(metadata["data_type"]).newbyteorder("<"))


def build(source, destination):
    tes_file, mask_file = source / "full-tes.img", source / "full-mask.img"
    shape = (3600, 7200)
    assert tes_file.stat().st_size == 51_840_000 and mask_file.stat().st_size == 25_920_000
    tes = np.memmap(tes_file, dtype=">i2", mode="r", shape=shape)
    mask = np.memmap(mask_file, dtype="u1", mode="r", shape=shape)
    bundle = bytearray()

    def add(array, dtype):
        offset = len(bundle)
        bundle.extend(array.astype(dtype, copy=False).tobytes())
        return offset

    def pack_tes(id, west, north, degrees, grid, flag):
        valid = (grid >= 5) & (grid <= 5000)
        words = np.where(valid, grid | np.where(flag == 0, 32768, 0), 0)
        return {"id": id, "west": west, "north": north, "degrees": degrees,
                "rows": grid.shape[0], "cols": grid.shape[1], "offset": add(words, "<u2")}

    tiles = []
    for name, west, south, east, north in TILES:
        y = slice((90 - north) * 20, (90 - south) * 20)
        x = slice((west + 180) * 20, (east + 180) * 20)
        tiles.append(pack_tes(name, west, north, 0.05, tes[y, x], mask[y, x]))
    tiles.append(pack_tes("global", -180, 90, 0.25, tes[2::5, 2::5], mask[2::5, 2::5]))

    lat = archive_array(source, "lat")
    lon = archive_array(source, "lon")
    mars_time = archive_array(source, "time")
    ls = archive_array(source, "Ls")
    year = archive_array(source, "MY")
    assert np.allclose(lat, np.arange(87.5, -90, -5), atol=0.00005)
    assert np.allclose(lon, np.arange(-180, 180, 5), atol=0.00005)
    readings = {key: archive_array(source, key).reshape((120, len(lat), len(lon))) for key in ("ps", "tsurf")}
    snapshots = []
    for time_index in (4, 7):
        assert year[time_index] == 24 and 98 < ls[time_index] < 99
        snapshot = {"id": f"my24-{time_index}", "year": int(year[time_index]),
                    "sourceSol": float(mars_time[time_index]), "ls": float(ls[time_index]),
                    "primeHour": round((float(mars_time[time_index]) % 1) * 24, 2), "index": time_index}
        for key, array in readings.items():
            values = array[time_index]
            assert np.all(np.isfinite(values))
            assert values.dtype == np.dtype("<f4"), f"Preserve the native {key} encoding"
            snapshot[key] = add(values, "<f4")
        snapshots.append(snapshot)

    destination.mkdir(parents=True, exist_ok=True)
    payload = gzip.compress(bundle, compresslevel=9, mtime=0)
    (destination / "atlas-regional.bin.gz").write_bytes(payload)
    metadata = {
        "encoding": "gzip", "bytes": len(bundle), "sha256": hashlib.sha256(payload).hexdigest(),
        "tes": {
            "title": "NASA PDS · MGS TES 夜侧热惯量",
            "source": "https://pds-geosciences.wustl.edu/missions/mgs/tes-timap.html",
            "data": TES_URL + "global_ti_night_2007.img",
            "label": TES_URL + "global_ti_night_2007.lbl",
            "mask": TES_URL + "global_ti_msk_night_2007.img",
            "dataSha256": sha256(tes_file), "maskSha256": sha256(mask_file),
            "unit": "J m⁻² K⁻¹ s⁻½", "tiles": tiles,
        },
        "climate": {
            "title": "OpenMARS · 地表气压和地表温度（再分析）",
            "source": "https://doi.org/10.21954/ou.rd.7352270",
            "conversion": "https://doi.org/10.57967/hf/8741",
            "gridDegrees": 5, "rows": len(lat), "cols": len(lon),
            "northCenter": float(lat[0]), "westCenter": float(lon[0]),
            "snapshots": snapshots,
            "products": {key: {"url": f"{ARCO_URL}/{key}/c/{'0/0/0' if key in readings else '0'}",
                               "sha256": sha256(source / f"{key}.chunk")} for key in ("lat", "lon", "time", "Ls", "MY", "ps", "tsurf")},
        },
        "solar": {
            "title": "NASA GISS · Mars24 太阳几何参考",
            "source": "https://www.giss.nasa.gov/tools/mars24/help/algorithm.html",
        },
    }
    (destination / "atlas-regional.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(bundle)} raw bytes, {len(payload)} gzip bytes; {len(tiles)} thermal-inertia grids, {len(snapshots)} OpenMARS snapshots")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Folder containing the checked PDS rasters and Zarr chunks")
    parser.add_argument("destination", type=Path, help="Folder for the generated assets")
    args = parser.parse_args()
    build(args.source, args.destination)
