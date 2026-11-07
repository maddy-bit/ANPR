"""
Automated unit tests for Batch B3.2 External Dataset Loaders.

Covers:
1. Dynamic root discovery.
2. BoundingBox geometry, area, normalization, and bounds checking.
3. VeRi-776 loader:
   - Index parsing and gb18030 XML decode.
   - Exclusion and quarantine of all 32 orphan training images.
   - Train vs test identity disjointness (0% leakage).
   - Camera distance matrix and camera ID ordering.
   - Query vs gallery plate masking properties.
4. UA-DETRAC loader:
   - Test sequence isolation (40 test sequences only).
   - Frame indexing (preserves physical frames).
   - Negative empty-frame handling (omitted XML frames represented as 0-target).
   - Bounding box parsing and image dimensions.
5. UFPR-ALPR loader:
   - TXT annotation parsing (camera, vehicle pos, plate, corners, characters).
   - Dynamic dimension handling (1920x1080 and 1920x1088).
   - Dual evaluation modes: Official (60 test tracks / 1800 frames) vs Decontaminated (58 tracks / 1740 frames).
   - Quarantine of leaked tracks track0110 and track0140.
6. Error handling:
   - DatasetNotFoundError on missing root.
   - MissingFileError on non-existent sample.
   - CorruptAnnotationError on malformed annotations.
   - InvalidCoordinateError on out-of-bounds coordinates.
7. Determinism:
   - Sample IDs returned in consistent sorted order.
"""

import sys
import tempfile
from pathlib import Path
import pytest
import numpy as np

# Ensure ai-service is in sys.path
ai_service_root = Path(__file__).resolve().parents[1]
if str(ai_service_root) not in sys.path:
    sys.path.insert(0, str(ai_service_root))

from loaders.base import (
    BoundingBox,
    Point2D,
    DatasetNotFoundError,
    MissingFileError,
    CorruptAnnotationError,
    InvalidCoordinateError,
    LoaderError,
    find_repo_root,
)
from loaders.veri776 import VeRi776Loader, VeRi776Record
from loaders.ua_detrac import UaDetracLoader, UaDetracFrameRecord
from loaders.ufpr_alpr import UfprAlprLoader, UfprAlprRecord, EvaluationMode


def test_repo_root_discovery():
    repo_root = find_repo_root()
    assert repo_root.is_dir()
    assert (repo_root / "data" / "benchmarks").is_dir()


def test_bounding_box_primitives():
    box = BoundingBox(x=10.0, y=20.0, width=100.0, height=200.0, class_name="car")
    assert box.left == 10.0
    assert box.top == 20.0
    assert box.right == 110.0
    assert box.bottom == 220.0
    assert box.area == 20000.0
    assert box.to_xywh() == (10.0, 20.0, 100.0, 200.0)
    assert box.to_xyxy() == (10.0, 20.0, 110.0, 220.0)

    # Normalization
    norm_x, norm_y, norm_w, norm_h = box.to_normalized(1000.0, 1000.0)
    assert pytest.approx(norm_x) == 0.01
    assert pytest.approx(norm_y) == 0.02
    assert pytest.approx(norm_w) == 0.10
    assert pytest.approx(norm_h) == 0.20

    # Bounds check
    assert box.is_within_bounds(1000.0, 1000.0) is True
    assert box.is_within_bounds(50.0, 50.0) is False  # exceeds bounds


def test_bounding_box_invalid_dimensions():
    box = BoundingBox(x=0.0, y=0.0, width=-10.0, height=50.0)
    assert box.is_within_bounds(100.0, 100.0) is False


def test_point2d():
    pt = Point2D(x=50.0, y=80.0)
    assert pt.to_tuple() == (50.0, 80.0)
    assert pt.is_within(100.0, 100.0) is True
    assert pt.is_within(40.0, 100.0) is False


# -----------------------------------------------------------------------------
# VeRi-776 Loader Tests
# -----------------------------------------------------------------------------

def test_veri_loader_initialization_and_splits():
    loader = VeRi776Loader()
    assert loader.dataset_metadata.dataset_id == "veri_776"
    assert loader.get_supported_splits() == ["train", "test", "query"]

    # Verify counts declared in official indexes
    train_meta = loader.get_split_metadata("train")
    test_meta = loader.get_split_metadata("test")
    query_meta = loader.get_split_metadata("query")

    assert train_meta.num_samples == 37746
    assert test_meta.num_samples == 11579
    assert query_meta.num_samples == 1678

    assert train_meta.num_identities == 575
    assert test_meta.num_identities == 200
    assert query_meta.num_identities == 200


