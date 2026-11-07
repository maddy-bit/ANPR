"""
Multi-factor identity scoring engine for cross-camera vehicle association.

Combines 6 weighted signals into a single unified match score:
  1. License Plate Text Match (40% weight) - Levenshtein string similarity
  2. Appearance Re-ID Embedding Similarity (30% weight) - Cosine distance
  3. Dominant Color Similarity (12% weight)
  4. Vehicle Type Compatibility (10% weight)
  5. Temporal Proximity (5% weight)
  6. Camera Spatial Topology Feasibility (3% weight)
"""

from __future__ import annotations
import math
import numpy as np
import logging
from config import cfg
from schemas import VehicleObservation, IdentityMatchResult
from ai.reid import ReIdService
from ai.camera_topology import CameraTopologyService, FeasibilityStatus

logger = logging.getLogger(__name__)


def levenshtein_distance(s1: str, s2: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]


def compute_plate_similarity(p1: str | None, p2: str | None) -> float:
    """
    Computes normalized similarity between two license plate strings [0.0 - 1.0].
    Handles character confusions (e.g. O/0, I/1, B/8).
    """
    if not p1 or not p2:
        return 0.0

    p1_clean = p1.replace("-", "").replace(" ", "").upper()
    p2_clean = p2.replace("-", "").replace(" ", "").upper()

    if p1_clean == p2_clean:
        return 1.0

    max_len = max(len(p1_clean), len(p2_clean))
    if max_len == 0:
        return 0.0

    dist = levenshtein_distance(p1_clean, p2_clean)

    # 1 edit distance in 10-char plate = 0.90 similarity
    sim = max(0.0, 1.0 - (dist / float(max_len)))

    # Prefix state code match bonus (e.g., both MH, both KA)
    if len(p1_clean) >= 2 and len(p2_clean) >= 2 and p1_clean[:2] == p2_clean[:2]:
        sim = min(1.0, sim + 0.05)

    return sim


