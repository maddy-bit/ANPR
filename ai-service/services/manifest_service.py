"""
Manifest Streaming Protocol Service (B4.3).

Implements:
1. StreamingManifestWriter: Incremental NDJSON writer with O(1) memory bound,
   deterministic 7-element intra-frame proposal sorting, rolling SHA-256 over Header + Events,
   strict Re-ID provenance validation, and trailer sealing.
2. validate_manifest: Streaming NDJSON validator verifying header, every event,
   canonical idempotency key against header IDs, FastReID 2048-dim finite embeddings,
   trailer structure, event count, and rolling SHA-256 digest.
3. publish_manifest_no_clobber: Atomic hard-link publication (os.link) with strict
   no-clobber semantics, same-filesystem verification, Windows reparse-point safeguards,
   staging pre-validation, dual run-ID + payload SHA-256 deduplication, and fail-closed error handling.
"""

from __future__ import annotations
import os
import sys
import json
import math
import stat
import uuid
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Union, Sequence, Tuple
from pydantic import ValidationError

from schemas import (
    ManifestHeader,
    ManifestEvent,
    ManifestTrailer,
    ManifestValidationResult,
)

logger = logging.getLogger("cityai.manifest")

# ─── Approved Provenance Constants ────────────────────────────────────────────

FASTREID_MODEL_NAME = "FastReID-SBS-R50-IBN"
FASTREID_MODEL_VERSION = "veri-776-sbs-ibn-v2"
FASTREID_DIMENSION = 2048


# ─── Exceptions ───────────────────────────────────────────────────────────────

class ManifestError(Exception):
    """Base exception for manifest processing errors."""
    pass


class IncompleteManifestError(ManifestError):
    """Raised when a manifest is truncated, missing a trailer, or unsealed."""
    pass


class ManifestChecksumMismatchError(ManifestError):
    """Raised when rolling payload SHA-256 does not match trailer."""
    pass


class ManifestStructuralError(ManifestError, ValueError):
    """Raised when record syntax, sequence numbers, or trailer structure is invalid."""
    pass


class EventCountMismatchError(ManifestStructuralError):
    """Raised when actual parsed events do not match trailer event_count."""
    pass


class ManifestFilesystemError(ManifestError):
    """Raised when staging and sealed directories are on different filesystems or reparse points detected."""
    pass


class ManifestPublicationError(ManifestError):
    """Raised when atomic publication fails (e.g. hard links unsupported)."""
    pass


class ManifestDurabilityError(ManifestPublicationError):
    """Raised when publication succeeded (hard link created) but directory synchronization failed, leaving durability uncertain."""
    pass


class ManifestIntegrityConflictException(ManifestError):
    """Raised when final manifest already exists but fails validation, belongs to a different run, or has different payload."""
    pass


# Process-local registry of staging paths that experienced sealing failures.
# Rejects publication attempts within the current runtime before inspecting the filesystem.
# Note: Process-local disavowal does not survive process restart and does not eliminate
# the filesystem double-fault crash boundary.
_DISAVOWED_STAGING_PATHS: set[str] = set()


def _read_and_validate_marker_file(marker_path: Union[str, Path]) -> Dict[str, Any]:
    """
    Reads and validates a manifest seal marker file (.seal).
    Rejects non-strict JSON constants (NaN, Infinity, -Infinity).
    """
    with open(str(marker_path), "r", encoding="utf-8") as f:
        content = f.read()
    data = json.loads(content, parse_constant=_reject_json_constant)
    if not isinstance(data, dict):
        raise ValueError(f"Malformed seal marker: expected JSON object, got {type(data).__name__}")
    return data


# ─── UUID Canonicalization and Validation Helpers ─────────────────────────────

def _canonicalize_uuid(val: Any) -> str:
    """
    Validates and canonicalizes a UUID to lowercase standard 8-4-4-4-12 string representation.
    Accepts:
    - uuid.UUID instances
    - Standard UUID strings (lowercase, uppercase hex, or unhyphenated hex)
    - 16-byte raw binary representations via uuid.UUID(bytes=val)
    Raises ValueError if val is None, wrong type, empty, malformed, or has an invalid byte length.
    """
    if val is None:
        raise ValueError("UUID value cannot be None")
    if isinstance(val, uuid.UUID):
        return str(val).lower()
    if isinstance(val, (bytes, bytearray)):
        b = bytes(val)
        if len(b) != 16:
            raise ValueError(f"Invalid UUID bytes length: expected 16 raw bytes, got {len(b)}")
        try:
            return str(uuid.UUID(bytes=b)).lower()
        except Exception as err:
            raise ValueError(f"Malformed 16-byte raw UUID: {err}") from err
    if not isinstance(val, str):
        raise ValueError(f"Invalid UUID type: expected str, 16-byte bytes, or UUID, got {type(val).__name__}")
    if not val:
        raise ValueError("UUID string cannot be empty")
    if val != val.strip():
        raise ValueError(f"Malformed UUID '{val}': leading or trailing whitespace is not permitted")
    try:
        parsed = uuid.UUID(val)
    except (ValueError, AttributeError, TypeError) as err:
        raise ValueError(f"Malformed or invalid UUID '{val}': {err}") from err
    return str(parsed).lower()


def _is_canonical_uuid(val: Any) -> bool:
    """
    Checks if val is a strictly canonical lowercase standard 8-4-4-4-12 UUID string.
    Manually constructed manifests with uppercase, unhyphenated, or malformed UUIDs are rejected.
    """
    if not isinstance(val, str) or len(val) != 36:
        return False
    try:
        parsed = uuid.UUID(val)
        return str(parsed) == val
    except (ValueError, AttributeError, TypeError):
        return False


# ─── Windows Reparse Point and Path Safety Helpers ───────────────────────────

DEFAULT_MANIFEST_ROOT = (Path(__file__).resolve().parent.parent.parent / "data" / "manifests").resolve()


def _is_stat_reparse_or_link(st: os.stat_result) -> bool:
    """
    Evaluates an existing stat_result from os.lstat() for symbolic links, junctions,
    and NTFS reparse points without following them.
    """
    if stat.S_ISLNK(st.st_mode):
        return True
    if hasattr(st, "st_reparse_tag") and st.st_reparse_tag != 0:
        return True
    if hasattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT") and hasattr(st, "st_file_attributes"):
        if bool(st.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT):
            return True
    return False


