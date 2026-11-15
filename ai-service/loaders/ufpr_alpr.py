"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
Phase B, Batch B3.2 â€” UFPR-ALPR License Plate Detection & OCR Dataset Loader

Implements strict read-only ingestion for UFPR-ALPR:
- Parses camera, vehicle bounding box, make/model/year/type, plate string, 4 corners, and 7 character boxes.
- Dynamically queries image dimensions to seamlessly support both 1920x1080 and 1920x1088 (macroblock padded) images.
- Implements dual evaluation modes:
    1. OFFICIAL: All 60 test tracks (1,800 images) for academic literature reproducibility.
    2. DECONTAMINATED: 58 strictly disjoint test tracks (1,740 images), quarantining track0110 and track0140.
- Keeps training (60 tracks, 1,800 images) and validation (30 tracks, 900 images) splits intact.
- Never mutates or alters source annotation files.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple, Union
from PIL import Image

from .base import (
    BaseDatasetLoader,
    BaseRecord,
    BoundingBox,
    CorruptAnnotationError,
    DatasetMetadata,
    DatasetNotFoundError,
    IdentityLeakageError,
    InvalidCoordinateError,
    LoaderError,
    MissingFileError,
    Point2D,
    SplitMetadata,
    ValidationResult,
    find_repo_root,
)


class EvaluationMode(str, Enum):
    """Evaluation split filtering mode for UFPR-ALPR."""
    OFFICIAL = "official"
    DECONTAMINATED = "decontaminated"


@dataclass(frozen=True)
class CharAnnotation:
    """Bounding box and index for an individual license plate character."""
    index: int  # 1 to 7
    box: BoundingBox
    character: str = ""  # Derived from plate string


@dataclass
class UfprAlprRecord(BaseRecord):
    """Full observation record for a UFPR-ALPR image and plate annotation."""
    track_id: str = ""
    frame_index: int = 1
    camera: str = ""
    vehicle_box: Optional[BoundingBox] = None
    vehicle_type: str = ""
    make: str = ""
    model: str = ""
    year: str = ""
    plate_text: str = ""
    corners: List[Point2D] = field(default_factory=list)
    characters: List[CharAnnotation] = field(default_factory=list)
    image_width: int = 1920
    image_height: int = 1080
    is_leaked_track: bool = False

    @property
    def is_padded_1088p(self) -> bool:
        return self.image_height == 1088

    def get_plate_box_from_corners(self) -> BoundingBox:
        """Derive tight enclosing rectangular bounding box from 4 polygon corners."""
        if not self.corners:
            raise ValueError(f"No corners available for record {self.sample_id}")
        xs = [pt.x for pt in self.corners]
        ys = [pt.y for pt in self.corners]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        return BoundingBox(
            x=min_x,
            y=min_y,
            width=max_x - min_x,
            height=max_y - min_y,
            class_name="license_plate",
            confidence=1.0,
        )


