"""Release identity and immutable environment-bundle checks use only the standard library."""

import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from web_release import source_digest, verify_environment_bundle, write_build_info


class WebReleaseTests(unittest.TestCase):
    def test_source_identity_ignores_platform_newlines_but_detects_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "app.js").write_bytes(b"const x = 1;\r\n")
            expected = source_digest(root)
            (root / "app.js").write_bytes(b"const x = 1;\n")
            self.assertEqual(source_digest(root), expected)
            (root / "app.js").write_bytes(b"const x = 2;\n")
            self.assertNotEqual(source_digest(root), expected)

    def test_environment_archive_is_verified_before_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            packed = gzip.compress(b"measured atlas payload", mtime=0)
            (root / "atlas-regional.bin.gz").write_bytes(packed)
            (root / "atlas-regional.json").write_text(json.dumps({
                "sha256": hashlib.sha256(packed).hexdigest(), "bytes": 22
            }))
            verify_environment_bundle(root)
            (root / "atlas-regional.bin.gz").write_bytes(packed + b"changed")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_environment_bundle(root)

    def test_build_manifest_identifies_commit_and_every_published_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "web").mkdir()
            output = root / "dist"
            (output / "assets").mkdir(parents=True)
            (root / "web" / "app.js").write_bytes(b"app\n")
            (output / "app.js").write_bytes(b"app\n")
            (output / "assets" / "height.bin").write_bytes(b"\0\1\2")
            with patch("web_release.git_commit", return_value="a" * 40):
                record = write_build_info(root, output)
                second = write_build_info(root, output)
            self.assertEqual(record, second)
            self.assertEqual(record["source_commit"], "a" * 40)
            self.assertEqual(set(record["files_sha256"]), {"app.js", "assets/height.bin"})
            self.assertEqual(record["files_sha256"]["assets/height.bin"], hashlib.sha256(b"\0\1\2").hexdigest())


if __name__ == "__main__":
    unittest.main()