class IdentityScorer:
    def __init__(
        self,
        reid_service: ReIdService | None = None,
        topology_service: CameraTopologyService | None = None,
    ):
        self.reid_service = reid_service or ReIdService()
        self.topology_service = topology_service or CameraTopologyService()

        # Weights from config
        self.w_plate = float(cfg.WEIGHT_PLATE_MATCH)
        self.w_reid = float(cfg.WEIGHT_REID_SIMILARITY)
        self.w_color = float(cfg.WEIGHT_COLOR_MATCH)
        self.w_type = float(cfg.WEIGHT_TYPE_MATCH)
        self.w_temp = float(cfg.WEIGHT_TEMPORAL_DELTA)
        self.w_topo = float(cfg.WEIGHT_TOPOLOGY_FEASIBILITY)

    def score_pair(
        self,
        obs1: VehicleObservation,
        obs2: VehicleObservation,
    ) -> IdentityMatchResult:
        """
        Calculates multi-signal match score between two vehicle observations from different cameras/tracks.
        Explicit decision outcomes: MATCH, NO_MATCH, UNCERTAIN.
        """
        # 1. Plate score & conflict check
        plate_sim = compute_plate_similarity(obs1.license_plate, obs2.license_plate)
        if obs1.license_plate and obs2.license_plate:
            plate_conf_factor = (obs1.plate_confidence + obs2.plate_confidence) / 2.0
            s_plate = plate_sim * (0.4 + 0.6 * plate_conf_factor)
        else:
            s_plate = 0.0

        is_plate_conflict = False
        if (
            obs1.license_plate
            and obs2.license_plate
            and obs1.plate_confidence >= 0.70
            and obs2.plate_confidence >= 0.70
            and plate_sim < 0.75
        ):
            is_plate_conflict = True

        # 2. Re-ID model compatibility & embedding score
        reid_incompatible = False
        if obs1.reid_model_name and obs2.reid_model_name and obs1.reid_model_name != obs2.reid_model_name:
            reid_incompatible = True
        if obs1.reid_dimension and obs2.reid_dimension and obs1.reid_dimension != obs2.reid_dimension:
            reid_incompatible = True

        if obs1.reid_embedding and obs2.reid_embedding and not reid_incompatible:
            vec1 = np.array(obs1.reid_embedding, dtype=np.float32)
            vec2 = np.array(obs2.reid_embedding, dtype=np.float32)
            if len(vec1) == len(vec2) and len(vec1) > 0:
                dot = float(np.dot(vec1, vec2))
                s_reid = max(0.0, min(1.0, dot))
            else:
                s_reid = 0.0
        else:
            s_reid = 0.0

        # 3. Color score
        if obs1.color and obs2.color and obs1.color != "Unknown" and obs2.color != "Unknown":
            s_color = 1.0 if obs1.color.lower() == obs2.color.lower() else 0.0
        else:
            s_color = 0.5  # Neutral if unknown

        # 4. Vehicle Type score
        if obs1.vehicle_type and obs2.vehicle_type:
            s_type = 1.0 if obs1.vehicle_type.lower() == obs2.vehicle_type.lower() else 0.1
        else:
            s_type = 0.5

        # 5. Temporal score
        dt = abs(obs2.timestamp_first - obs1.timestamp_last)
        s_temp = max(0.0, 1.0 - (dt / 3600.0))

        # 6. Topology feasibility score & transition evaluation
        eval_res = self.topology_service.evaluate_transition(
            obs1.camera_id, obs1.timestamp_last,
            obs2.camera_id, obs2.timestamp_first,
        )
        s_topo = self.topology_service.topology_score(
            obs1.camera_id, obs1.timestamp_last,
            obs2.camera_id, obs2.timestamp_first,
        )

        is_physically_impossible = (eval_res.feasibility == FeasibilityStatus.IMPOSSIBLE_TRANSITION)
        is_topology_unknown = (eval_res.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN)

        # Baseline multi-signal weighted combination
        combined = (0.45 * s_plate) + (0.30 * s_reid) + (0.15 * s_type) + (0.10 * s_topo)

        # Decision Logic:
        decision = "UNCERTAIN"
        reason = ""
        is_match = False

        if is_physically_impossible:
            decision = "NO_MATCH"
            combined = 0.0
            reason = f"Physically impossible transition: {eval_res.reason}"
        elif is_plate_conflict:
            decision = "NO_MATCH"
            combined = min(0.15, combined)
            reason = f"High-confidence plate conflict overrides visual similarity: '{obs1.license_plate}' vs '{obs2.license_plate}'"
        elif reid_incompatible:
            decision = "UNCERTAIN"
            reason = f"Incompatible Re-ID models ({obs1.reid_model_name} vs {obs2.reid_model_name}); cross-model comparison rejected."
        elif is_topology_unknown:
            decision = "UNCERTAIN"
            reason = f"Camera topology/coordinates unconfigured; cannot verify physical feasibility ({eval_res.reason})."
        elif not obs1.license_plate or not obs2.license_plate:
            # Visual similarity alone rule (mitigates 30.12% false match rate)
            if s_reid >= 0.70:
                decision = "UNCERTAIN"
                reason = f"High visual similarity ({s_reid:.3f}) without plate verification is ambiguous; marked UNCERTAIN for review."
            elif s_reid < 0.45:
                decision = "NO_MATCH"
                reason = f"Low visual similarity ({s_reid:.3f}) with unreadable plate; rejected as NO_MATCH."
            else:
                decision = "UNCERTAIN"
                reason = "Plate unreadable and visual evidence inconclusive; marked UNCERTAIN."
        else:
            if s_plate >= 0.80 and s_reid >= 0.60 and s_type >= 0.70 and combined >= 0.80:
                decision = "MATCH"
                is_match = True
                reason = f"Multi-signal agreement: plate ({s_plate:.2f}), visual ({s_reid:.3f}), attributes ({s_type:.1f}), topology ({s_topo:.1f})"
            elif combined < 0.50 or s_reid < 0.40:
                decision = "NO_MATCH"
                reason = f"Insufficient evidence across signals (combined: {combined:.3f}, reid: {s_reid:.3f})"
            else:
                decision = "UNCERTAIN"
                reason = f"Evidence inconclusive (combined: {combined:.3f}); marked UNCERTAIN for review."

        return IdentityMatchResult(
            score=float(combined),
            total_score=float(combined),
            is_match=is_match,
            decision=decision,
            match_level=decision,
            reason=reason,
            plate_score=float(s_plate),
            reid_score=float(s_reid),
            color_score=float(s_color),
            type_score=float(s_type),
            temporal_score=float(s_temp),
            topology_score=float(s_topo),
        )
