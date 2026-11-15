"""Private shared-media access for API and independent inference workers."""

from __future__ import annotations

import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any, Iterator


def validate_s3_reference(bucket: str | None, key: str | None) -> tuple[str, str]:
    expected_bucket = os.environ.get("S3_BUCKET", "").strip()
    normalized_bucket = str(bucket or "").strip()
    normalized_key = str(key or "").strip()
    if not expected_bucket:
        raise RuntimeError("S3_BUCKET is required when processing S3-backed video uploads")
    if normalized_bucket != expected_bucket:
        raise ValueError("Video object bucket does not match the configured private media bucket")
    if not normalized_key or normalized_key.startswith("/") or "\\" in normalized_key:
        raise ValueError("Video object key is invalid")
    key_parts = normalized_key.split("/")
    if any(part in {"", ".", ".."} for part in key_parts) or len(normalized_key) > 1024:
        raise ValueError("Video object key is invalid")
    # Node writes only date-partitioned UUID video uploads. Keep the AI service
    # from being used as a general-purpose S3 object reader.
    if not re.fullmatch(r"\d{4}/\d{2}/\d{2}/[0-9a-fA-F-]{36}\.(mp4|mov|avi|mkv|webm)", normalized_key):
        raise ValueError("Video object key is outside the permitted upload namespace")
    return normalized_bucket, normalized_key


def _s3_client() -> Any:
    import boto3

    region = os.environ.get("AWS_REGION")
    if not region:
        raise RuntimeError("AWS_REGION is required when processing S3-backed video uploads")
    endpoint = os.environ.get("S3_ENDPOINT", "").strip() or None
    access_key_id = os.environ.get("AWS_ACCESS_KEY_ID", "").strip() or None
    secret_access_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "").strip() or None
    if bool(access_key_id) != bool(secret_access_key):
        raise RuntimeError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together")
    if endpoint and not access_key_id:
        raise RuntimeError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required with S3_ENDPOINT")

    # AWS roles remain supported when no custom endpoint or static keys are set.
    options: dict[str, Any] = {"region_name": region}
    if endpoint:
        options["endpoint_url"] = endpoint
    if access_key_id and secret_access_key:
        options["aws_access_key_id"] = access_key_id
        options["aws_secret_access_key"] = secret_access_key
    return boto3.client("s3", **options)


def head_s3_object(bucket: str | None, key: str | None) -> dict[str, Any]:
    safe_bucket, safe_key = validate_s3_reference(bucket, key)
    return _s3_client().head_object(Bucket=safe_bucket, Key=safe_key)


@contextmanager
def materialize_video(storage_provider: str, video_path: str | None = None,
                      storage_bucket: str | None = None, storage_key: str | None = None) -> Iterator[str]:
    """Yield a local path for OpenCV, downloading S3 objects to a temporary file."""
    provider = str(storage_provider or "LOCAL").upper()
    if provider == "LOCAL":
        if not video_path or not Path(video_path).is_file():
            raise FileNotFoundError("Recorded video file is unavailable on the local worker")
        yield video_path
        return
    if provider != "S3":
        raise ValueError(f"Unsupported video storage provider: {provider}")

    bucket, key = validate_s3_reference(storage_bucket, storage_key)
    metadata = head_s3_object(bucket, key)
    max_bytes = int(os.environ.get("STORAGE_MAX_FILE_SIZE_MB", "500")) * 1024 * 1024
    content_length = int(metadata.get("ContentLength") or 0)
    if content_length <= 0 or content_length > max_bytes:
        raise ValueError("Stored video is empty or exceeds the configured size limit")
    suffix = PurePosixPath(key).suffix[:16]
    fd, temp_path = tempfile.mkstemp(prefix="sih26127-video-", suffix=suffix)
    os.close(fd)
    try:
        _s3_client().download_file(bucket, key, temp_path)
        yield temp_path
    finally:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass

