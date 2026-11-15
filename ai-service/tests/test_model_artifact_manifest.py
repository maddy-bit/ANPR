"""Fail-closed model readiness checks that do not create or modify weights."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.model_artifact_manifest import ModelManifestError, verify_model_manifest


class ModelArtifactManifestTests(unittest.TestCase):
    def test_missing_bundle_is_not_reported_as_ready(self):
        with patch.dict(os.environ, {"MODEL_CACHE_DIR": ""}):
            with self.assertRaisesRegex(ModelManifestError, "MODEL_CACHE_DIR"):
                verify_model_manifest(model_root=None)

    def test_incomplete_manifest_fails_when_required_weights_are_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "model-manifest.json"
            manifest.write_text(json.dumps({
                "schemaVersion": 1,
                "releaseId": "unprovisioned",
                "artifacts": [],
            }), encoding="utf-8")

            with self.assertRaisesRegex(ModelManifestError, "Required model artifact is missing"):
                verify_model_manifest(manifest_path=manifest, model_root=root)


if __name__ == "__main__":
    unittest.main()