class UfprAlprLoader(BaseDatasetLoader):
    """
    Read-only ingestion loader for the UFPR-ALPR Benchmark Dataset.
    Supports official and decontaminated test splits with dynamic dimension handling.
    """

    SUPPORTED_SPLITS = ["training", "validation", "testing"]

    # Track identifiers are evaluation metadata; no plate values are embedded.
    LEAKED_TEST_TRACKS = frozenset(["track0110", "track0140"])

    def __init__(
        self,
        root_path: Optional[Union[str, Path]] = None,
        mode: EvaluationMode = EvaluationMode.OFFICIAL,
    ):
        super().__init__(root_path=root_path)
        self.mode = mode

        self._training_dir = self.root_path / "training"
        self._validation_dir = self.root_path / "validation"
        self._testing_dir = self.root_path / "testing"

        # Check directory structure
        for d in (self._training_dir, self._validation_dir, self._testing_dir):
            if not d.is_dir():
                raise DatasetNotFoundError(f"UFPR split directory missing: {d}")

        # Index tracks and samples
        self._tracks_by_split: Dict[str, List[str]] = {}
        self._samples_by_split: Dict[str, List[str]] = {}
        self._record_cache: Dict[str, UfprAlprRecord] = {}
        self._image_dims_cache: Dict[str, Tuple[int, int]] = {}

        self._index_dataset()

    def get_default_root(self) -> Path:
        return self._repo_root / "data" / "benchmarks" / "external" / "ufpr_alpr" / "extracted" / "UFPR-ALPR dataset"

    def _index_dataset(self):
        """Index all vehicle track folders and frame samples across splits."""
        for split in self.SUPPORTED_SPLITS:
            s_dir = self.root_path / split
            track_dirs = sorted([d.name for d in s_dir.iterdir() if d.is_dir()])
            self._tracks_by_split[split] = track_dirs

            samples = []
            for track in track_dirs:
                td = s_dir / track
                # Each track has 30 frames: trackXXXX[01].png to trackXXXX[30].png
                pngs = sorted([p.name for p in td.glob("*.png")])
                for p in pngs:
                    samples.append(f"{split}:{track}:{p}")
            self._samples_by_split[split] = sorted(samples)

    @property
    def dataset_metadata(self) -> DatasetMetadata:
        return DatasetMetadata(
            dataset_id="ufpr_alpr",
            dataset_name="UFPR-ALPR License Plate Detection & OCR Benchmark",
            root_path=self.root_path,
            description="4,500 Full HD images from 150 moving vehicle tracks with 30,000+ characters",
            supported_splits=self.SUPPORTED_SPLITS,
            properties={
                "evaluation_mode": self.mode.value,
                "total_tracks": 150,
                "total_images": 4500,
                "official_test_samples": 1800,
                "decontaminated_test_samples": 1740,
                "leaked_test_tracks": list(self.LEAKED_TEST_TRACKS),
            },
        )

    def get_supported_splits(self) -> List[str]:
        return list(self.SUPPORTED_SPLITS)

    def get_split_metadata(self, split: str) -> SplitMetadata:
        if split not in self.SUPPORTED_SPLITS:
            raise ValueError(f"Unknown split '{split}'. Supported: {self.SUPPORTED_SPLITS}")

        tracks = list(self._tracks_by_split[split])
        if split == "testing" and self.mode == EvaluationMode.DECONTAMINATED:
            tracks = [t for t in tracks if t not in self.LEAKED_TEST_TRACKS]

        num_samples = len(tracks) * 30

        return SplitMetadata(
            split_name=split,
            num_samples=num_samples,
            num_identities=len(tracks),
            num_cameras=3,  # GoPro Hero4 Silver, Huawei P9 Lite, iPhone 7 Plus
            properties={
                "evaluation_mode": self.mode.value,
                "track_count": len(tracks),
                "tracks": tracks,
            },
        )

    def get_sample_ids(self, split: str) -> List[str]:
        """
        Return deterministically sorted sample IDs for the split.
        Sample ID format: '{split}:{track_id}:{filename}'
        """
        if split not in self.SUPPORTED_SPLITS:
            raise ValueError(f"Unknown split '{split}'. Supported: {self.SUPPORTED_SPLITS}")

        all_samples = self._samples_by_split[split]
        if split == "testing" and self.mode == EvaluationMode.DECONTAMINATED:
            filtered = [
                s for s in all_samples
                if s.split(":")[1] not in self.LEAKED_TEST_TRACKS
            ]
            return filtered
        return list(all_samples)

    def _get_image_dimensions(self, image_path: Path) -> Tuple[int, int]:
        """
        Dynamically read image dimensions (width, height) without full image buffer decode.
        Caches dimensions per file path.
        """
        path_str = str(image_path)
        if path_str in self._image_dims_cache:
            return self._image_dims_cache[path_str]

        try:
            with Image.open(image_path) as im:
                w, h = im.size
                self._image_dims_cache[path_str] = (w, h)
                return (w, h)
        except Exception as e:
            raise CorruptAnnotationError(f"Unable to read image dimensions for {image_path}: {e}") from e

    def _parse_txt_annotation(
        self,
        txt_path: Path,
        img_width: int,
        img_height: int,
    ) -> Dict[str, Any]:
        """Parse raw TXT annotation and validate coordinate bounds against dynamic width/height."""
        if not txt_path.is_file():
            raise MissingFileError(f"Annotation file missing: {txt_path}")

        try:
            content = txt_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            raise CorruptAnnotationError(f"Cannot read annotation {txt_path}: {e}") from e

        # 1. Camera
        cam_m = re.search(r"(?m)^camera:\s*(.+)", content)
        camera = cam_m.group(1).strip() if cam_m else "unknown"

        # 2. Position vehicle
        vpos_m = re.search(r"(?m)^position_vehicle:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", content)
        vehicle_box = None
        if vpos_m:
            vx, vy, vw, vh = map(int, vpos_m.groups())
            vehicle_box = BoundingBox(
                x=float(vx),
                y=float(vy),
                width=float(vw),
                height=float(vh),
                class_name="vehicle",
                confidence=1.0,
            )
            if not vehicle_box.is_within_bounds(img_width, img_height, tolerance=2.0):
                raise InvalidCoordinateError(
                    f"Vehicle box {vehicle_box.to_xywh()} exceeds image bounds {img_width}x{img_height} in {txt_path}"
                )

        # 3. Vehicle Attributes
        type_m = re.search(r"(?m)^\s*type:\s*(\w+)", content)
        make_m = re.search(r"(?m)^\s*make:\s*(.+)", content)
        model_m = re.search(r"(?m)^\s*model:\s*(.+)", content)
        year_m = re.search(r"(?m)^\s*year:\s*(.+)", content)

        v_type = type_m.group(1).strip() if type_m else "unknown"
        make = make_m.group(1).strip() if make_m else ""
        model = model_m.group(1).strip() if model_m else ""
        year = year_m.group(1).strip() if year_m else ""

        # 4. Plate text
        plate_m = re.search(r"(?m)^plate:\s*([A-Z0-9]+)", content)
        if not plate_m or len(plate_m.group(1).strip()) != 7:
            raise CorruptAnnotationError(f"Missing or invalid 7-char plate in {txt_path}")
        plate_text = plate_m.group(1).strip()

        # 5. Corners (4 points: x1,y1 x2,y2 x3,y3 x4,y4)
        corners_m = re.search(r"(?m)^corners:\s*(.+)", content)
        if not corners_m:
            raise CorruptAnnotationError(f"Missing corners in {txt_path}")
        pts = re.findall(r"(\d+),(\d+)", corners_m.group(1))
        if len(pts) != 4:
            raise CorruptAnnotationError(f"Expected 4 corner points in {txt_path}, found {len(pts)}")
        corner_points = []
        for x_s, y_s in pts:
            px, py = float(x_s), float(y_s)
            pt = Point2D(x=px, y=py)
            if not pt.is_within(img_width, img_height):
                raise InvalidCoordinateError(
                    f"Corner point ({px}, {py}) exceeds image bounds {img_width}x{img_height} in {txt_path}"
                )
            corner_points.append(pt)

        # 6. Character boxes (char 1 to char 7)
        chars = re.findall(r"(?m)^\s*char\s+(\d+):\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", content)
        if len(chars) != 7:
            raise CorruptAnnotationError(f"Expected 7 characters in {txt_path}, found {len(chars)}")

        char_annotations = []
        for c_idx, cx, cy, cw, ch in chars:
            idx = int(c_idx)
            char_char = plate_text[idx - 1] if 1 <= idx <= len(plate_text) else ""
            c_box = BoundingBox(
                x=float(cx),
                y=float(cy),
                width=float(cw),
                height=float(ch),
                class_name="plate_char",
                confidence=1.0,
            )
            if not c_box.is_within_bounds(img_width, img_height, tolerance=2.0):
                raise InvalidCoordinateError(
                    f"Char box {c_box.to_xywh()} exceeds image bounds {img_width}x{img_height} in {txt_path}"
                )
            char_annotations.append(CharAnnotation(index=idx, box=c_box, character=char_char))

        return {
            "camera": camera,
            "vehicle_box": vehicle_box,
            "vehicle_type": v_type,
            "make": make,
            "model": model,
            "year": year,
            "plate_text": plate_text,
            "corners": corner_points,
            "characters": char_annotations,
        }

    def get_record(self, sample_id: str) -> UfprAlprRecord:
        """
        Retrieve a single UFPR observation record.
        sample_id format: '{split}:{track_id}:{filename}', e.g., 'training:track0001:track0001[01].png'.
        """
        if sample_id in self._record_cache:
            return self._record_cache[sample_id]

        parts = sample_id.split(":")
        if len(parts) != 3:
            raise ValueError(f"Invalid sample_id format: '{sample_id}'. Expected 'split:track:filename'")

        split, track_id, filename = parts
        if split not in self.SUPPORTED_SPLITS:
            raise ValueError(f"Unsupported split '{split}'")

        # Decontamination check
        if (
            split == "testing"
            and self.mode == EvaluationMode.DECONTAMINATED
            and track_id in self.LEAKED_TEST_TRACKS
        ):
            raise LoaderError(
                f"Track '{track_id}' is excluded in DECONTAMINATED mode due to training split leakage. "
            )

        track_dir = self.root_path / split / track_id
        img_path = track_dir / filename
        txt_path = img_path.with_suffix(".txt")

        if not img_path.is_file():
            raise MissingFileError(f"UFPR image missing: {img_path}")
        if not txt_path.is_file():
            raise MissingFileError(f"UFPR annotation missing: {txt_path}")

        # Dynamic dimension retrieval
        img_w, img_h = self._get_image_dimensions(img_path)

        # Parse text annotation
        parsed = self._parse_txt_annotation(txt_path, img_w, img_h)

        # Extract frame index
        frame_match = re.search(r"\[(\d+)\]", filename)
        frame_idx = int(frame_match.group(1)) if frame_match else 1

        is_leaked = (split == "testing" and track_id in self.LEAKED_TEST_TRACKS)

        record = UfprAlprRecord(
            sample_id=sample_id,
            split=split,
            image_path=img_path,
            track_id=track_id,
            frame_index=frame_idx,
            camera=parsed["camera"],
            vehicle_box=parsed["vehicle_box"],
            vehicle_type=parsed["vehicle_type"],
            make=parsed["make"],
            model=parsed["model"],
            year=parsed["year"],
            plate_text=parsed["plate_text"],
            corners=parsed["corners"],
            characters=parsed["characters"],
            image_width=img_w,
            image_height=img_h,
            is_leaked_track=is_leaked,
            metadata={
                "split": split,
                "track": track_id,
                "filename": filename,
                "camera": parsed["camera"],
                "vehicle_type": parsed["vehicle_type"],
                "year": parsed["year"],
                "is_padded_1088p": (img_h == 1088),
            },
        )

        self._record_cache[sample_id] = record
        return record

    def validate(self) -> ValidationResult:
        """
        Validate all 4,500 UFPR samples:
        - Image & TXT existence.
        - Dynamic image dimensions (check 1080p vs 1088p counts).
        - Coordinate boundaries for vehicle boxes, corners, characters.
        - Plate strings (verify the 2 leaked tracks between train and test).
        - Test split sample counts under official vs decontaminated mode.
        """
        result = ValidationResult(
            dataset_id="ufpr_alpr",
            is_valid=True,
            total_samples=0,
            matched_samples=0,
        )

        dims_distribution: Dict[str, int] = {}
        plates_by_split: Dict[str, Set[str]] = {s: set() for s in self.SUPPORTED_SPLITS}
        track_plates: Dict[str, str] = {}
        invalid_coords = []
        padded_1088_samples = []

        total = 0
        matched = 0

        for split in self.SUPPORTED_SPLITS:
            s_dir = self.root_path / split
            track_dirs = self._tracks_by_split[split]

            for track in track_dirs:
                td = s_dir / track
                txts = sorted(list(td.glob("*.txt")))

                for txt_path in txts:
                    total += 1
                    png_path = txt_path.with_suffix(".png")
                    if not png_path.is_file():
                        result.missing_samples += 1
                        result.add_issue(f"Missing PNG for {txt_path}")
                        continue

                    matched += 1
                    w, h = self._get_image_dimensions(png_path)
                    dim_str = f"{w}x{h}"
                    dims_distribution[dim_str] = dims_distribution.get(dim_str, 0) + 1

                    if h == 1088:
                        padded_1088_samples.append(f"{split}/{track}/{png_path.name}")

                    try:
                        parsed = self._parse_txt_annotation(txt_path, w, h)
                        plate = parsed["plate_text"]
                        plates_by_split[split].add(plate)
                        track_plates[f"{split}/{track}"] = plate
                    except Exception as e:
                        result.corrupted_samples += 1
                        invalid_coords.append(str(e))

        result.total_samples = total
        result.matched_samples = matched

        if invalid_coords:
            result.add_issue(f"Found {len(invalid_coords)} coordinate/format errors. Sample: {invalid_coords[:3]}")

        # Check train vs test leakage
        train_plates = plates_by_split["training"]
        test_plates = plates_by_split["testing"]
        overlap = train_plates.intersection(test_plates)

        if overlap:
            result.leakage_detected = True
            # In official mode this is an acknowledged benchmark characteristic
            result.summary["official_leaked_plates"] = list(overlap)

        result.summary = {
            "total_samples": total,
            "matched_samples": matched,
            "dimensions_distribution": dims_distribution,
            "padded_1088p_images": len(padded_1088_samples),
            "unique_plates_train": len(train_plates),
            "unique_plates_val": len(plates_by_split["validation"]),
            "unique_plates_test": len(test_plates),
            "total_unique_vehicles": len(set(track_plates.values())),
            "leaked_test_tracks": list(self.LEAKED_TEST_TRACKS),
            "active_evaluation_mode": self.mode.value,
        }

        # Check expected counts
        if total != 4500:
            result.add_issue(f"Expected 4,500 samples, found {total}")
        if dims_distribution.get("1920x1088", 0) != 61:
            result.add_issue(f"Expected exactly 61 1088p images, found {dims_distribution.get('1920x1088', 0)}")
        if len(set(track_plates.values())) != 148:
            result.add_issue(f"Expected 148 unique vehicles across 150 tracks, found {len(set(track_plates.values()))}")

        return result

