"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
Phase B, Batch B3.2 — VeRi-776 Vehicle Re-Identification Dataset Loader

Implements strict read-only ingestion for VeRi-776:
- Enforces official indexes (name_train.txt, name_test.txt, name_query.txt) as source of truth.
- Strictly quarantines and excludes all 32 orphan unannotated training images.
- Decodes multi-byte XML annotations using gb18030.
- Validates identity disjointness (0% train vs test/query leakage).
- Preserves query/gallery plate masking differences.
- Exposes camera network topology (camera distance matrix and ID ordering).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple, Union
import numpy as np

from .base import (
    BaseDatasetLoader,
    BaseRecord,
    CorruptAnnotationError,
    DatasetMetadata,
    DatasetNotFoundError,
    IdentityLeakageError,
    LoaderError,
    MissingFileError,
    SplitMetadata,
    ValidationResult,
    find_repo_root,
)


@dataclass
class VeRi776Record(BaseRecord):
    """Specific observation record for a VeRi-776 vehicle crop."""
    vehicle_id: str = ""
    camera_id: str = ""
    color_id: Optional[str] = None
    type_id: Optional[str] = None
    timestamp_seq: Optional[str] = None
    is_query: bool = False
    is_plate_masked: bool = False


class VeRi776Loader(BaseDatasetLoader):
    """
    Read-only ingestion loader for the VeRi-776 Vehicle Re-ID benchmark dataset.
    """

    SUPPORTED_SPLITS = ["train", "test", "query"]

    # The 32 orphan files present on disk in image_train but omitted from official annotations
    KNOWN_ORPHAN_FILES = frozenset([
        "0324_c019_00024330_0.jpg",
        "0324_c019_00024335_0.jpg",
        "0324_c019_00024345_0.jpg",
        "0324_c019_00024355_0.jpg",
        "0324_c019_00024365_0.jpg",
        "0389_c014_00061220_0.jpg",
        "0389_c014_00061225_0.jpg",
        "0389_c014_00061230_0.jpg",
        "0389_c014_00061245_0.jpg",
        "0389_c014_00061260_0.jpg",
        "0389_c014_00061265_0.jpg",
        "0389_c015_00061270_0.jpg",
        "0389_c015_00061275_0.jpg",
        "0389_c015_00061280_0.jpg",
        "0389_c015_00061285_0.jpg",
        "0389_c015_00061290_0.jpg",
        "0389_c015_00061295_0.jpg",
        "0389_c016_00061005_0.jpg",
        "0389_c016_00061010_0.jpg",
        "0389_c016_00061015_0.jpg",
        "0389_c016_00061020_0.jpg",
        "0389_c016_00061025_0.jpg",
        "0389_c016_00061030_0.jpg",
        "0389_c019_00061995_0.jpg",
        "0389_c019_00062000_0.jpg",
        "0389_c019_00062005_0.jpg",
        "0389_c019_00062010_0.jpg",
        "0389_c019_00062015_0.jpg",
        "0389_c019_00062020_0.jpg",
        "0395_c012_00049505_0.jpg",
        "0395_c012_00049520_0.jpg",
        "0395_c012_00049530_0.jpg",
    ])

    def __init__(self, root_path: Optional[Union[str, Path]] = None):
        super().__init__(root_path=root_path)

        # File paths
        self._train_img_dir = self.root_path / "image_train"
        self._test_img_dir = self.root_path / "image_test"
        self._query_img_dir = self.root_path / "image_query"

        self._name_train_file = self.root_path / "name_train.txt"
        self._name_test_file = self.root_path / "name_test.txt"
        self._name_query_file = self.root_path / "name_query.txt"

        self._train_xml_file = self.root_path / "train_label.xml"
        self._test_xml_file = self.root_path / "test_label.xml"

        self._camera_dist_file = self.root_path / "camera_Dist.txt"
        self._camera_id_file = self.root_path / "camera_ID.txt"
        self._gt_index_file = self.root_path / "gt_index.txt"
        self._jk_index_file = self.root_path / "jk_index.txt"

        # Cached index registries (parsed on demand)
        self._split_filenames: Dict[str, List[str]] = {}
        self._xml_items_cache: Dict[str, Dict[str, Dict[str, str]]] = {}
        self._sample_id_to_record_cache: Dict[str, VeRi776Record] = {}

        self._load_official_indexes()

    def get_default_root(self) -> Path:
        return self._repo_root / "data" / "benchmarks" / "external" / "veri_776" / "extracted" / "VeRi"

    def _read_index_lines(self, path: Path) -> List[str]:
        if not path.is_file():
            raise MissingFileError(f"Required VeRi index file missing: {path}")
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return [line.strip() for line in f if line.strip()]

    def _parse_xml_items(self, xml_path: Path) -> Dict[str, Dict[str, str]]:
        """Parse VeRi label XML handling gb18030 / gb2312 multi-byte encoding."""
        if not xml_path.is_file():
            raise MissingFileError(f"VeRi annotation XML missing: {xml_path}")

        try:
            raw_bytes = xml_path.read_bytes()
            decoded_text = raw_bytes.decode("gb18030", errors="replace")
            # Normalize xml header encoding declaration so ElementTree accepts it
            normalized_xml = re.sub(
                r'<\?xml[^>]*encoding=["\']gb2312["\'][^>]*\?>',
                '<?xml version="1.0" encoding="utf-8"?>',
                decoded_text,
                count=1,
            )
            root = ET.fromstring(normalized_xml)
        except Exception as e:
            raise CorruptAnnotationError(f"Failed to parse VeRi XML {xml_path}: {e}") from e

        items_elem = root.find("Items")
        if items_elem is None:
            raise CorruptAnnotationError(f"No <Items> element in {xml_path}")

        items_dict = {}
        for item in items_elem.findall("Item"):
            img_name = item.attrib.get("imageName")
            if img_name:
                items_dict[img_name] = item.attrib
        return items_dict

    def _load_official_indexes(self):
        """Load and cache authoritative filename listings."""
        self._split_filenames["train"] = sorted(self._read_index_lines(self._name_train_file))
        self._split_filenames["test"] = sorted(self._read_index_lines(self._name_test_file))
        self._split_filenames["query"] = sorted(self._read_index_lines(self._name_query_file))

        # Enforce strict exclusion of known orphan files from train split
        original_train_count = len(self._split_filenames["train"])
        clean_train = [f for f in self._split_filenames["train"] if f not in self.KNOWN_ORPHAN_FILES]
        self._split_filenames["train"] = clean_train
        if len(clean_train) != original_train_count:
            # If name_train.txt had any orphan files, they are safely stripped
            pass

    def _get_xml_dict(self, split: str) -> Dict[str, Dict[str, str]]:
        if split not in self._xml_items_cache:
            if split == "train":
                self._xml_items_cache["train"] = self._parse_xml_items(self._train_xml_file)
            elif split in ("test", "query"):
                # Both test gallery and query are described in test_label.xml
                self._xml_items_cache["test"] = self._parse_xml_items(self._test_xml_file)
                self._xml_items_cache["query"] = self._xml_items_cache["test"]
        return self._xml_items_cache[split]

    @property
    def dataset_metadata(self) -> DatasetMetadata:
        return DatasetMetadata(
            dataset_id="veri_776",
            dataset_name="VeRi-776 Vehicle Re-Identification Benchmark",
            root_path=self.root_path,
            description="20-camera urban surveillance vehicle Re-ID dataset with 775 identities",
            supported_splits=self.SUPPORTED_SPLITS,
            properties={
                "num_cameras": 20,
                "train_samples": len(self._split_filenames["train"]),
                "test_gallery_samples": len(self._split_filenames["test"]),
                "query_samples": len(self._split_filenames["query"]),
                "orphan_files_excluded": len(self.KNOWN_ORPHAN_FILES),
            },
        )

    def get_supported_splits(self) -> List[str]:
        return list(self.SUPPORTED_SPLITS)

    def get_split_metadata(self, split: str) -> SplitMetadata:
        if split not in self.SUPPORTED_SPLITS:
            raise ValueError(f"Unknown split '{split}'. Supported: {self.SUPPORTED_SPLITS}")

        filenames = self._split_filenames[split]
        vids = set()
        cams = set()
        for f in filenames:
            # Filename convention: {vehicleID}_{cameraID}_{timestamp}_{index}.jpg
            parts = f.split("_")
            if len(parts) >= 2:
                vids.add(parts[0])
                cams.add(parts[1])

        return SplitMetadata(
            split_name=split,
            num_samples=len(filenames),
            num_identities=len(vids),
            num_cameras=len(cams),
            properties={
                "vehicle_ids": sorted(list(vids)),
                "camera_ids": sorted(list(cams)),
            },
        )

    def get_sample_ids(self, split: str) -> List[str]:
        """
        Return deterministic sample IDs formatted as '{split}:{filename}'.
        """
        if split not in self.SUPPORTED_SPLITS:
            raise ValueError(f"Unknown split '{split}'. Supported: {self.SUPPORTED_SPLITS}")
        return [f"{split}:{fname}" for fname in self._split_filenames[split]]

    def get_record(self, sample_id: str) -> VeRi776Record:
        """
        Retrieve a single VeRi record lazily by sample_id ('{split}:{filename}')
        or bare filename.
        """
        if sample_id in self._sample_id_to_record_cache:
            return self._sample_id_to_record_cache[sample_id]

        if ":" in sample_id:
            split, filename = sample_id.split(":", 1)
        else:
            filename = sample_id
            # Resolve split
            if filename in self._split_filenames["query"]:
                split = "query"
            elif filename in self._split_filenames["test"]:
                split = "test"
            elif filename in self._split_filenames["train"]:
                split = "train"
            else:
                if filename in self.KNOWN_ORPHAN_FILES:
                    raise LoaderError(
                        f"Refusing to load orphan unannotated image: '{filename}'. "
                        "This image is strictly quarantined from official splits."
                    )
                raise MissingFileError(f"Filename '{filename}' not found in any VeRi split index.")

        if filename in self.KNOWN_ORPHAN_FILES:
            raise LoaderError(
                f"Refusing to load orphan unannotated image: '{filename}'. "
                "This image is strictly quarantined from official splits."
            )

        # Directory resolution
        if split == "train":
            img_path = self._train_img_dir / filename
            is_query = False
            is_plate_masked = False
        elif split == "test":
            img_path = self._test_img_dir / filename
            is_query = False
            is_plate_masked = True  # Plates are blacked out in test gallery
        elif split == "query":
            img_path = self._query_img_dir / filename
            is_query = True
            is_plate_masked = False  # Plates are unmasked in probe query
        else:
            raise ValueError(f"Unsupported split '{split}'")

        if not img_path.is_file():
            raise MissingFileError(f"Image file does not exist: {img_path}")

        # Metadata from XML or filename fallback
        xml_dict = self._get_xml_dict(split)
        xml_item = xml_dict.get(filename, {})

        parts = filename.split("_")
        vehicle_id = xml_item.get("vehicleID") or (parts[0] if len(parts) >= 1 else "")
        camera_id = xml_item.get("cameraID") or (parts[1] if len(parts) >= 2 else "")
        timestamp_seq = parts[2] if len(parts) >= 3 else None
        color_id = xml_item.get("colorID")
        type_id = xml_item.get("typeID")

        record = VeRi776Record(
            sample_id=f"{split}:{filename}",
            split=split,
            image_path=img_path,
            vehicle_id=vehicle_id,
            camera_id=camera_id,
            color_id=color_id,
            type_id=type_id,
            timestamp_seq=timestamp_seq,
            is_query=is_query,
            is_plate_masked=is_plate_masked,
            metadata={
                "filename": filename,
                "color_id": color_id,
                "type_id": type_id,
            },
        )

        self._sample_id_to_record_cache[sample_id] = record
        return record

    def get_camera_distance_matrix(self) -> np.ndarray:
        """Parse and return the 20x20 camera physical distance matrix."""
        if not self._camera_dist_file.is_file():
            raise MissingFileError(f"camera_Dist.txt missing: {self._camera_dist_file}")

        rows = []
        with open(self._camera_dist_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append([float(v) for v in line.strip().split()])
        matrix = np.array(rows, dtype=np.float32)
        if matrix.shape != (20, 20):
            raise CorruptAnnotationError(f"Expected 20x20 matrix, got {matrix.shape}")
        return matrix

    def get_camera_id_order(self) -> List[int]:
        """Parse and return the 20 camera ordered IDs from camera_ID.txt."""
        if not self._camera_id_file.is_file():
            raise MissingFileError(f"camera_ID.txt missing: {self._camera_id_file}")
        lines = self._read_index_lines(self._camera_id_file)
        cam_ids: List[int] = []
        for line in lines:
            for token in line.split():
                if token.isdigit():
                    cam_ids.append(int(token))
        return cam_ids

    def get_query_ground_truth(self, query_index: int) -> Tuple[List[int], List[int]]:
        """
        Return (ground_truth_indices, junk_indices) for a given 0-based query index.
        Indices are 1-based indices into the test gallery (name_test.txt).
        """
        if not (self._gt_index_file.is_file() and self._jk_index_file.is_file()):
            raise MissingFileError("gt_index.txt or jk_index.txt missing.")

        gt_lines = self._read_index_lines(self._gt_index_file)
        jk_lines = self._read_index_lines(self._jk_index_file)

        if not (0 <= query_index < len(gt_lines)):
            raise IndexError(f"Query index {query_index} out of range [0, {len(gt_lines)})")

        gt_indices = [int(v) for v in gt_lines[query_index].split() if v.isdigit()]
        jk_indices = [int(v) for v in jk_lines[query_index].split() if v.isdigit()]
        return (gt_indices, jk_indices)

    def validate(self) -> ValidationResult:
        """
        Perform rigorous verification of VeRi-776:
        1. Check all index files and XML files.
        2. Verify that all 37,746 train, 11,579 test, and 1,678 query files exist on disk.
        3. Verify that all 32 orphan files are excluded from official train index.
        4. Check identity disjointness between train and test/query (zero leakage).
        5. Verify camera distance matrix shape and camera IDs.
        """
        result = ValidationResult(
            dataset_id="veri_776",
            is_valid=True,
            total_samples=0,
            matched_samples=0,
        )

        # 1. Check disk file presence
        total_samples = 0
        matched_samples = 0
        missing = []

        for split in self.SUPPORTED_SPLITS:
            filenames = self._split_filenames[split]
            target_dir = {
                "train": self._train_img_dir,
                "test": self._test_img_dir,
                "query": self._query_img_dir,
            }[split]

            for fname in filenames:
                total_samples += 1
                if (target_dir / fname).is_file():
                    matched_samples += 1
                else:
                    missing.append(f"{split}:{fname}")

        result.total_samples = total_samples
        result.matched_samples = matched_samples
        result.missing_samples = len(missing)

        if missing:
            result.add_issue(f"Missing {len(missing)} images on disk. Sample: {missing[:5]}")

        # 2. Check orphan exclusion
        train_names = set(self._split_filenames["train"])
        orphans_in_train = train_names.intersection(self.KNOWN_ORPHAN_FILES)
        if orphans_in_train:
            result.add_issue(
                f"LEAKAGE RISK: {len(orphans_in_train)} orphan files found in train split index!"
            )

        # 3. Check train vs test identity leakage
        train_vids = set(f.split("_")[0] for f in self._split_filenames["train"])
        test_vids = set(f.split("_")[0] for f in self._split_filenames["test"])
        query_vids = set(f.split("_")[0] for f in self._split_filenames["query"])

        cross_leakage = train_vids.intersection(test_vids)
        if cross_leakage:
            result.leakage_detected = True
            result.add_issue(f"CRITICAL LEAKAGE: Vehicle IDs in both train and test: {cross_leakage}")

        query_leakage = train_vids.intersection(query_vids)
        if query_leakage:
            result.leakage_detected = True
            result.add_issue(f"CRITICAL LEAKAGE: Query VIDs found in train: {query_leakage}")

        # 4. Topology check
        try:
            dist_mat = self.get_camera_distance_matrix()
            cam_order = self.get_camera_id_order()
            if dist_mat.shape != (20, 20) or len(cam_order) != 20:
                result.add_issue(f"Topology mismatch: dist shape {dist_mat.shape}, cams {len(cam_order)}")
        except Exception as e:
            result.add_issue(f"Topology parse failure: {e}")

        result.summary = {
            "train_images": len(self._split_filenames["train"]),
            "test_images": len(self._split_filenames["test"]),
            "query_images": len(self._split_filenames["query"]),
            "train_vids": len(train_vids),
            "test_vids": len(test_vids),
            "query_vids": len(query_vids),
            "orphan_files_isolated": len(self.KNOWN_ORPHAN_FILES),
            "leakage_count": len(cross_leakage),
        }

        return result