def _lstat_entry(path_str: str) -> Optional[os.stat_result]:
    """
    Performs os.lstat() without following symlinks.
    Returns stat_result if entry exists.
    Returns None if entry does not exist (FileNotFoundError).
    Raises ManifestFilesystemError for any other OSError (PermissionError, broken reparse, etc.).
    """
    try:
        return os.lstat(path_str)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as err:
        raise ManifestFilesystemError(f"Cannot inspect path '{path_str}': {err}. Fail closed.")


def _verify_ancestors_safe(path: Path, stop_at: Optional[Path] = None, stop_at_volume: bool = False) -> None:
    """
    Inspects existing path components using os.lstat() without following symlinks.
    If stop_at is provided, inspects components between stop_at and path (inclusive).
    If stop_at_volume is True, inspects components from the volume root down to path.
    Fails closed if any component is a symlink, reparse point, or not a directory.
    """
    abs_path = Path(os.path.abspath(str(path)))
    if stop_at is not None:
        stop_abs = Path(os.path.abspath(str(stop_at)))
        try:
            if not abs_path.is_relative_to(stop_abs):
                raise ManifestFilesystemError(f"Path '{abs_path}' is not within trusted boundary '{stop_abs}'")
        except (ValueError, TypeError):
            raise ManifestFilesystemError(f"Path '{abs_path}' is not within trusted boundary '{stop_abs}'")

        chain = []
        cur = abs_path
        while True:
            chain.append(cur)
            if cur == stop_abs or cur == cur.parent:
                break
            cur = cur.parent
        components = list(reversed(chain))
    else:
        components = list(reversed(abs_path.parents)) + [abs_path]

    for comp in components:
        st = _lstat_entry(str(comp))
        if st is not None:
            if _is_stat_reparse_or_link(st):
                raise ManifestFilesystemError(f"Path component '{comp}' is a symbolic link or reparse point")
            if comp != abs_path and not stat.S_ISDIR(st.st_mode):
                raise ManifestFilesystemError(f"Path component '{comp}' exists but is not a directory")


def _reject_json_constant(c: str):
    """Rejects non-strict JSON constants (NaN, Infinity, -Infinity) during decoding."""
    raise ValueError(f"Malformed JSON: constant '{c}' not permitted in strict JSON")


def _sync_directory(dir_path: Union[str, Path]) -> None:
    """
    Synchronizes directory metadata to persistent storage on supported POSIX systems.

    POSIX vs Windows durability semantics:
    - On supported POSIX systems (Linux, macOS, BSD), opens the directory descriptor using
      O_RDONLY (and O_DIRECTORY when available) and invokes os.fsync(dir_fd) to ensure
      directory entry creation (hard-link) or removal (unlink) is written to durable media.
    - On Windows (os.name == 'nt'), directory file descriptor synchronization is unsupported
      by the Windows C runtime and filesystem driver (calling os.fsync on a directory handle
      raises Errno 13 Permission Denied or Errno 22 Invalid Argument). Therefore, directory fsync
      guarantees are strictly POSIX-only. On Windows, directory metadata durability relies
      exclusively on NTFS internal transaction logging ($LogFile).
    """
    if os.name == 'nt':
        return

    path_str = str(dir_path)
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY

    dir_fd = os.open(path_str, flags)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


# ─── Streaming Manifest Writer ────────────────────────────────────────────────

