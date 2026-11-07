"""
SIH26127 Traffic Intelligence & Vehicle Investigation Platform
Phase B, Batch B3.2 — External Dataset Loader End-to-End Validation Script

Executes full dataset-wide validation for all three loaders:
1. VeRi-776
2. UA-DETRAC
3. UFPR-ALPR (Official & Decontaminated Modes)

Outputs machine-readable summary to console and writes results JSON.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Add ai-service to path
REPO_ROOT = Path(__file__).resolve().parents[1]
AI_SERVICE_DIR = REPO_ROOT / "ai-service"
if str(AI_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_DIR))

from loaders import (
    VeRi776Loader,
    UaDetracLoader,
    UfprAlprLoader,
    EvaluationMode,
)


def run_full_validation():
    print("=" * 75)
    print("BATCH B3.2 — EXTERNAL DATASET INGESTION LOADER VALIDATION")
    print("=" * 75)
    start_time = time.time()

    results = {}

    # 1. VeRi-776 Full Validation
    print("\n[1/3] Validating VeRi-776 Loader...")
    t0 = time.time()
    veri_loader = VeRi776Loader()
    veri_val = veri_loader.validate()
    t_veri = time.time() - t0
    print(f"  Status: {'PASSED' if veri_val.is_valid else 'FAILED'}")
    print(f"  Duration: {t_veri:.2f}s")
    print(f"  Total samples: {veri_val.total_samples}")
    print(f"  Matched samples on disk: {veri_val.matched_samples}")
    print(f"  Missing: {veri_val.missing_samples}")
    print(f"  Train VIDs: {veri_val.summary['train_vids']}, Test VIDs: {veri_val.summary['test_vids']}")
    print(f"  Orphan images quarantined: {veri_val.summary['orphan_files_isolated']}")
    print(f"  Identity leakage detected: {veri_val.leakage_detected}")
    if veri_val.issues:
        print(f"  Issues: {veri_val.issues}")

    results["veri_776"] = {
        "is_valid": veri_val.is_valid,
        "duration_seconds": round(t_veri, 2),
        "total_samples": veri_val.total_samples,
        "matched_samples": veri_val.matched_samples,
        "missing_samples": veri_val.missing_samples,
        "leakage_detected": veri_val.leakage_detected,
        "summary": veri_val.summary,
        "issues": veri_val.issues,
    }

    # 2. UA-DETRAC Full Validation
    print("\n[2/3] Validating UA-DETRAC Loader...")
    t0 = time.time()
    ua_loader = UaDetracLoader()
    ua_val = ua_loader.validate()
    t_ua = time.time() - t0
    print(f"  Status: {'PASSED' if ua_val.is_valid else 'FAILED'}")
    print(f"  Duration: {t_ua:.2f}s")
    print(f"  Test sequences: {ua_val.summary['test_sequences']}")
    print(f"  Total frames on disk: {ua_val.summary['total_frames_on_disk']}")
    print(f"  Empty-scene frames handled: {ua_val.summary['total_empty_frames']}")
    print(f"  XML-omitted empty frames: {ua_val.summary['xml_omitted_frames']}")
    print(f"  Total bounding boxes: {ua_val.summary['total_bounding_boxes']}")
    print(f"  Box distribution: {ua_val.summary['box_type_distribution']}")
    if ua_val.issues:
        print(f"  Issues: {ua_val.issues}")

    results["ua_detrac"] = {
        "is_valid": ua_val.is_valid,
        "duration_seconds": round(t_ua, 2),
        "total_samples": ua_val.total_samples,
        "matched_samples": ua_val.matched_samples,
        "missing_samples": ua_val.missing_samples,
        "leakage_detected": ua_val.leakage_detected,
        "summary": ua_val.summary,
        "issues": ua_val.issues,
    }

    # 3. UFPR-ALPR Full Validation (Official & Decontaminated Modes)
    print("\n[3/3] Validating UFPR-ALPR Loader...")
    t0 = time.time()
    ufpr_loader_official = UfprAlprLoader(mode=EvaluationMode.OFFICIAL)
    ufpr_val = ufpr_loader_official.validate()
    t_ufpr = time.time() - t0

    # Also test decontaminated mode sample count
    ufpr_loader_decontam = UfprAlprLoader(mode=EvaluationMode.DECONTAMINATED)
    decontam_samples = len(ufpr_loader_decontam.get_sample_ids("testing"))

    print(f"  Status: {'PASSED' if ufpr_val.is_valid else 'FAILED'}")
    print(f"  Duration: {t_ufpr:.2f}s")
    print(f"  Total samples: {ufpr_val.total_samples}")
    print(f"  Matched pairs: {ufpr_val.matched_samples}")
    print(f"  1088p padded images: {ufpr_val.summary['padded_1088p_images']}")
    print(f"  Unique physical vehicles: {ufpr_val.summary['total_unique_vehicles']}")
    print(f"  Official mode test samples: {len(ufpr_loader_official.get_sample_ids('testing'))}")
    print(f"  Decontaminated mode test samples: {decontam_samples}")
    print(f"  Quarantined leaked tracks: {ufpr_val.summary['leaked_test_tracks']}")
    if ufpr_val.issues:
        print(f"  Issues: {ufpr_val.issues}")

    results["ufpr_alpr"] = {
        "is_valid": ufpr_val.is_valid,
        "duration_seconds": round(t_ufpr, 2),
        "total_samples": ufpr_val.total_samples,
        "matched_samples": ufpr_val.matched_samples,
        "missing_samples": ufpr_val.missing_samples,
        "leakage_detected": ufpr_val.leakage_detected,
        "official_test_samples": len(ufpr_loader_official.get_sample_ids("testing")),
        "decontaminated_test_samples": decontam_samples,
        "summary": ufpr_val.summary,
        "issues": ufpr_val.issues,
    }

    total_time = time.time() - start_time
    print("\n" + "=" * 75)
    all_passed = all(r["is_valid"] for r in results.values())
    print(f"OVERALL RESULT: {'ALL LOADERS VALIDATED SUCCESSFULLY' if all_passed else 'VALIDATION ISSUES DETECTED'}")
    print(f"Total time elapsed: {total_time:.2f}s")
    print("=" * 75)

    out_file = REPO_ROOT / "data" / "benchmarks" / "b3_2_loader_validation_results.json"
    out_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nDetailed validation results written to: {out_file}")
    return all_passed


if __name__ == "__main__":
    success = run_full_validation()
    sys.exit(0 if success else 1)

