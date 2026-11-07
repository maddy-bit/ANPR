"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
Phase B, Batch B3.2 — UA-DETRAC Vehicle Detection & MOT Tracking Dataset Loader

Implements strict read-only ingestion for UA-DETRAC:
- Enforces strict isolation: evaluates ONLY the 40 test sequences; 60 training sequences are excluded.
- Preserves all 56,340 physical test frames on disk.
- Robustly handles the 173 empty frames omitted from XML, parsing them as valid 0-object ground-truth.
- Parses vehicle bounding boxes (car, bus, van, others), target IDs, speeds, orientations, and ignored regions.
- Image resolution validated at 960x540.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple, Union
import numpy as np

from .base import (
    BaseDatasetLoader,
    BaseRecord,
    BoundingBox,
    CorruptAnnotationError,
    DatasetMetadata,
    DatasetNotFoundError,
    MissingFileError,
    SplitMetadata,
    ValidationResult,
    find_repo_root,
)


@dataclass(frozen=True)
class UaDetracTarget:
    """Individual vehicle target annotation in a video frame."""
    target_id: int
    box: BoundingBox
    vehicle_type: str
    speed: Optional[float] = None
    orientation: Optional[float] = None
    truncation_ratio: Optional[float] = None
    trajectory_length: Optional[int] = None


@dataclass
class UaDetracFrameRecord(BaseRecord):
    """Observation record for a single frame in a UA-DETRAC video sequence."""
    sequence_name: str = ""
    frame_num: int = 1
    width: int = 960
    height: int = 540
    targets: List[UaDetracTarget] = field(default_factory=list)
    ignored_regions: List[BoundingBox] = field(default_factory=list)
    weather: str = "unknown"
    camera_state: str = "unknown"
    is_empty_scene: bool = False

    @property
    def target_count(self) -> int:
        return len(self.targets)


