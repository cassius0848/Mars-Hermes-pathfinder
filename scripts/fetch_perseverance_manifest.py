"""Build a provenance manifest from the NASA Perseverance raw-image gallery.

The gallery currently exposes many browse images. This script records their
public URLs and Sol/camera information without downloading the full archive.
Use the manifest to select only the images needed for science waypoints.

从 NASA Perseverance 原始图像页建立溯源清单。清单只记录公开 URL、Sol 和
相机信息，按需下载科学节点图像，避免下载整个图像档案。
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from urllib.request import urlopen

GALLERY_URL = "https://mars.nasa.gov/mars2020/multimedia/raw-images/image-of-the-week/"
IMAGE_RE = re.compile(r"https://mars\.nasa\.gov/mars2020-raw-images/[^\"' )]+\.(?:jpg|jpeg|png)", re.I)
SOL_RE = re.compile(r"/sol/(\d+)")
CAMERA_RE = re.compile(r"/browse/([^/]+)/")


def build_manifest(output: Path) -> None:
    with urlopen(GALLERY_URL, timeout=60) as response:
        page = html.unescape(response.read().decode("utf-8", errors="replace"))
    urls = list(dict.fromkeys(IMAGE_RE.findall(page)))
    records = []
    for url in urls:
        sol_match = SOL_RE.search(url)
        camera_match = CAMERA_RE.search(url)
        records.append({
            "url": url,
            "sol": int(sol_match.group(1)) if sol_match else None,
            "camera_group": camera_match.group(1) if camera_match else None,
            "mission": "Mars 2020 Perseverance",
            "role": "candidate surface evidence; select and download with provenance before use",
            "source_page": GALLERY_URL,
            "attribution": "NASA/JPL-Caltech",
        })
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"source_page": GALLERY_URL, "count": len(records), "images": records}, indent=2) + "\n")
    print(f"Wrote {len(records)} image records to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/raw/perseverance/raw_image_manifest.json"))
    args = parser.parse_args()
    build_manifest(args.output)
