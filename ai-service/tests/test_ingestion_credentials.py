import pytest

from main import _public_detection_plate_fields, _required_ingestion_credentials
from loaders.ufpr_alpr import UfprAlprLoader


def test_ingestion_credentials_fail_closed_when_unset(monkeypatch):
    monkeypatch.delenv("INGEST_USERNAME", raising=False)
    monkeypatch.delenv("INGEST_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="not configured"):
        _required_ingestion_credentials()


def test_public_detection_response_does_not_expose_ocr_text():
    result = _public_detection_plate_fields("REDACTED")

    assert result == {"plate_text": None, "plate_detected": True}


def test_ufpr_loader_does_not_embed_plate_identifiers():
    assert "LEAKED_PLATE_INFO" not in vars(UfprAlprLoader)