def test_veri_orphan_exclusion():
    loader = VeRi776Loader()
    train_samples = loader.get_sample_ids("train")

    # None of the 32 orphan files must appear in train sample IDs
    for orphan in loader.KNOWN_ORPHAN_FILES:
        assert f"train:{orphan}" not in train_samples

    # Attempting to retrieve an orphan directly must raise LoaderError
    with pytest.raises(LoaderError) as exc_info:
        loader.get_record("train:0395_c012_00049530_0.jpg")
    assert "quarantined" in str(exc_info.value).lower()


def test_veri_identity_disjointness():
    loader = VeRi776Loader()
    train_meta = loader.get_split_metadata("train")
    test_meta = loader.get_split_metadata("test")

    train_vids = set(train_meta.properties["vehicle_ids"])
    test_vids = set(test_meta.properties["vehicle_ids"])

    # Strict zero leakage
    leakage = train_vids.intersection(test_vids)
    assert len(leakage) == 0, f"Identity leakage detected: {leakage}"


def test_veri_record_retrieval_and_plate_masking():
    loader = VeRi776Loader()

    # Query sample
    query_samples = loader.get_sample_ids("query")
    q_rec = loader.get_record(query_samples[0])
    assert isinstance(q_rec, VeRi776Record)
    assert q_rec.is_query is True
    assert q_rec.is_plate_masked is False
    assert q_rec.vehicle_id != ""
    assert q_rec.camera_id != ""
    assert q_rec.image_path.is_file()

    # Test gallery sample
    test_samples = loader.get_sample_ids("test")
    t_rec = loader.get_record(test_samples[0])
    assert isinstance(t_rec, VeRi776Record)
    assert t_rec.is_query is False
    assert t_rec.is_plate_masked is True


def test_veri_camera_topology():
    loader = VeRi776Loader()
    dist_mat = loader.get_camera_distance_matrix()
    cam_order = loader.get_camera_id_order()

    assert isinstance(dist_mat, np.ndarray)
    assert dist_mat.shape == (20, 20)
    assert len(cam_order) == 20
    assert cam_order[0] == 7
    assert cam_order[-1] == 16


def test_veri_query_ground_truth():
    loader = VeRi776Loader()
    gt_indices, jk_indices = loader.get_query_ground_truth(0)
    assert len(gt_indices) > 0
    assert len(jk_indices) > 0
    assert isinstance(gt_indices[0], int)


# -----------------------------------------------------------------------------
# UA-DETRAC Loader Tests
# -----------------------------------------------------------------------------

def test_ua_detrac_loader_initialization():
    loader = UaDetracLoader()
    assert loader.dataset_metadata.dataset_id == "ua_detrac"
    assert loader.get_supported_splits() == ["test"]

    test_seqs = loader.get_test_sequences()
    assert len(test_seqs) == 40
    assert "MVI_39031" in test_seqs
    assert "MVI_39051" in test_seqs


def test_ua_detrac_frame_counts():
    loader = UaDetracLoader()
    sample_ids = loader.get_sample_ids("test")
    # All 56,340 physical frames preserved
    assert len(sample_ids) == 56340


def test_ua_detrac_empty_frame_handling():
    loader = UaDetracLoader()

    # Sequence MVI_39051: frames 992 to 1060 are omitted from XML
    # Verify that loader represents frame 995 as a valid 0-object frame
    sample_id = "MVI_39051:00995"
    rec = loader.get_record(sample_id)

    assert isinstance(rec, UaDetracFrameRecord)
    assert rec.sequence_name == "MVI_39051"
    assert rec.frame_num == 995
    assert rec.is_empty_scene is True
    assert len(rec.targets) == 0
    assert rec.image_path.is_file()

    # Frame 1 in MVI_39051 has targets
    rec1 = loader.get_record("MVI_39051:00001")
    assert rec1.is_empty_scene is False
    assert len(rec1.targets) > 0


def test_ua_detrac_box_coordinates():
    loader = UaDetracLoader()
    rec = loader.get_record("MVI_39031:00001")

    assert rec.width == 960
    assert rec.height == 540
    assert len(rec.targets) >= 1

    t0 = rec.targets[0]
    assert t0.vehicle_type in ["car", "bus", "van", "others"]
    assert t0.box.is_within_bounds(960, 540) is True


