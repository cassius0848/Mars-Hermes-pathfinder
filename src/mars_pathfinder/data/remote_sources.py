"""On-demand readers for official NASA and USGS endpoints.

These helpers deliberately return small metadata/feature responses or URLs. They
never mirror a full mission archive into the repository.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.parse import urlencode
from urllib.request import Request, urlopen


PERSEVERANCE_RAW_API = (
    "https://mars.nasa.gov/rss/api/?feed=raw_images&"
    "category=mars2020,ingenuity&feedtype=json&ver=1.2"
)
PERSEVERANCE_RAW_IMAGES_PAGE = "https://mars.nasa.gov/mars2020/multimedia/raw-images/"
MARS_TREK_MOLA_EXPORT = (
    "https://trek.nasa.gov/mars/trekarcgis/rest/services/"
    "mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/exportImage"
)
MARS_TREK_VIEW = "https://trek.nasa.gov/mars/"
USGS_JEZERO_GEOLOGY_LAYER = (
    "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
    "Jezero_FeatureServiceFromPro/FeatureServer/8"
)
CURIOSITY_MOUNT_SHARP_PAGE = "https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/"
CURIOSITY_MOUNT_SHARP_ASSET = (
    "https://assets.science.nasa.gov/content/dam/science/psd/mars/"
    "downloadable_items/4/42763_PIA23179-combo-rev_main.gif"
)


@dataclass(frozen=True)
class RemoteRawImage:
    """Small provenance record for one NASA Perseverance image."""

    image_id: str
    sol: int
    instrument: str
    title: str
    caption: str
    small_url: str
    medium_url: str
    large_url: str
    page_url: str
    date_taken_utc: str
    credit: str


def _get_json(url: str, timeout: int = 30) -> dict:
    request = Request(url, headers={"User-Agent": "mars-pathfinder-ai/1.0"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_perseverance_latest(limit: int = 6, page: int = 1, sol: int | None = None) -> list[RemoteRawImage]:
    """Fetch a small page of current Perseverance metadata from NASA.

    Only JSON metadata and remote image URLs are returned. The image bytes remain
    on NASA's CDN until Streamlit renders a selected thumbnail.
    """

    params = {"num": max(1, min(limit, 50)), "page": max(1, page), "order": "sol desc"}
    if sol is not None:
        params.update({"begin_sol": sol, "end_sol": sol})
    payload = _get_json(PERSEVERANCE_RAW_API + "&" + urlencode(params))
    records: list[RemoteRawImage] = []
    for item in payload.get("images", []):
        files = item.get("image_files") or {}
        camera = item.get("camera") or {}
        records.append(RemoteRawImage(
            image_id=str(item.get("imageid", "")),
            sol=int(item.get("sol", 0)),
            instrument=str(camera.get("instrument", "unknown")),
            title=str(item.get("title", "Perseverance raw image")),
            caption=str(item.get("caption", "")),
            small_url=str(files.get("small", "")),
            medium_url=str(files.get("medium", "")),
            large_url=str(files.get("large", files.get("full_res", ""))),
            page_url=str(item.get("link", PERSEVERANCE_RAW_IMAGES_PAGE)),
            date_taken_utc=str(item.get("date_taken_utc", "")),
            credit=str(item.get("credit", "NASA/JPL-Caltech")),
        ))
    return records


def build_mola_export_url(
    bbox: tuple[float, float, float, float], *, size: int = 256, pixel_type: str = "F32"
) -> str:
    """Build a bounded NASA Mars Trek MOLA export URL without downloading it."""

    params = {
        "bbox": ",".join(f"{value:g}" for value in bbox),
        "bboxSR": "104905",
        "imageSR": "104905",
        "size": f"{size},{size}",
        "format": "tiff",
        "pixelType": pixel_type,
        "interpolation": "RSP_Bilinear",
        "f": "image",
    }
    return MARS_TREK_MOLA_EXPORT + "?" + urlencode(params)


def build_usgs_geology_query_url(*, limit: int = 20, where: str = "1=1") -> str:
    """Build a small GeoJSON query against the official USGS SIM 3464 layer."""

    params = {
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "resultRecordCount": max(1, min(limit, 200)),
        "f": "geojson",
    }
    return USGS_JEZERO_GEOLOGY_LAYER + "/query?" + urlencode(params)


def fetch_usgs_geology(limit: int = 20) -> dict:
    """Fetch a bounded live GeoJSON response from USGS SIM 3464."""

    return _get_json(build_usgs_geology_query_url(limit=limit))