class StreamingManifestWriter:
    """
    Streams video detection events incrementally to disk in NDJSON format.
    Guarantees O(1) memory usage bounded to the proposals of a single frame.
    Maintains a rolling SHA-256 over HEADER + EVENT lines (including terminating LF).
    Enforces strict Re-ID model provenance and 7-element deterministic sorting.
    Seals the manifest with a TRAILER record upon completion.
    """

    def __init__(
        self,
        staging_path: Union[str, Path],
        video_upload_id: Union[str, bytes, uuid.UUID],
        processing_run_id: Union[str, bytes, uuid.UUID],
        camera_id: str,
        started_at: Optional[str] = None,
    ):
        # Validate all parameters before performing any filesystem mutations
        self.video_upload_id = _canonicalize_uuid(video_upload_id)
        self.processing_run_id = _canonicalize_uuid(processing_run_id)
        if not camera_id or not str(camera_id).strip():
            raise ValueError("camera_id cannot be empty")
        self.camera_id = str(camera_id)
        self.started_at = started_at or datetime.now(timezone.utc).isoformat()
        self.staging_path = Path(staging_path).resolve()

        # Filesystem mutations occur only after parameter validation succeeds
        self.staging_path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0)
        try:
            fd = os.open(str(self.staging_path), flags, 0o600)
            self.file = open(fd, "wb", closefd=True)
        except FileExistsError as err:
            raise ManifestFilesystemError(
                f"Staging path '{self.staging_path}' already exists; staging paths must be strictly unique "
                f"per processing attempt and cannot be overwritten, reused, or truncated."
            ) from err
        self.hasher = hashlib.sha256()
        self.seq = 0
        self.frames_sampled = 0
        self._is_sealed = False
        self._is_broken = False

        # Line 1: Header (validated against schema)
        header_model = ManifestHeader(
            type="HEADER",
            version="1.0",
            video_upload_id=self.video_upload_id,
            processing_run_id=self.processing_run_id,
            camera_id=self.camera_id,
            started_at=self.started_at,
        )
        header_bytes = (json.dumps(header_model.model_dump(), separators=(',', ':'), ensure_ascii=False) + "\n").encode("utf-8")
        self.file.write(header_bytes)
        self.hasher.update(header_bytes)

    def append_frame_events(
        self,
        frame_number: int,
        detections: Sequence[Any],
        timestamp_iso: Optional[str] = None
    ) -> int:
        """
        Sorts frame detections deterministically using the approved 7-element sort key:
        (round(Y1/10)*10, round(X1/10)*10, round(Y2,2), round(X2,2), -round(confidence,4), class_key, raw_proposal_index).

        Determinism and Indexing Guarantees:
        - Unique explicit proposal indices: When all proposals in a frame provide unique, non-negative integer
          raw_proposal_index values, permutation-independent deterministic ordering is guaranteed across any caller
          input sequence permutation.
        - All-omitted fallback: When all proposals in a frame omit raw_proposal_index (None), tie-breaking falls back
          to the caller's input sequence index (0..N-1), guaranteeing stable tie-breaking that depends on caller input order.
        - Duplicate explicit indices: Rejected with ManifestStructuralError within the same frame (indices may be reused
          across different frames).
        - Mixed explicit/omitted indices: Rejected with ManifestStructuralError to prevent silent seventh-element collisions.
        - Invalid indices: Non-integral values (float, string, NaN, Inf), booleans, and negative values are strictly
          rejected with ManifestStructuralError.
        - Transactional frame isolation: Validation and event preparation occur before any disk or hasher mutation.
          A rejected frame leaves 0 bytes written, preserves sequence and frame counters, and allows the writer
          to safely continue processing subsequent frames.
        """
        if self._is_sealed:
            raise ManifestStructuralError("Cannot append events to a sealed manifest writer")
        if self._is_broken:
            raise ManifestStructuralError("Cannot append events to a failed or unsealed writer")

        if not detections:
            self.frames_sampled += 1
            return 0

        # 1. Proposal index validation
        num_explicit = 0
        seen_raw_indices = set()
        for d in detections:
            raw_idx = getattr(d, 'raw_proposal_index', None) if not isinstance(d, dict) else d.get('raw_proposal_index')
            if raw_idx is not None:
                num_explicit += 1
                # Reject booleans (bool is a subclass of int in Python), non-integers, and negative values
                if isinstance(raw_idx, bool) or not isinstance(raw_idx, int) or raw_idx < 0:
                    raise ManifestStructuralError(
                        f"Invalid raw_proposal_index {raw_idx!r} in frame {frame_number}: "
                        f"must be a non-negative integer (got {type(raw_idx).__name__}={raw_idx!r})"
                    )
                if raw_idx in seen_raw_indices:
                    raise ManifestStructuralError(
                        f"Duplicate raw_proposal_index {raw_idx} detected in frame {frame_number}"
                    )
                seen_raw_indices.add(raw_idx)

        # Enforce all-explicit or all-omitted to prevent collisions and ensure determinism
        if 0 < num_explicit < len(detections):
            raise ManifestStructuralError(
                f"Mixed explicit and omitted raw_proposal_index in frame {frame_number}: "
                f"{num_explicit} of {len(detections)} proposals provided explicit indices. "
                f"All proposals in a frame must provide explicit indices, or all must omit them."
            )

        # Pair each detection with its input sequence index
        indexed_detections = list(enumerate(detections))

        def _sort_key(item: Tuple[int, Any]):
            input_idx, d = item
            b = getattr(d, 'bbox', None) if not isinstance(d, dict) else d.get('bbox')
            b = b or [0.0, 0.0, 0.0, 0.0]

            conf = getattr(d, 'detection_confidence', None) if not isinstance(d, dict) else d.get('detection_confidence')
            if conf is None:
                conf = getattr(d, 'confidence', 0.0) if not isinstance(d, dict) else d.get('confidence', 0.0)

            v_class = getattr(d, 'vehicle_class', '') if not isinstance(d, dict) else d.get('vehicle_class', '')
            c_id = getattr(d, 'class_id', None) if not isinstance(d, dict) else d.get('class_id')
            class_key = str(c_id if c_id is not None else v_class)

            raw_idx = getattr(d, 'raw_proposal_index', None) if not isinstance(d, dict) else d.get('raw_proposal_index')
            tie_breaker = int(raw_idx) if raw_idx is not None else int(input_idx)

            return (
                round(float(b[1]) / 10.0) * 10,
                round(float(b[0]) / 10.0) * 10,
                round(float(b[3]), 2),
                round(float(b[2]), 2),
                -round(float(conf or 0.0), 4),
                class_key,
                tie_breaker
            )

        sorted_items = sorted(indexed_detections, key=_sort_key)
        sorted_detections = [d for _, d in sorted_items]

        # Stage and validate all events in memory prior to mutating writer state or disk
        prepared_lines: List[bytes] = []
        next_seq = self.seq

        for d in sorted_detections:
            get_attr = lambda attr, default=None: (
                d.get(attr, default) if isinstance(d, dict) else getattr(d, attr, default)
            )

            bbox_raw = get_attr('bbox', [0.0, 0.0, 0.0, 0.0])
            bbox_val: List[Any] = list(bbox_raw) if isinstance(bbox_raw, (list, tuple)) else [0.0, 0.0, 0.0, 0.0]
            if len(bbox_val) != 4:
                raise ManifestStructuralError(f"Bounding box must have length 4, got {bbox_val}")

            det_conf_raw = get_attr('detection_confidence', get_attr('confidence', 0.0))
            det_conf: float = float(det_conf_raw) if det_conf_raw is not None else 0.0
            v_class = get_attr('vehicle_class', 'car')
            t_iso = get_attr('timestamp', timestamp_iso or self.started_at)

            # Reject any supplied detection camera ID that differs from writer's header camera ID
            supplied_cam = get_attr('camera_id')
            if supplied_cam is not None and str(supplied_cam) != self.camera_id:
                raise ManifestStructuralError(
                    f"Detection camera_id '{supplied_cam}' does not match writer camera_id '{self.camera_id}' at frame {frame_number}"
                )
            cam = self.camera_id
            p_raw = get_attr('plate_text_raw')
            p_norm = get_attr('plate_text_normalized')
            p_conf = get_attr('plate_confidence')
            track = get_attr('track_id')

            # Re-ID Embedding and Provenance Validation
            reid_emb = get_attr('reid_embedding')
            reid_name = get_attr('reid_model_name')
            reid_ver = get_attr('reid_model_version')
            reid_dim = get_attr('reid_dimension')

            if reid_emb is not None:
                # Reject incompatible provenance supplied by caller
                if reid_name is not None and reid_name not in (FASTREID_MODEL_NAME, "fastreid_veri_sbs_r50_ibn"):
                    raise ValueError(f"Incompatible reid_model_name: expected '{FASTREID_MODEL_NAME}', got '{reid_name}'")
                if reid_ver is not None and reid_ver != FASTREID_MODEL_VERSION:
                    raise ValueError(f"Incompatible reid_model_version: expected '{FASTREID_MODEL_VERSION}', got '{reid_ver}'")
                if reid_dim is not None and reid_dim != FASTREID_DIMENSION:
                    raise ValueError(f"Incompatible reid_dimension: expected {FASTREID_DIMENSION}, got {reid_dim}")

                if hasattr(reid_emb, 'tolist'):
                    reid_emb = reid_emb.tolist()
                elif not isinstance(reid_emb, list):
                    reid_emb = list(reid_emb)

                if len(reid_emb) != FASTREID_DIMENSION:
                    raise ValueError(f"FastReID embedding must have exactly {FASTREID_DIMENSION} dimensions, got {len(reid_emb)}")
                for idx, val in enumerate(reid_emb):
                    if not math.isfinite(val):
                        raise ValueError(f"FastReID embedding contains non-finite value at index {idx}: {val}")

                reid_name = FASTREID_MODEL_NAME
                reid_ver = FASTREID_MODEL_VERSION
                reid_dim = FASTREID_DIMENSION
            else:
                if any(x is not None for x in (reid_name, reid_ver, reid_dim)):
                    raise ValueError("Re-ID provenance fields supplied without an embedding vector")
                reid_name = None
                reid_ver = None
                reid_dim = None

            event_dict = {
                "type": "EVENT",
                "seq": next_seq,
                "idempotency_key": f"vid:{self.video_upload_id}:run:{self.processing_run_id}:seq:{next_seq}",
                "frame_number": int(frame_number),
                "timestamp": str(t_iso),
                "camera_id": str(cam),
                "vehicle_class": str(v_class),
                "detection_confidence": round(det_conf, 4),
                "plate_text_raw": str(p_raw) if p_raw is not None else None,
                "plate_text_normalized": str(p_norm) if p_norm is not None else None,
                "plate_confidence": round(float(p_conf), 4) if p_conf is not None else None,
                "track_id": int(track) if track is not None else None,
                "bbox": [round(float(c), 2) for c in bbox_val],
                "reid_embedding": reid_emb,
                "reid_model_name": reid_name,
                "reid_model_version": reid_ver,
                "reid_dimension": reid_dim,
            }

            # Enforce schema validity before writing
            ManifestEvent(**event_dict)

            line_bytes = (json.dumps(event_dict, separators=(',', ':'), ensure_ascii=False) + "\n").encode("utf-8")
            prepared_lines.append(line_bytes)
            next_seq += 1

        # All proposals in frame validated successfully; apply state mutations atomically
        self.frames_sampled += 1
        written_count = 0
        for line_bytes in prepared_lines:
            self.file.write(line_bytes)
            self.hasher.update(line_bytes)
            self.seq += 1
            written_count += 1

        return written_count

    def close_and_seal(self) -> Path:
        """
        Appends the final TRAILER record containing payload_sha256,
        flushes, fsyncs, and closes the staging file.

        Preserves strict durability sequence:
        trailer write -> flush -> file fsync -> close -> mark sealed.
        Guarantees the file descriptor is closed even if write, flush, or fsync fails.
        Preserves original failure without swallowing.
        Marks writer broken on failure to prevent subsequent appends or sealing attempts.
        """
        if self._is_sealed:
            return self.staging_path
        if self._is_broken:
            raise ManifestStructuralError("Cannot seal a manifest writer after a prior failure")

        payload_sha256 = self.hasher.hexdigest()
        trailer_dict = {
            "type": "TRAILER",
            "event_count": self.seq,
            "frames_sampled": self.frames_sampled,
            "payload_sha256": payload_sha256,
            "sealed_at": datetime.now(timezone.utc).isoformat(),
        }
        # Enforce trailer validity
        trailer_model = ManifestTrailer(**trailer_dict)

        trailer_bytes = (json.dumps(trailer_model.model_dump(), separators=(',', ':'), ensure_ascii=False) + "\n").encode("utf-8")
        pre_trailer_pos = self.file.tell()
        primary_exc: Optional[BaseException] = None

        # ── Phase 1: Write and sync trailer to manifest file ──
        try:
            self.file.write(trailer_bytes)
            self.file.flush()
            os.fsync(self.file.fileno())
        except Exception as exc:
            self._is_broken = True
            _DISAVOWED_STAGING_PATHS.add(str(self.staging_path.resolve()))
            primary_exc = exc
            try:
                self.file.seek(pre_trailer_pos)
                self.file.truncate()
                self.file.flush()
            except Exception:
                pass
        finally:
            try:
                self.file.close()
            except Exception as close_exc:
                self._is_broken = True
                _DISAVOWED_STAGING_PATHS.add(str(self.staging_path.resolve()))
                if primary_exc is None:
                    primary_exc = close_exc
                else:
                    primary_exc.__context__ = close_exc

        if primary_exc is not None:
            raise primary_exc

        # ── Phase 2: Create private temporary marker with exclusive creation ──
        official_marker = self.staging_path.with_name(f"{self.staging_path.name}.seal")
        attempt_id = uuid.uuid4().hex
        marker_tmp = self.staging_path.with_name(f".{self.staging_path.name}.seal_tmp_{attempt_id}")

        marker_payload = {
            "version": "1.0",
            "processing_run_id": self.processing_run_id,
            "payload_sha256": payload_sha256,
            "sealed_at": trailer_dict["sealed_at"],
        }
        marker_bytes = (json.dumps(marker_payload, separators=(',', ':'), ensure_ascii=False) + "\n").encode("utf-8")

        marker_created = False
        marker_linked_by_this_attempt = False
        try:
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0)
            tmp_fd = os.open(str(marker_tmp), flags, 0o600)
            marker_created = True
            with open(tmp_fd, "wb", closefd=True) as mf:
                mf.write(marker_bytes)
                mf.flush()
                os.fsync(mf.fileno())

            # ── Phase 3: Promote temporary marker to official marker via no-clobber link ──
            try:
                os.link(str(marker_tmp), str(official_marker))
                marker_linked_by_this_attempt = True
            except FileExistsError:
                # Official marker already exists: inspect it without clobbering
                existing = _read_and_validate_marker_file(official_marker)
                if (existing.get("processing_run_id") != self.processing_run_id or
                    existing.get("payload_sha256") != payload_sha256):
                    raise ManifestIntegrityConflictException(
                        f"Concurrent sealing conflict: A competing marker already exists for '{self.staging_path}' "
                        f"with conflicting run ID or payload SHA-256. Preserving existing marker intact."
                    )
            finally:
                # Remove ONLY this attempt's private temporary marker
                try:
                    os.unlink(marker_tmp)
                except OSError:
                    pass

            # ── Phase 4: Synchronize parent directory after official marker link and temporary marker unlink ──
            _sync_directory(self.staging_path.parent)

        except Exception as marker_err:
            self._is_broken = True
            _DISAVOWED_STAGING_PATHS.add(str(self.staging_path.resolve()))
            if marker_created:
                try:
                    if marker_tmp.exists():
                        os.unlink(marker_tmp)
                except OSError:
                    pass
            # De-authorize official marker ONLY if this attempt created it but directory sync failed
            if marker_linked_by_this_attempt:
                try:
                    if official_marker.exists():
                        chk = _read_and_validate_marker_file(official_marker)
                        if (chk.get("processing_run_id") == self.processing_run_id and
                            chk.get("payload_sha256") == payload_sha256):
                            os.unlink(official_marker)
                except OSError:
                    pass
            raise marker_err

        self._is_sealed = True
        return self.staging_path


