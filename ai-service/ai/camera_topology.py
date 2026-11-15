"""
Camera topology & spatial-temporal feasibility module.

Evaluates spatial and temporal constraints between camera detections:
1. Spatial distance computation (Road Network Topology where calibrated, or Geodesic Haversine).
2. Explicit handling of unknown coordinates (no fabricated zero-distances).
3. Travel-time and speed plausibility gating to reject physically impossible transitions.
4. Safe handling of missing coordinates and timestamps.
"""

from __future__ import annotations
import math
import json
import logging
from enum import Enum
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict, Tuple

from config import cfg

logger = logging.getLogger(__name__)


class FeasibilityStatus(str, Enum):
    FEASIBLE = "FEASIBLE"
    IMPOSSIBLE_TRANSITION = "IMPOSSIBLE_TRANSITION"
    EXCEEDS_TIME_WINDOW = "EXCEEDS_TIME_WINDOW"
    FEASIBILITY_UNKNOWN = "FEASIBILITY_UNKNOWN"
    SAME_CAMERA_EXCLUDED = "SAME_CAMERA_EXCLUDED"


class DistanceMethod(str, Enum):
    ROAD_NETWORK_TOPOLOGY = "ROAD_NETWORK_TOPOLOGY"
    VERIFIED_ROAD_NETWORK = "VERIFIED_ROAD_NETWORK"
    GEODESIC_HAVERSINE = "GEODESIC_HAVERSINE"
    UNKNOWN_COORDINATES = "UNKNOWN_COORDINATES"


@dataclass
class CameraNode:
    camera_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    name: str = ""
    direction: Optional[str] = None

    @property
    def has_valid_coordinates(self) -> bool:
        if self.latitude is None or self.longitude is None:
            return False
        # Coordinates at (0, 0) represent unconfigured/unknown coordinates
        if abs(self.latitude) < 1e-4 and abs(self.longitude) < 1e-4:
            return False
        return -90.0 <= self.latitude <= 90.0 and -180.0 <= self.longitude <= 180.0


@dataclass
class CameraEdge:
    from_camera_id: str
    to_camera_id: str
    road_distance_km: float
    min_travel_time_sec: float
    max_travel_time_sec: float
    road_name: Optional[str] = None
    is_verified: bool = False
    verification_source: str = "UNVERIFIED_ESTIMATE"
    notes: Optional[str] = None


@dataclass
class SpatialTemporalEvaluation:
    feasibility: FeasibilityStatus
    distance_km: Optional[float]
    distance_method: DistanceMethod
    time_diff_sec: Optional[float]
    apparent_speed_kmh: Optional[float]
    reason: str


