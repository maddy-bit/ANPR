"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
Phase B, Batch B3.2 — Shared External Dataset Loader Interface

Provides the foundational abstract classes, metadata dataclasses, coordinate primitives,
validation containers, and exception hierarchy for all benchmark dataset loaders.
"""

from __future__ import annotations

import hashlib
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union
from PIL import Image


class LoaderError(Exception):
    """Base exception for all dataset loader errors."""
    pass


class DatasetNotFoundError(LoaderError):
    """Raised when the expected dataset root or essential files cannot be found."""
    pass


class CorruptAnnotationError(LoaderError):
    """Raised when an annotation file is malformed, unparseable, or contains corrupt data."""
    pass


class IdentityLeakageError(LoaderError):
    """Raised when identity leakage is detected across supposedly disjoint evaluation splits."""
    pass


class InvalidCoordinateError(LoaderError):
    """Raised when bounding box or corner coordinates violate image boundary constraints."""
    pass


class MissingFileError(LoaderError):
    """Raised when an image or annotation referenced in indexes is missing from disk."""
    pass


def find_repo_root() -> Path:
    """
    Dynamically discover the repository root without hardcoded machine paths.
    Traverses upward from this module looking for markers (.git, data/benchmarks).
    Handles git worktrees where .git is a file.
    """
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        if (parent / "data" / "benchmarks").is_dir() or (parent / ".git").exists():
            if not (parent / "data" / "benchmarks").is_dir() and (parent / ".git").is_file():
                try:
                    content = (parent / ".git").read_text(encoding="utf-8").strip()
                    if content.startswith("gitdir:"):
                        gitdir = Path(content.split(":", 1)[1].strip())
                        main_repo = gitdir.parents[2]
                        if (main_repo / "data" / "benchmarks").is_dir():
                            return main_repo
                except Exception:
                    pass
            return parent
    # Fallback to two levels up from ai-service/loaders
    return current.parents[2]


def sha256_file(filepath: Union[str, Path]) -> str:
    """Compute SHA-256 cryptographic digest of a file in streaming chunks."""
    p = Path(filepath)
    if not p.is_file():
        raise FileNotFoundError(f"File not found for SHA-256: {p}")
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class Point2D:
    """2D pixel coordinate point."""
    x: float
    y: float

    def to_tuple(self) -> Tuple[float, float]:
        return (self.x, self.y)

    def is_within(self, width: float, height: float) -> bool:
        return 0.0 <= self.x <= width and 0.0 <= self.y <= height


@dataclass(frozen=True)
class BoundingBox:
    """
    2D bounding box in pixel coordinates (left, top, width, height).
    """
    x: float  # left
    y: float  # top
    width: float
    height: float
    class_name: Optional[str] = None
    confidence: float = 1.0

    @property
    def left(self) -> float:
        return self.x

    @property
    def top(self) -> float:
        return self.y

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def to_xywh(self) -> Tuple[float, float, float, float]:
        return (self.x, self.y, self.width, self.height)

    def to_xyxy(self) -> Tuple[float, float, float, float]:
        return (self.left, self.top, self.right, self.bottom)

    def to_normalized(self, img_width: float, img_height: float) -> Tuple[float, float, float, float]:
        """Convert pixel (x, y, w, h) to normalized [0, 1] coordinates."""
        if img_width <= 0 or img_height <= 0:
            raise ValueError(f"Invalid image dimensions: {img_width}x{img_height}")
        return (
            self.x / img_width,
            self.y / img_height,
            self.width / img_width,
            self.height / img_height,
        )

    def is_within_bounds(self, img_width: float, img_height: float, tolerance: float = 1.0) -> bool:
        """Verify whether bounding box fits strictly inside image dimensions."""
        if self.width <= 0 or self.height <= 0:
            return False
        if self.x < -tolerance or self.y < -tolerance:
            return False
        if (self.right > img_width + tolerance) or (self.bottom > img_height + tolerance):
            return False
        return True


@dataclass
class DatasetMetadata:
    """Metadata describing a benchmark dataset."""
    dataset_id: str
    dataset_name: str
    root_path: Path
    description: str
    supported_splits: List[str]
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SplitMetadata:
    """Metadata describing a specific split partition of a dataset."""
    split_name: str
    num_samples: int
    num_identities: Optional[int] = None
    num_cameras: Optional[int] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BaseRecord:
    """Standardized representation of a single benchmark observation."""
    sample_id: str
    split: str
    image_path: Path
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationResult:
    """Comprehensive validation result across a benchmark dataset or split."""
    dataset_id: str
    is_valid: bool
    total_samples: int
    matched_samples: int
    missing_samples: int = 0
    corrupted_samples: int = 0
    leakage_detected: bool = False
    issues: List[str] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)

    def add_issue(self, issue: str):
        self.issues.append(issue)
        self.is_valid = False


class BaseDatasetLoader(ABC):
    """
    Abstract Base Class for external dataset loaders.
    Enforces deterministic ordering, lazy record retrieval, dynamic path resolution,
    and rigorous integrity validation.
    """

    def __init__(self, root_path: Optional[Union[str, Path]] = None):
        self._repo_root = find_repo_root()
        if root_path is not None:
            self.root_path = Path(root_path).resolve()
        else:
            self.root_path = self.get_default_root()

        if not self.root_path.exists():
            raise DatasetNotFoundError(
                f"Dataset root does not exist: {self.root_path}. "
                "Ensure dataset is extracted or provide a valid root_path."
            )

    @abstractmethod
    def get_default_root(self) -> Path:
        """Return the default project-relative path to the dataset."""
        pass

    @property
    @abstractmethod
    def dataset_metadata(self) -> DatasetMetadata:
        """Return high-level metadata describing this dataset."""
        pass

    @abstractmethod
    def get_supported_splits(self) -> List[str]:
        """Return list of valid split partition names."""
        pass

    @abstractmethod
    def get_split_metadata(self, split: str) -> SplitMetadata:
        """Return metadata for a specific partition."""
        pass

    @abstractmethod
    def get_sample_ids(self, split: str) -> List[str]:
        """Return deterministically sorted list of sample IDs for the split."""
        pass

    @abstractmethod
    def get_record(self, sample_id: str) -> BaseRecord:
        """Retrieve a single record by sample ID (lazy, does not load image pixels)."""
        pass

    def iter_records(self, split: str) -> Iterator[BaseRecord]:
        """Lazily iterate over all records in a split without keeping them in memory."""
        for sample_id in self.get_sample_ids(split):
            yield self.get_record(sample_id)

    def open_image(self, record_or_id: Union[BaseRecord, str]) -> Image.Image:
        """
        Open the PIL image for a sample. The caller is responsible for lifecycle.
        Does not keep open handles cached.
        """
        if isinstance(record_or_id, BaseRecord):
            path = record_or_id.image_path
        else:
            rec = self.get_record(record_or_id)
            path = rec.image_path

        if not path.is_file():
            raise MissingFileError(f"Image file does not exist: {path}")
        return Image.open(path)

    @abstractmethod
    def validate(self) -> ValidationResult:
        """Perform full structural and cryptographic validation."""
        pass

