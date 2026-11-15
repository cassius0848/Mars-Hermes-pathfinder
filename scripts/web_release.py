"""Validate bundled atlas data and identify the exact source/build being published."""

from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
from pathlib import Path

TEXT_EXTENSIONS = {".js", ".json", ".html", ".css", ".md", ".txt"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_environment_bundle(web: Path) -> None:
    metadata = web / "atlas-regional.json"
    if not metadata.exists():
        return
    record = json.loads(metadata.read_text(encoding="utf-8"))
    packed = (web / "atlas-regional.bin.gz").read_bytes()
    if sha256(packed) != record["sha256"]:
        raise ValueError("Atlas environment archive checksum does not match its source record")
    if len(gzip.decompress(packed)) != record["bytes"]:
        raise ValueError("Atlas environment payload size does not match its source record")


def source_digest(web: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(web.rglob("*")):
        if not path.is_file() or path.name == "build-info.json":
            continue
        data = path.read_bytes()
        if path.suffix in TEXT_EXTENSIONS:
            data = data.replace(b"\r\n", b"\n")
        digest.update(path.relative_to(web).as_posix().encode() + b"\0")
        digest.update(hashlib.sha256(data).digest())
    return digest.hexdigest()


def git_commit(root: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def write_build_info(root: Path, output: Path) -> dict:
    files = {
        path.relative_to(output).as_posix(): sha256(path.read_bytes())
        for path in sorted(output.rglob("*"))
        if path.is_file() and path.name != "build-info.json"
    }
    manifest = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    record = {
        "repository": "cassius0848/mars-pathfinder-ai",
        "source_commit": git_commit(root),
        "web_source_sha256": source_digest(root / "web"),
        "build_command": "python scripts/build_web.py",
        "artifact_sha256": sha256(manifest),
        "files_sha256": files,
    }
    (output / "build-info.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return record
