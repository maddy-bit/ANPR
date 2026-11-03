import pytest
import numpy as np
import os
import sys
from pathlib import Path

# Add ai-service to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.plate_normalizer import normalize_plate, is_plausible_indian_plate
from ai.reid import ReIdService, ReIdEmbedding
from ai.dehazer import ImageDehazer
from ai.color_classifier import ColorClassifier
from ai.identity_scorer import IdentityScorer
from schemas import VehicleObservation


def test_plate_normalizer():
    assert normalize_plate("mh 12 ab 1234") == "MH12AB1234"
    assert normalize_plate("MH-12-AB-1234") == "MH12AB1234"
    assert normalize_plate("DL 01 C AA 1111") == "DL01CAA1111"
    assert is_plausible_indian_plate("MH12AB1234") is True
    assert is_plausible_indian_plate("XYZ") is False


def test_color_classifier():
    classifier = ColorClassifier()
    # Test with blue patch
    blue_img = np.zeros((100, 100, 3), dtype=np.uint8)
    blue_img[:, :] = (255, 0, 0) # BGR: Blue
    res = classifier.classify(blue_img)
    color = res.color if hasattr(res, "color") else str(res)
    assert color.lower() == "blue"


def test_reid_service():
    reid = ReIdService()
    crop1 = np.ones((100, 100, 3), dtype=np.uint8) * 128
    crop2 = np.ones((100, 100, 3), dtype=np.uint8) * 128
    crop3 = np.zeros((100, 100, 3), dtype=np.uint8)

    emb1 = reid.embed(crop1)
    emb2 = reid.embed(crop2)
    emb3 = reid.embed(crop3)

    assert emb1 is not None
    assert emb2 is not None
    assert len(emb1.vector) > 0

    sim_same = reid.similarity(emb1, emb2)
    sim_diff = reid.similarity(emb1, emb3)
    assert sim_same > sim_diff
    assert sim_same >= 0.90


def test_dehazer():
    dehazer = ImageDehazer()
    hazy_img = np.ones((100, 100, 3), dtype=np.uint8) * 200
    res = dehazer.dehaze(hazy_img)
    assert res.shape == hazy_img.shape
    assert res.dtype == np.uint8


def test_identity_scorer():
    scorer = IdentityScorer()
    vec = [0.1] * 10
    norm = np.linalg.norm(vec)
    vec_norm = (np.array(vec) / norm).tolist()

    obs1 = VehicleObservation(
        camera_id="CAM-01", track_id=1, reid_embedding=vec_norm,
        license_plate="MH12AB1234", plate_confidence=0.9, color="Blue", vehicle_type="car"
    )
    obs2 = VehicleObservation(
        camera_id="CAM-02", track_id=2, reid_embedding=vec_norm,
        license_plate="MH12AB1234", plate_confidence=0.9, color="Blue", vehicle_type="car"
    )
    match_res = scorer.score_pair(obs1, obs2)
    assert match_res.is_match is True
    assert match_res.plate_score > 0.8
    assert match_res.reid_score > 0.8

