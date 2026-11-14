"""Verify the real assets required by the judge demo."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mars_pathfinder.data.jezero_region import load_jezero_region
from mars_pathfinder.data.research import load_hawksbill_gap_package


def require_files(paths: list[Path]) -> None:
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing demo assets:\n" + "\n".join(missing))


def verify_regional_assets() -> None:
    regional = ROOT / "data" / "regional" / "jezero-40km"
    required = [regional / "manifest.json", *(regional / f"{name}.tif" for name in ("terrain", "optical", "thermal", "geology"))]
    require_files(required)

    manifest = json.loads((regional / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest.get("sha256", {}).items():
        digest = hashlib.sha256((regional / name).read_bytes()).hexdigest()
        if digest != expected:
            raise ValueError(f"SHA-256 mismatch for {regional / name}")

    region = load_jezero_region(regional)
    if region.elevation.shape != (800, 800):
        raise ValueError(f"Unexpected regional grid shape: {region.elevation.shape}")


def verify_local_assets() -> None:
    research = ROOT / "docs" / "jezero-research"
    required = [
        research / "derived" / "jezero-elevation-local-2m.tif",
        research / "derived" / "jezero-slope-local-2m.tif",
        research / "derived" / "jezero-ortho-native.tif",
        research / "derived" / "jezero-thermal-native.tif",
        research / "derived" / "jezero-geology-local.json",
        research / "derived" / "validation.json",
        research / "derived" / "jezero-route-preview.json",
        research / "raw" / "perseverance-waypoints.json",
        research / "raw" / "perseverance-sol518-mastcam-z.png",
        research / "probes" / "meda-518-ats-sample.csv",
        research / "probes" / "meda-518-ps-sample.csv",
        ROOT / "data" / "raw" / "perseverance" / "sol1934_sample.jpg",
        ROOT / "data" / "raw" / "references" / "curiosity_mount_sharp_path.gif",
    ]
    require_files(required)

    package = load_hawksbill_gap_package(research)
    expected = {(260, 260), (520, 520)}
    if package.terrain.shape not in expected:
        raise ValueError(f"Unexpected Hawksbill Gap grid shape: {package.terrain.shape}")
    if package.terrain.cell_size_m not in (1.0, 2.0):
        raise ValueError(f"Unexpected Hawksbill Gap grid spacing: {package.terrain.cell_size_m}")


def main() -> int:
    verify_regional_assets()
    verify_local_assets()
    print("Demo assets verified: Jezero regional atlas + Hawksbill Gap research package")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