class CameraTopologyService:
    def __init__(
        self,
        camera_nodes: Optional[list[CameraNode]] = None,
        edges: Optional[list[CameraEdge]] = None,
        min_speed_kmh: Optional[float] = None,
        max_speed_kmh: Optional[float] = None,
        max_wait_seconds: Optional[float] = None,
        absolute_min_seconds: Optional[float] = None,
    ):
        self.nodes: Dict[str, CameraNode] = {}
        self.edges: Dict[Tuple[str, str], CameraEdge] = {}

        self.min_speed_kmh = min_speed_kmh if min_speed_kmh is not None else cfg.MIN_FEASIBLE_SPEED_KMH
        self.max_speed_kmh = max_speed_kmh if max_speed_kmh is not None else cfg.MAX_FEASIBLE_SPEED_KMH
        self.max_wait_seconds = max_wait_seconds if max_wait_seconds is not None else float(cfg.topology.max_wait_seconds)
        self.absolute_min_seconds = absolute_min_seconds if absolute_min_seconds is not None else float(cfg.topology.absolute_min_seconds)

        if camera_nodes:
            for node in camera_nodes:
                self.nodes[node.camera_id] = node

        if edges:
            for edge in edges:
                self.edges[(edge.from_camera_id, edge.to_camera_id)] = edge

        # Attempt to auto-seed from cameras.json if empty
        if not self.nodes and cfg.topology.cameras_file.exists():
            self.load_from_cameras_json(cfg.topology.cameras_file)

    def load_from_cameras_json(self, cameras_file: Path | str):
        try:
            with open(cameras_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                cid = item.get("id")
                if cid:
                    self.nodes[cid] = CameraNode(
                        camera_id=cid,
                        latitude=item.get("latitude"),
                        longitude=item.get("longitude"),
                        name=item.get("name", ""),
                        direction=item.get("direction"),
                    )
            logger.info(f"Loaded {len(self.nodes)} cameras into CameraTopologyService from {cameras_file}")
        except Exception as e:
            logger.warning(f"Could not load cameras from {cameras_file}: {e}")

    def add_camera(
        self,
        camera_id: str,
        lat: Optional[float],
        lon: Optional[float],
        name: str = "",
        direction: Optional[str] = None,
    ):
        self.nodes[camera_id] = CameraNode(
            camera_id=camera_id,
            latitude=lat,
            longitude=lon,
            name=name,
            direction=direction,
        )

    def add_edge(
        self,
        from_cam: str,
        to_cam: str,
        road_distance_km: float,
        min_sec: float,
        max_sec: float,
        road_name: Optional[str] = None,
        bidirectional: bool = True,
        is_verified: bool = True,
        verification_source: str = "CONFIGURED",
        notes: Optional[str] = None,
    ):
        edge = CameraEdge(from_cam, to_cam, road_distance_km, min_sec, max_sec, road_name, is_verified, verification_source, notes)
        self.edges[(from_cam, to_cam)] = edge
        if bidirectional:
            edge_rev = CameraEdge(to_cam, from_cam, road_distance_km, min_sec, max_sec, road_name, is_verified, verification_source, notes)
            self.edges[(to_cam, from_cam)] = edge_rev

    def calculate_distance(self, cam1_id: str, cam2_id: str) -> Tuple[Optional[float], DistanceMethod]:
        """
        Calculate spatial distance between two cameras.
        Returns:
            (distance_km: float | None, method: DistanceMethod)
        """
        # 1. Check calibrated road network edge (only if verified)
        edge_key = (cam1_id, cam2_id)
        if edge_key in self.edges:
            edge = self.edges[edge_key]
            if edge.is_verified:
                return edge.road_distance_km, DistanceMethod.ROAD_NETWORK_TOPOLOGY

        # 2. Check node existence and coordinate validity
        n1 = self.nodes.get(cam1_id)
        n2 = self.nodes.get(cam2_id)

        if (
            not n1
            or not n2
            or not n1.has_valid_coordinates
            or not n2.has_valid_coordinates
            or n1.latitude is None
            or n1.longitude is None
            or n2.latitude is None
            or n2.longitude is None
        ):
            return None, DistanceMethod.UNKNOWN_COORDINATES

        # 3. Geodesic Haversine calculation
        r = 6371.0  # Earth radius in kilometers
        lat1, lon1 = math.radians(n1.latitude), math.radians(n1.longitude)
        lat2, lon2 = math.radians(n2.latitude), math.radians(n2.longitude)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
        dist_km = r * c

        return dist_km, DistanceMethod.GEODESIC_HAVERSINE

    def evaluate_transition(
        self,
        cam1_id: str,
        t1: Optional[float],
        cam2_id: str,
        t2: Optional[float],
    ) -> SpatialTemporalEvaluation:
        """
        Evaluates spatial and temporal plausibility of an observation transition between two cameras.
        """
        # Rule 1: Same camera
        if cam1_id == cam2_id:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.SAME_CAMERA_EXCLUDED,
                distance_km=0.0,
                distance_method=DistanceMethod.GEODESIC_HAVERSINE,
                time_diff_sec=abs(t2 - t1) if (t1 is not None and t2 is not None) else None,
                apparent_speed_kmh=0.0,
                reason="Same camera observation; excluded from cross-camera association.",
            )

        # Rule 2: Coordinate validation
        n1 = self.nodes.get(cam1_id)
        n2 = self.nodes.get(cam2_id)
        if not n1 or not n1.has_valid_coordinates:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.FEASIBILITY_UNKNOWN,
                distance_km=None,
                distance_method=DistanceMethod.UNKNOWN_COORDINATES,
                time_diff_sec=abs(t2 - t1) if (t1 is not None and t2 is not None) else None,
                apparent_speed_kmh=None,
                reason=f"Missing or unconfigured source camera coordinates for {cam1_id}; cannot determine physical distance.",
            )
        if not n2 or not n2.has_valid_coordinates:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.FEASIBILITY_UNKNOWN,
                distance_km=None,
                distance_method=DistanceMethod.UNKNOWN_COORDINATES,
                time_diff_sec=abs(t2 - t1) if (t1 is not None and t2 is not None) else None,
                apparent_speed_kmh=None,
                reason=f"Missing or unconfigured destination camera coordinates for {cam2_id}; cannot determine physical distance.",
            )

        dist_km, method = self.calculate_distance(cam1_id, cam2_id)
        if dist_km is None:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.FEASIBILITY_UNKNOWN,
                distance_km=None,
                distance_method=method,
                time_diff_sec=abs(t2 - t1) if (t1 is not None and t2 is not None) else None,
                apparent_speed_kmh=None,
                reason=f"Missing or unconfigured camera coordinates between {cam1_id} and {cam2_id}; cannot determine physical distance.",
            )

        # Rule 3: Missing or uninitialized timestamps (<= 0.0 indicates unset timestamp)
        if t1 is None or t2 is None or (t1 <= 0.0 and t2 <= 0.0):
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.FEASIBILITY_UNKNOWN,
                distance_km=dist_km,
                distance_method=method,
                time_diff_sec=None,
                apparent_speed_kmh=None,
                reason="Missing or uninitialized detection timestamp; cannot evaluate temporal feasibility.",
            )

        delta_t_sec = abs(t2 - t1)

        # Rule 4: Calibrated verified road edge evaluation
        edge_key = (cam1_id, cam2_id)
        if edge_key in self.edges and self.edges[edge_key].is_verified:
            edge = self.edges[edge_key]
            if delta_t_sec < edge.min_travel_time_sec:
                return SpatialTemporalEvaluation(
                    feasibility=FeasibilityStatus.IMPOSSIBLE_TRANSITION,
                    distance_km=edge.road_distance_km,
                    distance_method=DistanceMethod.ROAD_NETWORK_TOPOLOGY,
                    time_diff_sec=delta_t_sec,
                    apparent_speed_kmh=(edge.road_distance_km / (delta_t_sec / 3600.0)) if delta_t_sec > 0 else 9999.0,
                    reason=(
                        f"Travel time ({delta_t_sec:.1f}s) is less than verified minimum road travel time "
                        f"({edge.min_travel_time_sec:.1f}s) for edge {cam1_id}->{cam2_id}."
                    ),
                )
            if delta_t_sec > edge.max_travel_time_sec:
                return SpatialTemporalEvaluation(
                    feasibility=FeasibilityStatus.EXCEEDS_TIME_WINDOW,
                    distance_km=edge.road_distance_km,
                    distance_method=DistanceMethod.ROAD_NETWORK_TOPOLOGY,
                    time_diff_sec=delta_t_sec,
                    apparent_speed_kmh=(edge.road_distance_km / (delta_t_sec / 3600.0)),
                    reason=(
                        f"Travel time ({delta_t_sec:.1f}s) exceeds maximum tracking window "
                        f"({edge.max_travel_time_sec:.1f}s) for edge {cam1_id}->{cam2_id}."
                    ),
                )
            apparent_speed = edge.road_distance_km / (delta_t_sec / 3600.0) if delta_t_sec > 0 else 0.0
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.FEASIBLE,
                distance_km=edge.road_distance_km,
                distance_method=DistanceMethod.ROAD_NETWORK_TOPOLOGY,
                time_diff_sec=delta_t_sec,
                apparent_speed_kmh=apparent_speed,
                reason=(
                    f"Transition feasible along verified road network ({edge.road_distance_km:.2f} km, "
                    f"dt={delta_t_sec:.1f}s, speed={apparent_speed:.1f} km/h)."
                ),
            )

        # Rule 5: Geodesic evaluation for unverified edges or unconfigured camera pairs
        # Near-zero time on distant cameras is physically impossible
        if delta_t_sec <= self.absolute_min_seconds and dist_km > 0.05:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.IMPOSSIBLE_TRANSITION,
                distance_km=dist_km,
                distance_method=DistanceMethod.GEODESIC_HAVERSINE,
                time_diff_sec=delta_t_sec,
                apparent_speed_kmh=9999.0,
                reason=(
                    f"Simultaneous or near-instantaneous sightings at geographically separated cameras "
                    f"(dist={dist_km:.2f} km, dt={delta_t_sec:.2f}s). Requires physically impossible speed."
                ),
            )

        # Time window expiration
        if delta_t_sec > self.max_wait_seconds:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.EXCEEDS_TIME_WINDOW,
                distance_km=dist_km,
                distance_method=DistanceMethod.GEODESIC_HAVERSINE,
                time_diff_sec=delta_t_sec,
                apparent_speed_kmh=(dist_km / (delta_t_sec / 3600.0)),
                reason=f"Time elapsed ({delta_t_sec:.1f}s) exceeds maximum plausible tracking window ({self.max_wait_seconds:.1f}s).",
            )

        # Apparent speed check
        hours = delta_t_sec / 3600.0
        apparent_speed = (dist_km / hours) if hours > 0 else 9999.0

        if apparent_speed > self.max_speed_kmh:
            return SpatialTemporalEvaluation(
                feasibility=FeasibilityStatus.IMPOSSIBLE_TRANSITION,
                distance_km=dist_km,
                distance_method=DistanceMethod.GEODESIC_HAVERSINE,
                time_diff_sec=delta_t_sec,
                apparent_speed_kmh=apparent_speed,
                reason=(
                    f"Apparent travel speed ({apparent_speed:.1f} km/h) exceeds maximum plausible limit "
                    f"({self.max_speed_kmh:.1f} km/h) over geodesic distance {dist_km:.2f} km in {delta_t_sec:.1f}s."
                ),
            )

        has_unverified = edge_key in self.edges and not self.edges[edge_key].is_verified
        note = (
            f"road connectivity between {cam1_id} and {cam2_id} is unverified; uncalibrated estimate excluded from travel-time gating"
            if has_unverified
            else f"no road connectivity configured between {cam1_id} and {cam2_id}; evaluated via geodesic lower bound"
        )

        return SpatialTemporalEvaluation(
            feasibility=FeasibilityStatus.FEASIBLE,
            distance_km=dist_km,
            distance_method=DistanceMethod.GEODESIC_HAVERSINE,
            time_diff_sec=delta_t_sec,
            apparent_speed_kmh=apparent_speed,
            reason=(
                f"Transition is physically plausible: geodesic distance={dist_km:.2f} km (straight-line), "
                f"dt={delta_t_sec:.1f}s, apparent_speed={apparent_speed:.1f} km/h ({note})."
            ),
        )

    # ─── Legacy compatibility helpers ─────────────────────────────────────────

    def haversine_distance_km(self, cam1_id: str, cam2_id: str) -> float:
        dist, _ = self.calculate_distance(cam1_id, cam2_id)
        return dist if dist is not None else 0.0

    def is_travel_feasible(
        self,
        cam1_id: str,
        t1: float,
        cam2_id: str,
        t2: float,
        max_speed_kmh: Optional[float] = None,
    ) -> Tuple[bool, float, float]:
        """Legacy helper returning (is_feasible: bool, distance_km: float, speed_kmh: float)."""
        eval_res = self.evaluate_transition(cam1_id, t1, cam2_id, t2)
        dist = eval_res.distance_km if eval_res.distance_km is not None else 0.0
        speed = eval_res.apparent_speed_kmh if eval_res.apparent_speed_kmh is not None else 0.0
        return (eval_res.feasibility == FeasibilityStatus.FEASIBLE), dist, speed

    def topology_score(self, cam1_id: str, t1: float, cam2_id: str, t2: float) -> float:
        """Legacy 0.0 - 1.0 scoring helper."""
        eval_res = self.evaluate_transition(cam1_id, t1, cam2_id, t2)
        if eval_res.feasibility == FeasibilityStatus.IMPOSSIBLE_TRANSITION:
            return 0.0
        if eval_res.feasibility in (FeasibilityStatus.FEASIBILITY_UNKNOWN, FeasibilityStatus.EXCEEDS_TIME_WINDOW):
            return 0.5  # Neutral fallback when topology or timestamps are unconfigured
        dist = eval_res.distance_km or 0.0
        speed = eval_res.apparent_speed_kmh or 0.0
        if dist <= 0.001:
            return 1.0
        if 5.0 <= speed <= 100.0:
            return 1.0
        elif speed < 5.0:
            return 0.8
        else:
            return max(0.2, 1.0 - (speed - 100.0) / 50.0)
