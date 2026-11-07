"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
External Benchmark Dataset Loaders Package (Batch B3.2)
"""

from .base import (
    BaseDatasetLoader,
    BaseRecord,
    BoundingBox,
    Point2D,
    DatasetMetadata,
    SplitMetadata,
    ValidationResult,
    LoaderError,
    DatasetNotFoundError,
    CorruptAnnotationError,
    IdentityLeakageError,
    InvalidCoordinateError,
    MissingFileError,
    find_repo_root,
    sha256_file,
)
from .veri776 import VeRi776Loader, VeRi776Record
from .ua_detrac import UaDetracLoader, UaDetracFrameRecord, UaDetracTarget
from .ufpr_alpr import UfprAlprLoader, UfprAlprRecord, EvaluationMode, CharAnnotation

__all__ = [
    "BaseDatasetLoader",
    "BaseRecord",
    "BoundingBox",
    "Point2D",
    "DatasetMetadata",
    "SplitMetadata",
    "ValidationResult",
    "LoaderError",
    "DatasetNotFoundError",
    "CorruptAnnotationError",
    "IdentityLeakageError",
    "InvalidCoordinateError",
    "MissingFileError",
    "find_repo_root",
    "sha256_file",
    "VeRi776Loader",
    "VeRi776Record",
    "UaDetracLoader",
    "UaDetracFrameRecord",
    "UaDetracTarget",
    "UfprAlprLoader",
    "UfprAlprRecord",
    "EvaluationMode",
    "CharAnnotation",
]