# ─── Streaming Manifest Validator ─────────────────────────────────────────────

def validate_manifest(
    manifest_path: Union[str, Path],
    expected_run_id: Optional[str] = None
) -> ManifestValidationResult:
    """
    Streams an NDJSON manifest line by line from disk with full Pydantic validation:
    - Verifies line 1 is HEADER (and matches expected_run_id if provided).
    - Verifies lines 2..M+1 are continuous EVENT records with canonical idempotency keys.
    - Computes rolling SHA-256 over HEADER + EVENT lines.
    - Verifies the final line is TRAILER.
    - Compares computed digest against trailer payload_sha256.
    - Checks event_count matches parsed events.
    """
    path = Path(manifest_path)
    if not path.exists():
        return ManifestValidationResult(is_valid=False, error=f"Manifest file does not exist: {path}")

    canon_expected_run_id: Optional[str] = None
    if expected_run_id is not None:
        try:
            canon_expected_run_id = _canonicalize_uuid(expected_run_id)
        except ValueError as err:
            return ManifestValidationResult(
                is_valid=False,
                error=f"Invalid expected_run_id '{expected_run_id}': not a valid UUID ({err})"
            )

    hasher = hashlib.sha256()
    header_obj: Optional[ManifestHeader] = None
    trailer_obj: Optional[ManifestTrailer] = None
    current_seq = 0
    line_no = 0

    try:
        with open(path, "rb") as f:
            for raw_line in f:
                line_no += 1
                if not raw_line.endswith(b"\n"):
                    return ManifestValidationResult(
                        is_valid=False,
                        error=f"Line {line_no} is truncated or does not terminate with LF"
                    )

                try:
                    record = json.loads(
                        raw_line.decode("utf-8"),
                        parse_constant=_reject_json_constant
                    )
                except (json.JSONDecodeError, ValueError) as jde:
                    return ManifestValidationResult(
                        is_valid=False,
                        error=f"JSON decode error at line {line_no}: {jde}"
                    )

                if not isinstance(record, dict):
                    return ManifestValidationResult(
                        is_valid=False,
                        error=f"Line {line_no} is not a JSON object"
                    )

                rec_type = record.get("type")

                if line_no == 1:
                    if rec_type != "HEADER":
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Line 1 must be HEADER record, got '{rec_type}'"
                        )
                    try:
                        header_obj = ManifestHeader(**record)
                    except ValidationError as ve:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Invalid HEADER at line 1: {ve}"
                        )

                    # Ensure header UUIDs are strictly canonical lowercase 8-4-4-4-12 representations
                    if not _is_canonical_uuid(header_obj.video_upload_id):
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Invalid HEADER at line 1: video_upload_id '{header_obj.video_upload_id}' is not a canonical lowercase UUID"
                        )

                    if not _is_canonical_uuid(header_obj.processing_run_id):
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Invalid HEADER at line 1: processing_run_id '{header_obj.processing_run_id}' is not a canonical lowercase UUID"
                        )

                    if canon_expected_run_id and header_obj.processing_run_id != canon_expected_run_id:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Run ID mismatch: expected {canon_expected_run_id}, found {header_obj.processing_run_id}"
                        )
                    hasher.update(raw_line)
                elif rec_type == "EVENT":
                    if trailer_obj is not None:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Found EVENT record at line {line_no} after TRAILER record"
                        )

                    try:
                        event_obj = ManifestEvent(**record)
                    except ValidationError as ve:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Invalid EVENT at line {line_no}: {ve}"
                        )

                    assert header_obj is not None

                    # Reject any EVENT whose camera_id differs from HEADER's camera_id
                    if event_obj.camera_id != header_obj.camera_id:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Camera ID mismatch at line {line_no} (seq {event_obj.seq}): event camera_id '{event_obj.camera_id}' does not match header camera_id '{header_obj.camera_id}'"
                        )

                    if event_obj.seq != current_seq:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Event sequence mismatch at line {line_no}: expected {current_seq}, got {event_obj.seq}"
                        )

                    # Validate canonical idempotency key
                    assert header_obj is not None
                    expected_key = f"vid:{header_obj.video_upload_id}:run:{header_obj.processing_run_id}:seq:{current_seq}"
                    if event_obj.idempotency_key != expected_key:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Forged or mismatched idempotency_key at line {line_no}: expected '{expected_key}', got '{event_obj.idempotency_key}'"
                        )

                    hasher.update(raw_line)
                    current_seq += 1
                elif rec_type == "TRAILER":
                    if trailer_obj is not None:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Multiple TRAILER records found at line {line_no}"
                        )
                    try:
                        trailer_obj = ManifestTrailer(**record)
                    except ValidationError as ve:
                        return ManifestValidationResult(
                            is_valid=False,
                            error=f"Invalid TRAILER at line {line_no}: {ve}"
                        )
                else:
                    return ManifestValidationResult(
                        is_valid=False,
                        error=f"Unknown record type '{rec_type}' at line {line_no}"
                    )

        # End of file checks
        if header_obj is None:
            return ManifestValidationResult(is_valid=False, error="Manifest is empty")
        if trailer_obj is None:
            return ManifestValidationResult(
                is_valid=False,
                error="Incomplete manifest: missing TRAILER record"
            )

        # Check event count matches parsed events
        if trailer_obj.event_count != current_seq:
            return ManifestValidationResult(
                is_valid=False,
                error=f"Event count mismatch: trailer claims {trailer_obj.event_count}, but parsed {current_seq} events"
            )

        # Check checksum
        computed_digest = hasher.hexdigest()
        if trailer_obj.payload_sha256 != computed_digest:
            return ManifestValidationResult(
                is_valid=False,
                error=f"Checksum mismatch: computed {computed_digest}, trailer has {trailer_obj.payload_sha256}"
            )

        return ManifestValidationResult(
            is_valid=True,
            event_count=current_seq,
            frames_sampled=trailer_obj.frames_sampled,
            payload_sha256=trailer_obj.payload_sha256,
            header=header_obj,
            error=None
        )
    except Exception as e:
        return ManifestValidationResult(is_valid=False, error=f"Validation exception: {e}")