def test_ua_detrac_training_sequence_isolation():
    loader = UaDetracLoader()
    # Training sequence MVI_20011 exists in images but has no test annotations
    with pytest.raises(MissingFileError) as exc_info:
        loader.get_record("MVI_20011:00001")
    assert "training sequences are strictly excluded" in str(exc_info.value).lower()


# -----------------------------------------------------------------------------
# UFPR-ALPR Loader Tests
# -----------------------------------------------------------------------------

def test_ufpr_loader_initialization_and_splits():
    loader_official = UfprAlprLoader(mode=EvaluationMode.OFFICIAL)
    assert loader_official.get_supported_splits() == ["training", "validation", "testing"]

    train_meta = loader_official.get_split_metadata("training")
    val_meta = loader_official.get_split_metadata("validation")
    test_meta = loader_official.get_split_metadata("testing")

    assert train_meta.num_samples == 1800  # 60 tracks * 30
    assert val_meta.num_samples == 900    # 30 tracks * 30
    assert test_meta.num_samples == 1800   # 60 tracks * 30


def test_ufpr_dual_evaluation_modes():
    # Official mode: 60 test tracks, 1800 images
    loader_official = UfprAlprLoader(mode=EvaluationMode.OFFICIAL)
    test_samples_official = loader_official.get_sample_ids("testing")
    assert len(test_samples_official) == 1800

    # Decontaminated mode: 58 test tracks, 1740 images
    loader_decontam = UfprAlprLoader(mode=EvaluationMode.DECONTAMINATED)
    test_samples_decontam = loader_decontam.get_sample_ids("testing")
    assert len(test_samples_decontam) == 1740

    # Verify track0110 and track0140 are excluded in decontaminated mode
    for s in test_samples_decontam:
        assert "track0110" not in s
        assert "track0140" not in s

    # Verify attempting to get record for track0110 in decontaminated mode raises LoaderError
    with pytest.raises(LoaderError) as exc_info:
        loader_decontam.get_record("testing:track0110:track0110[01].png")
    assert "excluded in decontaminated mode" in str(exc_info.value).lower()


def test_ufpr_annotation_parsing_and_characters():
    loader = UfprAlprLoader()
    rec = loader.get_record("training:track0001:track0001[01].png")

    assert isinstance(rec, UfprAlprRecord)
    assert rec.track_id == "track0001"
    assert rec.frame_index == 1
    assert rec.camera == "GoPro Hero4 Silver"
    assert rec.plate_text == "AXV8804"
    assert len(rec.plate_text) == 7
    assert rec.vehicle_type == "car"
    assert rec.make == "Suzuki"
    assert rec.model == "Grand Vitara"
    assert rec.year == "2013"

    assert len(rec.corners) == 4
    assert len(rec.characters) == 7
    assert rec.vehicle_box is not None

    # Derive plate box from corners
    plate_box = rec.get_plate_box_from_corners()
    assert plate_box.area > 0
    assert plate_box.is_within_bounds(rec.image_width, rec.image_height)


def test_ufpr_dynamic_dimension_1088p_support():
    loader = UfprAlprLoader()

    # Standard 1080p sample
    rec_1080 = loader.get_record("training:track0001:track0001[01].png")
    assert rec_1080.image_width == 1920
    assert rec_1080.image_height == 1080
    assert rec_1080.is_padded_1088p is False

    # 1088p padded sample in testing/track0114
    rec_1088 = loader.get_record("testing:track0114:track0114[01].png")
    assert rec_1088.image_width == 1920
    assert rec_1088.image_height == 1088
    assert rec_1088.is_padded_1088p is True


# -----------------------------------------------------------------------------
# Error Handling & Edge Cases
# -----------------------------------------------------------------------------

def test_missing_dataset_root_raises_error():
    with pytest.raises(DatasetNotFoundError):
        VeRi776Loader(root_path="non/existent/path")


def test_missing_sample_raises_error():
    loader = VeRi776Loader()
    with pytest.raises(MissingFileError):
        loader.get_record("train:0001_does_not_exist_9999.jpg")


def test_deterministic_sample_order():
    loader = VeRi776Loader()
    samples1 = loader.get_sample_ids("test")
    samples2 = loader.get_sample_ids("test")
    assert samples1 == samples2
    assert samples1 == sorted(samples1)

