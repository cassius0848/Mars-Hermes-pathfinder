"""Fetch small, reproducible Mars resource samples for local development.

This script intentionally downloads a bounded MOLA subset instead of a global
raster. Large science products should remain outside Git and be referenced by
metadata in data/raw/.

下载可复现的小型火星资源样本。脚本只下载有限范围的 MOLA 子集，避免将
全球大文件提交到 Git；大型科学产品应通过元数据引用。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import urlopen

MOLA_EXPORT = "https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/exportImage"
BBOX = (77.0, 18.0, 78.0, 19.0)  # Jezero-area development window, EPSG:104905


def download_mola(output: Path, size: int = 256) -> None:
    # The bounded export keeps the sample reviewable and fast to download.
    # 有限范围导出便于审查，也能快速下载和测试。
    query = (
        f"?bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
        f"&bboxSR=104905&imageSR=104905&size={size},{size}"
        "&format=tiff&pixelType=F32&interpolation=RSP_Bilinear&f=image"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(MOLA_EXPORT + query, timeout=60) as response:
        output.write_bytes(response.read())
    metadata = {
        "name": "Jezero MOLA DEM sample",
        "source": "NASA Mars Trek MOLA ImageServer",
        "export_url": MOLA_EXPORT,
        "bbox": list(BBOX),
        "bbox_crs": "EPSG:104905",
        "image_size": [size, size],
        "elevation_units": "meters",
        "purpose": "bounded development sample; not a complete science product",
    }
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/raw/jezero_mola_256.tif"))
    parser.add_argument("--size", type=int, default=256)
    args = parser.parse_args()
    download_mola(args.output, args.size)
    print(f"Downloaded {args.output}")