# ─── Atomic No-Clobber Publication ───────────────────────────────────────────

def publish_manifest_no_clobber(
    staging_path: Union[str, Path],
    final_path: Union[str, Path],
    expected_run_id: str,
    trusted_root: Optional[Union[str, Path]] = None,
) -> Path:
    """
    Atomically publishes staging_path to final_path via atomic hard-link (os.link).
    Enforces strict no-clobber semantics:
    - Verifies trusted_root exists and is free of reparse points / symlinks.
    - Validates lexical containment beneath trusted_root without premature symlink resolution.
    - Inspects all existing path ancestors via os.lstat() prior to directory creation.
    - Pre-validates sealed staging_path before performing publication.
    - Authoritatively checks destination existence via os.lstat(), handling regular files,
      directories, symlinks (active or dangling), and reparse points.
    - Inode and device stability: during existing destination deduplication, requires both parent
      and destination device/inode to remain unchanged across validation before unlinking staging.
    - Concurrency: on FileExistsError race, re-inspects parent and destination entries via os.lstat().
    - Post-publication verification: re-inspects parent, destination, and inode identity.
    - Never blindly unlinks final or staging on ambiguous verification failures.

    Security / TOCTOU Threat-Model Limitation:
    os.link() provides atomic mutual exclusion at the destination file level (kernel no-clobber).
    However, standard user-space filesystem operations cannot prevent a local privileged attacker
    with directory write permissions from executing a concurrent directory-swap race (e.g. replacing
    an ancestor directory with a junction between os.lstat and os.link). Absolute security against
    local insider threats requires OS-level Access Control Lists (ACLs) restricting write access
    to the trusted manifest root strictly to the service account.
    """
    # ── 1. Establish and verify trusted root ──
    root_raw = Path(trusted_root) if trusted_root is not None else DEFAULT_MANIFEST_ROOT
    root_abs = Path(os.path.abspath(str(root_raw)))

    st_root = _lstat_entry(str(root_abs))
    if st_root is None:
        raise ManifestFilesystemError(f"Trusted manifest root does not exist: {root_abs}")
    if not stat.S_ISDIR(st_root.st_mode) or _is_stat_reparse_or_link(st_root):
        raise ManifestFilesystemError(f"Trusted manifest root '{root_abs}' is a reparse point, symlink, or not a directory")

    _verify_ancestors_safe(root_abs, stop_at_volume=True)

    # ── 2. Lexical containment of raw unresolved paths ──
    raw_staging = Path(os.path.abspath(str(staging_path)))
    raw_final = Path(os.path.abspath(str(final_path)))
    final_parent = raw_final.parent

    try:
        if not raw_staging.is_relative_to(root_abs):
            raise ManifestFilesystemError(f"Path traversal detected: staging '{raw_staging}' outside root '{root_abs}'")
        if not raw_final.is_relative_to(root_abs):
            raise ManifestFilesystemError(f"Path traversal detected: final '{raw_final}' outside root '{root_abs}'")
    except (ValueError, TypeError):
        raise ManifestFilesystemError("Path containment check failed")

    # ── 3. Ancestor inspection before any directory creation ──
    _verify_ancestors_safe(raw_staging, stop_at=root_abs)
    _verify_ancestors_safe(final_parent, stop_at=root_abs)

    st_stage = _lstat_entry(str(raw_staging))
    if st_stage is None:
        raise FileNotFoundError(f"Staging manifest does not exist: {raw_staging}")
    if not stat.S_ISREG(st_stage.st_mode) or _is_stat_reparse_or_link(st_stage):
        raise ManifestFilesystemError(f"Staging path '{raw_staging}' is a symbolic link, reparse point, or not a regular file")

    # ── 4. Pre-publication staging validation & seal-marker authorization ──
    # Step 4.1: Reject disavowed staging paths (process-local sealing failure registry)
    resolved_staging_str = str(raw_staging.resolve())
    if resolved_staging_str in _DISAVOWED_STAGING_PATHS:
        raise ManifestIntegrityConflictException(
            f"Staging manifest '{raw_staging}' suffered a sealing failure in this process and cannot be published. "
            f"Process-local disavowal does not survive process restart and does not eliminate "
            f"the filesystem double-fault crash boundary."
        )

    # Step 4.2: Validate staging manifest content
    staging_val = validate_manifest(raw_staging, expected_run_id=expected_run_id)
    if not staging_val.is_valid:
        raise ManifestIntegrityConflictException(
            f"Staging manifest failed validation prior to publication: {staging_val.error}"
        )
    staging_sha256 = staging_val.payload_sha256
    assert staging_sha256 is not None

    # Step 4.3: Validate official seal marker
    official_marker = raw_staging.with_name(f"{raw_staging.name}.seal")
    marker_st = _lstat_entry(str(official_marker))
    if marker_st is None:
        raise ManifestIntegrityConflictException(
            f"Staging manifest '{raw_staging}' has no seal marker ('{official_marker}' does not exist). "
            f"Only sealed manifests with a valid .seal marker can be published."
        )
    if not stat.S_ISREG(marker_st.st_mode) or _is_stat_reparse_or_link(marker_st):
        raise ManifestIntegrityConflictException(
            f"Seal marker '{official_marker}' is not a regular file or is a reparse point/symlink. "
            f"Fail closed."
        )
    try:
        marker_data = _read_and_validate_marker_file(official_marker)
    except Exception as marker_read_err:
        raise ManifestIntegrityConflictException(
            f"Seal marker '{official_marker}' could not be read or parsed: {marker_read_err}. "
            f"Fail closed."
        ) from marker_read_err

    if marker_data.get("version") != "1.0":
        raise ManifestIntegrityConflictException(
            f"Seal marker '{official_marker}' has unsupported version '{marker_data.get('version')}'. "
            f"Expected '1.0'. Fail closed."
        )
    if marker_data.get("processing_run_id") != expected_run_id:
        raise ManifestIntegrityConflictException(
            f"Seal marker run ID mismatch: marker has '{marker_data.get('processing_run_id')}', "
            f"expected '{expected_run_id}'. Fail closed."
        )
    if marker_data.get("payload_sha256") != staging_sha256:
        raise ManifestIntegrityConflictException(
            f"Seal marker payload SHA-256 mismatch: marker has '{marker_data.get('payload_sha256')}', "
            f"staging has '{staging_sha256}'. The staging file may have been modified after sealing. "
            f"Fail closed."
        )

    # ── 5. Safe directory creation ──
    final_parent.mkdir(parents=True, exist_ok=True)
    st_parent = _lstat_entry(str(final_parent))
    if st_parent is None or not stat.S_ISDIR(st_parent.st_mode) or _is_stat_reparse_or_link(st_parent):
        raise ManifestFilesystemError(f"Parent directory '{final_parent}' is a reparse point, symlink, or not a directory")

    # ── 6. Filesystem device parity ──
    if st_stage.st_dev != st_parent.st_dev:
        raise ManifestFilesystemError(
            f"Staging device ({st_stage.st_dev}) and final directory device ({st_parent.st_dev}) do not match"
        )

    # ── 7. Authoritative destination inspection & stable deduplication ──
    st_dest = _lstat_entry(str(raw_final))
    if st_dest is not None:
        if _is_stat_reparse_or_link(st_dest):
            raise ManifestFilesystemError(
                f"Destination '{raw_final}' already exists as a symbolic link or reparse point. "
                f"Preserving staging at '{raw_staging}'."
            )
        if stat.S_ISDIR(st_dest.st_mode):
            raise ManifestFilesystemError(
                f"Destination '{raw_final}' already exists as a directory. "
                f"Preserving staging at '{raw_staging}'."
            )
        if not stat.S_ISREG(st_dest.st_mode):
            raise ManifestFilesystemError(
                f"Destination '{raw_final}' is not a regular file (mode: {oct(st_dest.st_mode)}). "
                f"Preserving staging at '{raw_staging}'."
            )

        # Capture initial identity of both parent directory and destination file
        initial_parent_dev = st_parent.st_dev
        initial_parent_ino = st_parent.st_ino
        initial_dest_dev = st_dest.st_dev
        initial_dest_ino = st_dest.st_ino

        # Validate existing regular file manifest
        final_val = validate_manifest(raw_final, expected_run_id=expected_run_id)
        if not final_val.is_valid:
            raise ManifestIntegrityConflictException(
                f"Destination '{raw_final}' already exists but failed validation ({final_val.error}). "
                f"Preserving staging at '{raw_staging}'."
            )
        if final_val.payload_sha256 != staging_sha256:
            raise ManifestIntegrityConflictException(
                f"Integrity conflict: Destination '{raw_final}' differs from staging "
                f"(SHA-256 {final_val.payload_sha256} != {staging_sha256}). "
                f"Preserving both staging and destination intact."
            )

        # Post-validation re-inspection of parent directory
        st_parent_recheck = _lstat_entry(str(final_parent))
        if st_parent_recheck is None or not stat.S_ISDIR(st_parent_recheck.st_mode) or _is_stat_reparse_or_link(st_parent_recheck):
            raise ManifestIntegrityConflictException(
                f"Integrity conflict: Parent directory '{final_parent}' was altered or became anomalous during deduplication validation. "
                f"Preserving both staging and destination intact."
            )
        if st_parent_recheck.st_dev != initial_parent_dev or st_parent_recheck.st_ino != initial_parent_ino:
            raise ManifestIntegrityConflictException(
                f"Integrity conflict: Parent directory '{final_parent}' identity changed during validation "
                f"(initial inode: {initial_parent_ino}, re-inspected: {st_parent_recheck.st_ino}). "
                f"Preserving both staging and destination intact."
            )

        # Post-validation re-inspection of destination file
        st_dest_recheck = _lstat_entry(str(raw_final))
        if st_dest_recheck is None or not stat.S_ISREG(st_dest_recheck.st_mode) or _is_stat_reparse_or_link(st_dest_recheck):
            raise ManifestIntegrityConflictException(
                f"Integrity conflict: Destination '{raw_final}' was altered or became anomalous during deduplication validation. "
                f"Preserving both staging and destination intact."
            )
        if st_dest_recheck.st_dev != initial_dest_dev or st_dest_recheck.st_ino != initial_dest_ino:
            raise ManifestIntegrityConflictException(
                f"Integrity conflict: Destination '{raw_final}' identity changed during validation "
                f"(initial inode: {initial_dest_ino}, re-inspected: {st_dest_recheck.st_ino}). "
                f"Preserving both staging and destination intact."
            )

        # Step 7.4: Both identities verified stable; de-authorize and clean up staging
        # Unlink official marker first to immediately de-authorize the staging manifest,
        # then unlink staging. Preserve raw_final on any failure.
        marker_actually_removed = False
        staging_actually_removed = False
        try:
            os.unlink(official_marker)
            marker_actually_removed = True
        except FileNotFoundError:
            pass  # Already absent; no filesystem modification made
        except OSError:
            pass  # Marker unlink failed; staging remains authorized but destination is valid

        try:
            os.unlink(raw_staging)
            staging_actually_removed = True
        except OSError:
            pass

        if marker_actually_removed or staging_actually_removed:
            try:
                _sync_directory(raw_staging.parent)
            except OSError as e:
                raise ManifestDurabilityError(
                    f"Staging parent directory synchronization failed for '{raw_staging.parent}': {e}. "
                    f"Destination manifest '{raw_final}' already exists and is valid, but staging cleanup durability "
                    f"cannot be guaranteed. Preserving destination intact without removal."
                ) from e
        return raw_final

    # ── 8. Atomic hard-link with concurrency race handling ──
    pre_link_parent_dev = st_parent.st_dev
    pre_link_parent_ino = st_parent.st_ino

    try:
        os.link(str(raw_staging), str(raw_final))
    except FileExistsError:
        # Step 8.1: Re-inspect parent directory and verify pre-link identity
        st_parent_race = _lstat_entry(str(final_parent))
        if st_parent_race is None or not stat.S_ISDIR(st_parent_race.st_mode) or _is_stat_reparse_or_link(st_parent_race):
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Parent directory '{final_parent}' is anomalous. "
                f"Preserving both staging and destination intact."
            )
        if st_parent_race.st_dev != pre_link_parent_dev or st_parent_race.st_ino != pre_link_parent_ino:
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Parent directory '{final_parent}' identity changed before race validation "
                f"(pre-link inode: {pre_link_parent_ino}, concurrent inode: {st_parent_race.st_ino}). "
                f"Preserving both staging and destination intact."
            )

        # Step 8.2: Inspect competing destination entry and capture initial identity
        st_dest_race = _lstat_entry(str(raw_final))
        if st_dest_race is None or not stat.S_ISREG(st_dest_race.st_mode) or _is_stat_reparse_or_link(st_dest_race):
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Destination '{raw_final}' is not a regular file or is a reparse point. "
                f"Preserving both staging and destination intact."
            )
        race_dest_dev = st_dest_race.st_dev
        race_dest_ino = st_dest_race.st_ino

        # Step 8.3: Validate competing manifest and require identical run ID and SHA-256
        final_val = validate_manifest(raw_final, expected_run_id=expected_run_id)
        if not final_val.is_valid:
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Destination '{raw_final}' failed validation ({final_val.error}). "
                f"Preserving both staging and destination intact."
            )
        if final_val.payload_sha256 != staging_sha256:
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Destination '{raw_final}' differs from staging "
                f"(SHA-256 {final_val.payload_sha256} != {staging_sha256}). "
                f"Preserving both staging and destination intact."
            )

        # Step 8.4: Post-validation re-inspection of parent directory identity
        st_parent_race_recheck = _lstat_entry(str(final_parent))
        if st_parent_race_recheck is None or not stat.S_ISDIR(st_parent_race_recheck.st_mode) or _is_stat_reparse_or_link(st_parent_race_recheck):
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Parent directory '{final_parent}' was altered or became anomalous during validation. "
                f"Preserving both staging and destination intact."
            )
        if st_parent_race_recheck.st_dev != pre_link_parent_dev or st_parent_race_recheck.st_ino != pre_link_parent_ino:
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Parent directory '{final_parent}' identity changed during validation "
                f"(pre-link inode: {pre_link_parent_ino}, re-inspected: {st_parent_race_recheck.st_ino}). "
                f"Preserving both staging and destination intact."
            )

        # Step 8.5: Post-validation re-inspection of destination file identity
        st_dest_race_recheck = _lstat_entry(str(raw_final))
        if st_dest_race_recheck is None or not stat.S_ISREG(st_dest_race_recheck.st_mode) or _is_stat_reparse_or_link(st_dest_race_recheck):
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Destination '{raw_final}' was altered or became anomalous during validation. "
                f"Preserving both staging and destination intact."
            )
        if st_dest_race_recheck.st_dev != race_dest_dev or st_dest_race_recheck.st_ino != race_dest_ino:
            raise ManifestIntegrityConflictException(
                f"Concurrent publication conflict: Destination '{raw_final}' identity changed during validation "
                f"(initial inode: {race_dest_ino}, re-inspected: {st_dest_race_recheck.st_ino}). "
                f"Preserving both staging and destination intact."
            )

        # Step 8.6: Both identities verified stable; de-authorize and clean up staging
        # Unlink official marker first to immediately de-authorize the staging manifest,
        # then unlink staging. Preserve raw_final on any failure.
        marker_actually_removed_race = False
        staging_actually_removed_race = False
        try:
            os.unlink(official_marker)
            marker_actually_removed_race = True
        except FileNotFoundError:
            pass  # Already absent; no filesystem modification made
        except OSError:
            pass

        try:
            os.unlink(raw_staging)
            staging_actually_removed_race = True
        except OSError:
            pass

        if marker_actually_removed_race or staging_actually_removed_race:
            try:
                _sync_directory(raw_staging.parent)
            except OSError as e:
                raise ManifestDurabilityError(
                    f"Staging parent directory synchronization failed for '{raw_staging.parent}': {e}. "
                    f"Destination manifest '{raw_final}' was published concurrently and is valid, but staging cleanup durability "
                    f"cannot be guaranteed. Preserving destination intact without removal."
                ) from e
        return raw_final
    except (OSError, NotImplementedError) as e:
        raise ManifestPublicationError(f"Atomic hard-link failed or unsupported: {e}. Fail closed.")

    # ── 9. Post-publication verification ──
    st_parent_post = _lstat_entry(str(final_parent))
    if st_parent_post is None or not stat.S_ISDIR(st_parent_post.st_mode) or _is_stat_reparse_or_link(st_parent_post):
        raise ManifestIntegrityConflictException(
            f"Post-publication verification failed: Parent directory '{final_parent}' is anomalous. "
            f"Preserving both staging and destination intact."
        )

    st_final_post = _lstat_entry(str(raw_final))
    if st_final_post is None or not stat.S_ISREG(st_final_post.st_mode) or _is_stat_reparse_or_link(st_final_post):
        raise ManifestIntegrityConflictException(
            f"Post-publication verification failed: Destination '{raw_final}' is anomalous or a reparse point. "
            f"Preserving both staging and destination intact."
        )

    if st_stage.st_dev != st_final_post.st_dev or st_stage.st_ino != st_final_post.st_ino:
        raise ManifestIntegrityConflictException(
            f"Post-publication verification failed: Inode/device mismatch ({st_stage.st_ino} != {st_final_post.st_ino}). "
            f"Preserving both staging and destination intact."
        )

    # ── 10. Publication confirmed safe: Directory durability & cleanup ──
    # Step 10.1: Sync final parent directory after successful hard-link publication
    try:
        _sync_directory(final_parent)
    except OSError as e:
        raise ManifestDurabilityError(
            f"Post-publication directory synchronization failed for '{final_parent}': {e}. "
            f"The final manifest '{raw_final}' already exists on disk but its directory entry durability "
            f"cannot be guaranteed. Preserving destination intact without removal."
        ) from e

    # Step 10.2: De-authorize and unlink staging — marker first, then staging file
    marker_actually_removed_pub = False
    staging_actually_removed_pub = False
    try:
        os.unlink(official_marker)
        marker_actually_removed_pub = True
    except FileNotFoundError:
        pass  # Already absent; no filesystem modification made
    except OSError:
        pass

    try:
        os.unlink(raw_staging)
        staging_actually_removed_pub = True
    except OSError:
        pass

    # Step 10.3: Sync staging parent directory only if any unlink actually removed a filesystem entry
    if marker_actually_removed_pub or staging_actually_removed_pub:
        try:
            _sync_directory(raw_staging.parent)
        except OSError as e:
            raise ManifestDurabilityError(
                f"Staging parent directory synchronization failed for '{raw_staging.parent}': {e}. "
                f"The final manifest '{raw_final}' already exists on disk but staging cleanup durability "
                f"cannot be guaranteed. Preserving destination intact without removal."
            ) from e

    try:
        os.chmod(str(raw_final), stat.S_IREAD)
    except OSError:
        pass

    return raw_final