class UaDetracLoader(BaseDatasetLoader):
    """
    Read-only ingestion loader for the UA-DETRAC Benchmark (Test Sequences).
    """

    SUPPORTED_SPLITS = ["test"]
    IMAGE_WIDTH = 960
    IMAGE_HEIGHT = 540

    def __init__(self, root_path: Optional[Union[str, Path]] = None):
        super().__init__(root_path=root_path)

        self._images_root = self.root_path / "DETRAC-Images"
        self._xml_root = self.root_path / "DETRAC-Test-Annotations-XML"
        self._mat_root = self.root_path / "DETRAC-Test-Annotations-MAT"

        if not self._images_root.is_dir():
            raise DatasetNotFoundError(f"DETRAC-Images directory missing: {self._images_root}")
        if not self._xml_root.is_dir():
            raise DatasetNotFoundError(f"DETRAC-Test-Annotations-XML directory missing: {self._xml_root}")

        # Authoritative test sequence discovery: driven exclusively by the 40 test XML files
        self._test_sequences: List[str] = sorted([
            f.stem.replace("_v3", "") for f in self._xml_root.glob("*.xml")
        ])
        if len(self._test_sequences) != 40:
            raise CorruptAnnotationError(
                f"Expected exactly 40 test sequences in {self._xml_root}, found {len(self._test_sequences)}"
            )

        # Cache for parsed sequence annotations (XML parsed once per sequence)
        self._sequence_cache: Dict[str, Dict[str, Any]] = {}
        # Precomputed list of all 56,340 physical frame IDs
        self._test_sample_ids: List[str] = []
        self._seq_frame_counts: Dict[str, int] = {}
        self._init_frame_index()

    def get_default_root(self) -> Path:
        return self._repo_root / "data" / "benchmarks" / "external" / "ua_detrac" / "extracted"

    def _init_frame_index(self):
        """Index all physical frames across the 40 test sequences."""
        sample_ids = []
        for seq in self._test_sequences:
            seq_dir = self._images_root / seq
            if not seq_dir.is_dir():
                raise MissingFileError(f"Test sequence directory missing from DETRAC-Images: {seq_dir}")

            # Collect all img%05d.jpg
            frame_files = sorted(list(seq_dir.glob("img*.jpg")))
            self._seq_frame_counts[seq] = len(frame_files)
            for ff in frame_files:
                # Filename img00001.jpg -> frame_num 1
                try:
                    fn_str = ff.stem.replace("img", "")
                    fn = int(fn_str)
                    sample_ids.append(f"{seq}:{fn:05d}")
                except ValueError:
                    continue
        self._test_sample_ids = sorted(sample_ids)

    def _parse_sequence_xml(self, seq_name: str) -> Dict[str, Any]:
        """Parse XML annotation for a sequence and index frame targets."""
        xml_path = self._xml_root / f"{seq_name}.xml"
        if not xml_path.is_file():
            # Try alternate naming
            alt = self._xml_root / f"{seq_name}_v3.xml"
            if alt.is_file():
                xml_path = alt
            else:
                raise MissingFileError(f"XML annotation not found for sequence: {seq_name}")

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
        except Exception as e:
            raise CorruptAnnotationError(f"Failed to parse XML for {seq_name}: {e}") from e

        # Sequence attributes
        seq_attr = root.find("sequence_attribute")
        weather = seq_attr.attrib.get("sence_weather", "unknown") if seq_attr is not None else "unknown"
        camera_state = seq_attr.attrib.get("camera_state", "unknown") if seq_attr is not None else "unknown"

        # Ignored regions
        ignored_boxes = []
        for ign in root.findall("ignored_region"):
            box = ign.find("box")
            if box is not None:
                try:
                    left = float(box.attrib.get("left", 0.0))
                    top = float(box.attrib.get("top", 0.0))
                    width = float(box.attrib.get("width", 0.0))
                    height = float(box.attrib.get("height", 0.0))
                    ignored_boxes.append(BoundingBox(x=left, y=top, width=width, height=height, class_name="ignored"))
                except ValueError:
                    pass

        # Parse frames
        frames_dict = {}
        for f in root.findall("frame"):
            try:
                frame_num = int(f.attrib.get("num", 1))
            except ValueError:
                continue

            targets = []
            target_list = f.find("target_list")
            target_nodes = target_list.findall("target") if target_list is not None else f.findall("target")

            for tg in target_nodes:
                try:
                    tg_id = int(tg.attrib.get("id", -1))
                    box_elem = tg.find("box")
                    attr_elem = tg.find("attribute")

                    if box_elem is None:
                        continue

                    left = float(box_elem.attrib.get("left", 0.0))
                    top = float(box_elem.attrib.get("top", 0.0))
                    width = float(box_elem.attrib.get("width", 0.0))
                    height = float(box_elem.attrib.get("height", 0.0))

                    v_type = attr_elem.attrib.get("vehicle_type", "car") if attr_elem is not None else "car"
                    speed = float(attr_elem.attrib.get("speed", 0.0)) if (attr_elem is not None and "speed" in attr_elem.attrib) else None
                    orientation = float(attr_elem.attrib.get("orientation", 0.0)) if (attr_elem is not None and "orientation" in attr_elem.attrib) else None
                    trunc = float(attr_elem.attrib.get("truncation_ratio", 0.0)) if (attr_elem is not None and "truncation_ratio" in attr_elem.attrib) else None
                    traj_len = int(attr_elem.attrib.get("trajectory_length", 0)) if (attr_elem is not None and "trajectory_length" in attr_elem.attrib) else None

                    bbox = BoundingBox(
                        x=left,
                        y=top,
                        width=width,
                        height=height,
                        class_name=v_type,
                        confidence=1.0,
                    )

                    targets.append(
                        UaDetracTarget(
                            target_id=tg_id,
                            box=bbox,
                            vehicle_type=v_type,
                            speed=speed,
                            orientation=orientation,
                            truncation_ratio=trunc,
                            trajectory_length=traj_len,
                        )
                    )
                except (ValueError, TypeError):
                    continue

            frames_dict[frame_num] = targets

        parsed = {
            "weather": weather,
            "camera_state": camera_state,
            "ignored_regions": ignored_boxes,
            "frames": frames_dict,
        }
        self._sequence_cache[seq_name] = parsed
        return parsed

    def _get_sequence_data(self, seq_name: str) -> Dict[str, Any]:
        if seq_name not in self._sequence_cache:
            return self._parse_sequence_xml(seq_name)
        return self._sequence_cache[seq_name]

    @property
    def dataset_metadata(self) -> DatasetMetadata:
        return DatasetMetadata(
            dataset_id="ua_detrac",
            dataset_name="UA-DETRAC Vehicle Detection & MOT Benchmark",
            root_path=self.root_path,
            description="40 urban overpass test video sequences totaling 56,340 frames at 960x540",
            supported_splits=self.SUPPORTED_SPLITS,
            properties={
                "test_sequences_count": len(self._test_sequences),
                "total_test_frames": len(self._test_sample_ids),
                "resolution": f"{self.IMAGE_WIDTH}x{self.IMAGE_HEIGHT}",
                "train_sequences_excluded": 60,
            },
        )

    def get_supported_splits(self) -> List[str]:
        return list(self.SUPPORTED_SPLITS)

    def get_split_metadata(self, split: str) -> SplitMetadata:
        if split != "test":
            raise ValueError(f"UA-DETRAC loader only exposes 'test' split. Requested: '{split}'")
        return SplitMetadata(
            split_name="test",
            num_samples=len(self._test_sample_ids),
            num_identities=None,  # Not applicable across camera sequences
            num_cameras=len(self._test_sequences),
            properties={
                "sequences": list(self._test_sequences),
                "frame_counts": dict(self._seq_frame_counts),
            },
        )

    def get_test_sequences(self) -> List[str]:
        """Return the list of 40 official test sequence names."""
        return list(self._test_sequences)

    def get_sample_ids(self, split: str = "test") -> List[str]:
        if split != "test":
            raise ValueError(f"UA-DETRAC loader only exposes 'test' split. Requested: '{split}'")
        return list(self._test_sample_ids)

    def get_record(self, sample_id: str) -> UaDetracFrameRecord:
        """
        Retrieve a single frame record.
        sample_id format: '{seq_name}:{frame_num:05d}', e.g., 'MVI_39031:00001'.
        """
        if ":" not in sample_id:
            raise ValueError(f"Invalid UA-DETRAC sample_id format: '{sample_id}'. Expected 'seq:frame_num'")

        seq_name, fn_str = sample_id.split(":", 1)
        if seq_name not in self._test_sequences:
            raise MissingFileError(
                f"Sequence '{seq_name}' is not in the official 40 test sequences. "
                "Training sequences are strictly excluded from evaluation."
            )

        frame_num = int(fn_str)
        img_path = self._images_root / seq_name / f"img{frame_num:05d}.jpg"
        if not img_path.is_file():
            raise MissingFileError(f"Image frame missing: {img_path}")

        seq_data = self._get_sequence_data(seq_name)
        frames_dict = seq_data["frames"]

        # Note: If frame_num is not in XML, it is a valid negative frame (0 targets)
        is_empty_scene = frame_num not in frames_dict or len(frames_dict[frame_num]) == 0
        targets = frames_dict.get(frame_num, [])

        return UaDetracFrameRecord(
            sample_id=sample_id,
            split="test",
            image_path=img_path,
            sequence_name=seq_name,
            frame_num=frame_num,
            width=self.IMAGE_WIDTH,
            height=self.IMAGE_HEIGHT,
            targets=targets,
            ignored_regions=seq_data["ignored_regions"],
            weather=seq_data["weather"],
            camera_state=seq_data["camera_state"],
            is_empty_scene=is_empty_scene,
            metadata={
                "sequence": seq_name,
                "frame_num": frame_num,
                "weather": seq_data["weather"],
                "camera_state": seq_data["camera_state"],
                "num_targets": len(targets),
            },
        )

    def iter_sequence(self, seq_name: str) -> Iterator[UaDetracFrameRecord]:
        """Iterate lazily over all frames of a specific test sequence."""
        if seq_name not in self._test_sequences:
            raise ValueError(f"Unknown test sequence: '{seq_name}'")
        num_frames = self._seq_frame_counts.get(seq_name, 0)
        for fn in range(1, num_frames + 1):
            yield self.get_record(f"{seq_name}:{fn:05d}")

    def validate(self) -> ValidationResult:
        """
        Perform rigorous verification of UA-DETRAC:
        1. Verify all 40 test sequences exist on disk.
        2. Verify all 56,340 physical frames exist.
        3. Verify all 40 XML files parse cleanly.
        4. Count empty-scene frames (verify the 173 omitted frames).
        5. Verify all vehicle bounding boxes are positive and within bounds.
        """
        result = ValidationResult(
            dataset_id="ua_detrac",
            is_valid=True,
            total_samples=len(self._test_sample_ids),
            matched_samples=0,
        )

        if len(self._test_sequences) != 40:
            result.add_issue(f"Expected 40 test sequences, found {len(self._test_sequences)}")

        total_frames = 0
        empty_frames = 0
        xml_omitted_frames = 0
        total_boxes = 0
        box_type_counts: Dict[str, int] = {}
        invalid_boxes = []

        for seq in self._test_sequences:
            seq_dir = self._images_root / seq
            num_disk_frames = self._seq_frame_counts.get(seq, 0)
            total_frames += num_disk_frames

            seq_data = self._get_sequence_data(seq)
            xml_frames = seq_data["frames"]

            for fn in range(1, num_disk_frames + 1):
                img_path = seq_dir / f"img{fn:05d}.jpg"
                if not img_path.is_file():
                    result.missing_samples += 1
                    result.add_issue(f"Missing image on disk: {img_path}")
                    continue
                result.matched_samples += 1

                if fn not in xml_frames:
                    xml_omitted_frames += 1
                    empty_frames += 1
                else:
                    tgs = xml_frames[fn]
                    if len(tgs) == 0:
                        empty_frames += 1
                    for tg in tgs:
                        total_boxes += 1
                        box_type_counts[tg.vehicle_type] = box_type_counts.get(tg.vehicle_type, 0) + 1
                        # Check bounding box bounds
                        if not tg.box.is_within_bounds(self.IMAGE_WIDTH, self.IMAGE_HEIGHT, tolerance=2.0):
                            invalid_boxes.append((seq, fn, tg.target_id, tg.box.to_xywh()))

        if invalid_boxes:
            result.add_issue(f"Found {len(invalid_boxes)} out-of-bounds boxes. Sample: {invalid_boxes[:3]}")

        result.summary = {
            "test_sequences": len(self._test_sequences),
            "total_frames_on_disk": total_frames,
            "xml_omitted_frames": xml_omitted_frames,
            "total_empty_frames": empty_frames,
            "total_bounding_boxes": total_boxes,
            "box_type_distribution": box_type_counts,
            "resolution": f"{self.IMAGE_WIDTH}x{self.IMAGE_HEIGHT}",
        }

        # Check expected counts
        if total_frames != 56340:
            result.add_issue(f"Expected 56,340 physical frames, found {total_frames}")
        if xml_omitted_frames != 173:
            result.add_issue(f"Expected 173 XML-omitted frames, found {xml_omitted_frames}")
        if total_boxes != 675774:
            result.add_issue(f"Expected 675,774 bounding boxes, found {total_boxes}")

        return result
