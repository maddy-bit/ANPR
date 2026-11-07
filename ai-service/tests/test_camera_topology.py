"""
Tests for CameraTopologyService and spatial-temporal feasibility evaluation.
"""

import pytest
from ai.camera_topology import (
    CameraTopologyService,
    CameraNode,
    CameraEdge,
    FeasibilityStatus,
    DistanceMethod,
)


def test_same_camera_excluded():
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)

    eval_res = topo.evaluate_transition("CAM-01", 100.0, "CAM-01", 120.0)
    assert eval_res.feasibility == FeasibilityStatus.SAME_CAMERA_EXCLUDED
    assert "Same camera" in eval_res.reason


def test_feasible_geodesic_transition():
    topo = CameraTopologyService(max_speed_kmh=100.0)
    # CAM-01 (18.5308, 73.8474) and CAM-02 (18.5236, 73.8478) are ~0.8 km apart
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-02", 18.5236, 73.8478)

    # 120 seconds for 0.8 km = 24 km/h (typical urban transit)
    eval_res = topo.evaluate_transition("CAM-01", 0.0, "CAM-02", 120.0)
    assert eval_res.feasibility == FeasibilityStatus.FEASIBLE
    assert eval_res.distance_method == DistanceMethod.GEODESIC_HAVERSINE
    assert eval_res.distance_km is not None
    assert 0.7 < eval_res.distance_km < 1.0
    assert eval_res.apparent_speed_kmh is not None
    assert 20.0 < eval_res.apparent_speed_kmh < 30.0


def test_impossible_fast_transition_rejected():
    topo = CameraTopologyService(max_speed_kmh=100.0)
    # CAM-01 and CAM-06 are ~8.5 km apart
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-06", 18.5089, 73.9260)

    # 10 seconds for 8.5 km = ~3060 km/h (impossible supersonic transit)
    eval_res = topo.evaluate_transition("CAM-01", 0.0, "CAM-06", 10.0)
    assert eval_res.feasibility == FeasibilityStatus.IMPOSSIBLE_TRANSITION
    assert eval_res.apparent_speed_kmh > 100.0
    assert "exceeds maximum plausible limit" in eval_res.reason


def test_simultaneous_distant_sightings_rejected():
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-06", 18.5089, 73.9260)

    # dt = 0.0s at geographically distant cameras
    eval_res = topo.evaluate_transition("CAM-01", 100.0, "CAM-06", 100.0)
    assert eval_res.feasibility == FeasibilityStatus.IMPOSSIBLE_TRANSITION
    assert "Simultaneous or near-instantaneous" in eval_res.reason


def test_missing_coordinates_handled_safely():
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    # Unconfigured camera with no coordinates
    topo.add_camera("CAM-UNKNOWN", None, None)

    eval_res = topo.evaluate_transition("CAM-01", 0.0, "CAM-UNKNOWN", 60.0)
    assert eval_res.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert eval_res.distance_method == DistanceMethod.UNKNOWN_COORDINATES
    assert eval_res.distance_km is None
    assert "Missing or unconfigured" in eval_res.reason


def test_zero_coordinates_handled_safely():
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-ZERO", 0.0, 0.0)

    eval_res = topo.evaluate_transition("CAM-01", 0.0, "CAM-ZERO", 60.0)
    assert eval_res.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert eval_res.distance_method == DistanceMethod.UNKNOWN_COORDINATES
    assert eval_res.distance_km is None


def test_missing_timestamp_handled_safely():
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-02", 18.5236, 73.8478)

    eval_res = topo.evaluate_transition("CAM-01", None, "CAM-02", 120.0)
    assert eval_res.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert eval_res.time_diff_sec is None
    assert "detection timestamp" in eval_res.reason


def test_calibrated_road_edge_evaluation():
    topo = CameraTopologyService()
    topo.add_camera("CAM-A", 18.50, 73.80)
    topo.add_camera("CAM-B", 18.51, 73.81)

    # Real calibrated road distance 2.5 km, min transit 120s, max 600s
    topo.add_edge("CAM-A", "CAM-B", road_distance_km=2.5, min_sec=120.0, max_sec=600.0, road_name="JM Road")

    # Feasible: dt = 180s
    res_ok = topo.evaluate_transition("CAM-A", 0.0, "CAM-B", 180.0)
    assert res_ok.feasibility == FeasibilityStatus.FEASIBLE
    assert res_ok.distance_method == DistanceMethod.ROAD_NETWORK_TOPOLOGY
    assert res_ok.distance_km == 2.5

    # Impossible: dt = 60s (< 120s min road time)
    res_fast = topo.evaluate_transition("CAM-A", 0.0, "CAM-B", 60.0)
    assert res_fast.feasibility == FeasibilityStatus.IMPOSSIBLE_TRANSITION
    assert "less than verified minimum road travel time" in res_fast.reason

    # Exceeds window: dt = 700s (> 600s max road time)
    res_slow = topo.evaluate_transition("CAM-A", 0.0, "CAM-B", 700.0)
    assert res_slow.feasibility == FeasibilityStatus.EXCEEDS_TIME_WINDOW


def test_unverified_camera_edge_does_not_impose_synthetic_limits():
    topo = CameraTopologyService()
    topo.add_camera("CAM-A", 18.5308, 73.8474)
    topo.add_camera("CAM-B", 18.5236, 73.8478)

    # Edge exists but is marked unverified (e.g. manual assumption)
    topo.add_edge(
        "CAM-A", "CAM-B",
        road_distance_km=1.2,
        min_sec=120.0,
        max_sec=600.0,
        is_verified=False,
        verification_source="UNVERIFIED_ESTIMATE"
    )

    # dt = 60s. Under a verified edge with min_sec=120, this would be rejected.
    # But because it is unverified, it falls back to geodesic evaluation:
    # 0.8 km in 60s = 48 km/h (plausible urban speed). It MUST be FEASIBLE!
    res = topo.evaluate_transition("CAM-A", 0.0, "CAM-B", 60.0)
    assert res.feasibility == FeasibilityStatus.FEASIBLE
    assert res.distance_method == DistanceMethod.GEODESIC_HAVERSINE
    assert "unverified; uncalibrated estimate excluded" in res.reason


def test_unconfigured_camera_pair_evaluates_geodesic_bounds():
    topo = CameraTopologyService()
    topo.add_camera("CAM-A", 18.5308, 73.8474)
    topo.add_camera("CAM-B", 18.5236, 73.8478)
    # NO edge added

    res = topo.evaluate_transition("CAM-A", 0.0, "CAM-B", 60.0)
    assert res.feasibility == FeasibilityStatus.FEASIBLE
    assert res.distance_method == DistanceMethod.GEODESIC_HAVERSINE
    assert "no road connectivity configured" in res.reason
