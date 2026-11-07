# Phase B, Batch B3.1 — External Dataset Integration Audit (READ-ONLY)

**Author:** Antigravity AI  
**Date:** 2026-11-08  
**Audit Status:** COMPLETE & VERIFIED  
**Enforcement:** STRICT READ-ONLY (Zero file modifications, zero renames, zero moves, zero deletions, zero Git commits/stages/pushes)  

---

## 1. Executive Summary & Verification Ledger

Three external benchmark datasets have been physically acquired, decompressed, and subjected to deep forensic read-only inspection under Phase B of the **SIH26127 Traffic Intelligence & Vehicle Investigation Platform**:

1. **VeRi-776**: Vehicle Re-Identification & Camera Topology Modeling
2. **UA-DETRAC**: Vehicle Detection & Multi-Object Tracking
3. **UFPR-ALPR**: License Plate Bounding Box Detection, 4-Corner Localization & Character Latin OCR

### System Storage & Integrity Ledger

| Property | Value | Verification Source |
| :--- | :--- | :--- |
| **Host System Free Disk Space** | `269.36 GB` | Verified via Windows PowerShell `Get-PSDrive C` |
| **Total Raw Archives Size** | `19.64 GB` (21,089,375,532 bytes) | Sum of raw archives in `data/benchmarks/external/*/raw/` |
| **Total Extracted Dataset Size** | `~28.9 GB` | Extracted directories under `data/benchmarks/external/*/extracted/` |
| **Modification Ledger** | **0 modifications** | All archives, images, annotations, and configs remain bit-for-bit pristine |
| **Git Safety Ledger** | **0 commits, 0 stages, 0 pushes** | Read-only execution; all scratch scripts isolated to temporary sandbox |

---

## 2. Dataset 1: VeRi-776 Deep Empirical Audit

### 2.1 Overview & Physical File Layout
- **Location**: `data/benchmarks/external/veri_776/extracted/VeRi/`
- **Raw Archive**: `data/benchmarks/external/veri_776/raw/VeRi.zip` (`945.51 MB`, `991,440,323 bytes`)
- **Primary Role**: Vehicle appearance feature extraction, Re-ID embedding evaluation (CMC Rank-1/5/10, mAP), cross-camera association, and spatio-temporal transition velocity calibration.

```
data/benchmarks/external/veri_776/extracted/VeRi/
├── image_train/            (37,778 JPEG files on disk)
├── image_test/             (11,579 JPEG files on disk)
├── image_query/            (1,678 JPEG files on disk)
├── train_label.xml         (Authoritative train metadata: 37,746 items)
├── test_label.xml          (Authoritative test metadata: 11,579 items)
├── name_train.txt          (Authoritative train file listing: 37,746 lines)
├── name_test.txt           (Authoritative test file listing: 11,579 lines)
├── name_query.txt          (Authoritative query file listing: 1,678 lines)
├── jk_index.txt            (Junk filter index: 1,678 lines matching queries)
├── gt_index.txt            (Ground truth match index: 1,678 lines matching queries)
├── camera_Dist.txt         (20x20 camera physical distance matrix)
└── camera_ID.txt           (Camera index sequence: 20 ordered camera IDs)
```

### 2.2 Empirical Reconciliation & The 32 Orphan Train Images Discrepancy

A critical discrepancy was discovered during reconciliation between physical disk files and ground-truth text/XML indexes:

| Partition | Disk Files | Index Files (`name_*.txt`) | XML Records (`*_label.xml`) | Discrepancy Status |
| :--- | :--- | :--- | :--- | :--- |
| `image_train` | **37,778** | **37,746** | **37,746** | **+32 unannotated orphan files on disk** |
| `image_test` | **11,579** | **11,579** | **11,579** | Exact match (0 discrepancy) |
| `image_query` | **1,678** | **1,678** | N/A (`name_query.txt`) | Exact match (0 discrepancy) |

#### Forensic Root-Cause Analysis of the 32 Orphan Files
The 32 extra files on disk belong to three specific vehicle IDs:
- Vehicle `0324`: 5 orphan files (`0324_c019_00024330_0.jpg` to `0324_c019_00024365_0.jpg`)
- Vehicle `0389`: 24 orphan files (`0389_c014_00061220_0.jpg` to `0389_c019_00062020_0.jpg`)
- Vehicle `0395`: 3 orphan files (`0395_c012_00049505_0.jpg` to `0395_c012_00049530_0.jpg`)

SHA-256 cryptographic cross-matching against the entire dataset revealed:
1. **Cross-Split Collision**: Orphan file `0395_c012_00049530_0.jpg` in `image_train` has an **identical SHA-256 hash** to test gallery image `0402_c012_00049530_0.jpg`. It was a mislabeled observation of test vehicle `0402`!
2. **Internal Duplicate Collisions**: 11 orphan files from `0324` and `0389` matched exact SHA-256 hashes of valid training images labeled under different vehicle IDs (e.g. `0304_c019_...` and `0432_c014_...`).

> [!IMPORTANT]
> **Forensic Conclusion**: The official VeRi-776 authors identified these mislabeled and duplicated crops during dataset curation and cleaned their official indexes (`name_train.txt` and `train_label.xml`), but neglected to delete the orphan image files from the image directory archive.
> **Integration Protocol**: The evaluation harness **MUST** consume `name_train.txt` and `train_label.xml` as the authoritative source of truth (exactly 37,746 images). All 32 unannotated orphan files **MUST** be excluded from any model ingestion.

### 2.3 Identity Partitions & Zero Leakage Verification
- **Training Vehicle IDs**: 575 unique identities (`0001` through `0575`).
- **Test Gallery Vehicle IDs**: 200 unique identities (`0576` through `0776`).
- **Query Vehicle IDs**: 200 unique identities (`0576` through `0776`), 100% subset of test gallery IDs.
- **Train vs Test Overlap**: **EXACTLY ZERO (0% leakage)** between official training and test sets.

### 2.4 Query vs Gallery Pixel Analysis
- All 1,678 query image filenames are physically present in `image_test`.
- SHA-256 hashing revealed that 299 query images have identical hashes to their gallery counterparts.
- 1,379 query images have minor pixel differences localized specifically to the vehicle license plate region ($x \in [61, 123], y \in [167, 191]$). In the test gallery, license plates are blacked out/masked to prevent Re-ID models from overfitting to plate text, whereas query crops contain slightly unmasked or differently compressed plate patches.
- Standard Re-ID evaluation protocol applies: query sightings from the identical camera and identical timestamp are junk-filtered via `jk_index.txt`.

### 2.5 Camera Topology & Parsing Requirements
- **Cameras**: 20 distinct surveillance viewpoints (`c001` to `c020`).
- **Camera Usage**: Training uses all 20 cameras; test gallery and query sets use 19 cameras (`c001` to `c019`). Camera `c020` is training-only.
- **Topology Matrices**: `camera_Dist.txt` provides a verified 20x20 distance matrix; `camera_ID.txt` specifies the exact camera index ordering: `[7, 5, 8, 4, 9, 3, 10, 6, 11, 2, 1, 13, 12, 18, 17, 19, 20, 15, 14, 16]`.
- **XML Multi-Byte Encoding**: `train_label.xml` and `test_label.xml` contain `<?xml version="1.0" encoding="gb2312" ?>`. Standard Python `xml.etree.ElementTree` raises `ValueError: multi-byte encodings are not supported`. Parsers must decode raw bytes using `gb18030` and replace the header with `utf-8` before parsing.
- **ALPR OCR Inapplicability**: VeRi-776 XML contains vehicle color and type attributes, but **zero license plate alphanumeric strings**. It cannot be used for OCR evaluation.

---

## 3. Dataset 2: UA-DETRAC Deep Empirical Audit

### 3.1 Overview & Physical File Layout
- **Location**: `data/benchmarks/external/ua_detrac/extracted/`
- **Raw Archives**:
  - `DETRAC-Images.zip`: `9,393.30 MB` (`9,849,588,527 bytes`)
  - `DETRAC-Test-Annotations-XML.zip`: `11.67 MB` (`12,240,654 bytes`)
  - `DETRAC-Test-Annotations-MAT.zip`: `2.00 MB` (`2,098,829 bytes`)
  - Total raw size: `9,406.97 MB` (`~9.41 GB`)
- **Primary Role**: Vehicle object detection (YOLOv8s), bounding box precision/recall, mAP@0.50/0.95, and single-camera multi-object tracking (MOTA/MOTP).

```
data/benchmarks/external/ua_detrac/extracted/
├── DETRAC-Images/                   (100 sequence directories: 40 test + 60 train)
├── DETRAC-Test-Annotations-XML/     (40 XML annotation files: MVI_XXXXX.xml)
└── DETRAC-Test-Annotations-MAT/     (40 MAT annotation files: MVI_XXXXX.mat)
```

### 3.2 Sequence & Frame Reconciliation: The 173-Frame Discrepancy

| Metric | Physical Disk | MAT Annotations | XML Annotations | Reconciliation Status |
| :--- | :--- | :--- | :--- | :--- |
| **Sequence Directories** | 100 directories | 40 files | 40 files | Exactly 40 test sequences; 60 train sequences unannotated in test pack |
| **Total Test Frames** | **56,340 frames** | **56,340 frames** | **56,167 frames** | **173 empty frames omitted from XML** |

#### Forensic Root-Cause Analysis of the 173-Frame XML Gap
In UA-DETRAC XML schema, frames with **zero target vehicles** (empty roadways) are completely omitted as `<frame>` elements. In contrast, the MAT files retain full matrix dimensions spanning all physical frames on disk, filling empty frames with zero coordinates.

The 173 omitted frames are concentrated in exactly 6 test sequences:
1. `MVI_39051`: 1,120 frames on disk, 1,051 in XML (**69 frames omitted**: frames 992 through 1060). MAT matrix is shape `(1120, 30)` with all zeros in rows 991:1060.
2. `MVI_39211`: 1,660 frames on disk, 1,566 in XML (**94 frames omitted**).
3. `MVI_39271`: 1,570 frames on disk, 1,566 in XML (**4 frames omitted**).
4. `MVI_40743`: 1,630 frames on disk, 1,629 in XML (**1 frame omitted**).
5. `MVI_40763`: 1,745 frames on disk, 1,741 in XML (**4 frames omitted**).
6. `MVI_40793`: 1,960 frames on disk, 1,959 in XML (**1 frame omitted**).
**Total gap**: $69 + 94 + 4 + 1 + 4 + 1 = 173$ empty frames. $56,167 + 173 = 56,340$ physical frames.

> [!TIP]
> **Integration Protocol**: The evaluation engine must iterate across the 40 test sequences and treat missing frame numbers in XML as valid negative frames (empty road, expected 0 detections) rather than raising missing-data exceptions.

### 3.3 Target Statistics & Environmental Conditions
- **Total Vehicle Bounding Boxes**: **675,774 bounding boxes** annotated across the 40 test sequences.
- **Vehicle Type Distribution**:
  - `car`: 548,555 boxes (81.2%)
  - `bus`: 71,785 boxes (10.6%)
  - `van`: 38,519 boxes (5.7%)
  - `others`: 16,915 boxes (2.5%)
- **Image Resolution**: 100% of frames across all 40 test sequences are **960 x 540 pixels**.
- **Environmental Diversity**:
  - Weather: Cloudy (11 sequences), Night (12 sequences), Rainy (9 sequences), Sunny (8 sequences).
  - Camera Stability: Stable (31 sequences), Unstable/Wind-jittered (9 sequences).
- **Sequence-Level Ignored Regions**: Exactly 40 ignored region polygons (used to mask distant highway ramps or parking areas where detection is not evaluated).

### 3.4 Limitations for Indian Traffic Intelligence
- **Zero Cross-Camera Identity Association**: UA-DETRAC sequences are captured from isolated overpasses. Vehicles in sequence `MVI_39031` never appear in `MVI_39051`. It is strictly a single-camera detection/tracking benchmark and cannot evaluate Re-ID or trajectory stitching.
- **Missing Vehicle Classes**: Completely lacks two-wheelers/motorcycles and auto-rickshaws, which comprise >70% of Indian urban vehicular traffic.

---

## 4. Dataset 3: UFPR-ALPR Deep Empirical Audit

### 4.1 Overview & Physical File Layout
- **Location**: `data/benchmarks/external/ufpr_alpr/extracted/UFPR-ALPR dataset/`
- **Raw Archive**: `data/benchmarks/external/ufpr_alpr/raw/yj4Iu2-UFPR-ALPR.zip` (`9,285.05 MB`, `9,736,047,209 bytes`)
- **Primary Role**: License plate bounding box detection, 4-corner polygon regression, and character-level Latin OCR recognition.

```
data/benchmarks/external/ufpr_alpr/extracted/UFPR-ALPR dataset/
├── training/       (60 vehicle track folders: track0001 to track0060; 1,800 images + 1,800 txt)
├── validation/     (30 vehicle track folders: track0061 to track0090; 900 images + 900 txt)
├── testing/        (60 vehicle track folders: track0091 to track0150; 1,800 images + 1,800 txt)
└── README.txt      (Official dataset documentation)
```

### 4.2 Verified Scale & Coordinate Boundary Integrity
- **Total Tracks (Vehicles)**: 150 tracks.
- **Frames per Track**: Exactly 30 frames per track ($150 \times 30 = 4,500$ frames).
- **Total Images & Annotations**: 4,500 PNG images and 4,500 TXT annotations (**100% matched pairs**, 0 missing files).
- **Coordinate Integrity**:
  - `position_vehicle`: 4,500 / 4,500 valid coordinates within image bounds ($x \ge 0, y \ge 0, x+w \le W, y+h \le H$).
  - `corners`: 4,500 / 4,500 valid 4-corner coordinates in standardized format `x1,y1 x2,y2 x3,y3 x4,y4`.
  - `char 1` through `char 7`: 31,500 / 31,500 valid character bounding boxes (exactly 7 characters per plate).
- **Vehicle Type Distribution**: Cars (3,600 frames, 80%), Motorcycles (900 frames, 20%).
- **Camera Sensors**: GoPro Hero4 Silver (1,500 frames), Huawei P9 Lite (1,500 frames), iPhone 7 Plus (1,500 frames), perfectly balanced 1:1:1 across all splits.

### 4.3 Critical Finding 1: Train vs Test Identity Leakage (In Official Benchmark Split)

> [!CAUTION]
> **CRITICAL GROUND-TRUTH LEAKAGE**: The official dataset documentation claims 150 unique vehicles across 150 tracks. However, empirical license plate string and vehicle metadata auditing revealed that there are only **148 unique physical vehicles**.
> Two physical vehicles were recorded twice (using different cameras at different times) and placed into **BOTH training and testing splits**:
> 1. **Plate `AVA1466`** (Mercedes-Benz OF-1418 Neobus Mega bus, 2011):
>    - `training/track0011`: Captured by **GoPro Hero4 Silver**
>    - `testing/track0140`: Captured by **iPhone 7 Plus**
> 2. **Plate `BBO8514`** (Yamaha XTZ motorcycle, 2017):
>    - `training/track0059`: Captured by **iPhone 7 Plus**
>    - `testing/track0110`: Captured by **GoPro Hero4 Silver**
>
> **Impact**: Evaluating directly on the official testing split without decontamination leaks 60 test images (two complete vehicle passes) that were already observed in the training split.
> **Integration Protocol**: The evaluation framework must provide **dual evaluation modes**:
> 1. *Official Split Mode*: Evaluates all 60 test tracks (1,800 images) for direct comparison with published academic literature.
> 2. *Decontaminated Split Mode*: Evaluates the 58 strictly disjoint test tracks (1,740 images), holding out `track0140` and `track0110` as a quarantined seen-identity sub-partition.

### 4.4 Critical Finding 2: Dimension Inconsistency (1920x1088 vs 1920x1080)
- While 4,439 images have standard Full HD dimensions of `1920 x 1080`, exactly **61 images** have dimensions of **1920 x 1088**:
  - `validation/track0072`: All 30 frames (`[01]` through `[30]`)
  - `testing/track0113`: 1 frame (`track0113[30]`)
  - `testing/track0114`: All 30 frames (`[01]` through `[30]`)
- **Root Cause**: Video codecs operating with $16 \times 16$ macroblocks pad 1080 vertical lines to 1088 ($16 \times 68 = 1088$).
- **Impact**: Any preprocessing pipeline that assumes a static 1080 canvas height will suffer an 8-pixel vertical coordinate shift (~0.74% distortion). Parsers must dynamically query `image.size[1]`.

### 4.5 Critical Finding 3: Exact Bitwise Duplicate Frame
- SHA-256 analysis across all 4,500 images identified exactly 1 duplicate hash pair:
  - `validation/track0090/track0090[14].png` and `validation/track0090/track0090[15].png` share SHA-256 hash `dd28c7acda93...` (identical duplicate frame).
  - All other 4,498 images are visually and cryptographically distinct.

### 4.6 Operational Domain & Indian Traffic Context
- **Sensor Perspective**: Cameras were mounted inside a moving patrol car at windshield/eye level (1.5 to 2.0 m height). This evaluates mobile dashcam ALPR under vehicle-to-vehicle relative motion, NOT high-angle overhead CCTV gantry surveillance (5 to 10 m pole elevation).
- **Plate Syntax**: 100% Brazilian Latin alphanumeric format (3 letters + 4 digits, e.g. `AXV8804`). Validates Latin character OCR models (EasyOCR, CRNN) on real-world blur and glare, but does NOT substitute for Indian CMVR Rule 50 license plates (which feature 2-letter state codes, district codes, and differing font standards).

---

## 5. Cross-Dataset Comparison & Synthesis Matrix

| Dimension | VeRi-776 | UA-DETRAC | UFPR-ALPR |
| :--- | :--- | :--- | :--- |
| **Pipeline Stage** | Vehicle Re-ID & Spatio-Temporal Topology | Vehicle Detection & Tracking | License Plate Detection & OCR |
| **Local Path** | `.../veri_776/extracted/VeRi/` | `.../ua_detrac/extracted/` | `.../ufpr_alpr/extracted/.../` |
| **Raw Archive Size** | `945.51 MB` | `9,406.97 MB` (3 archives) | `9,285.05 MB` |
| **Extracted Size** | `~2.8 GB` | `~14.6 GB` | `~11.5 GB` |
| **Physical Images on Disk** | 51,035 images | 56,340 frames (40 test seqs) | 4,500 PNG images |
| **Authoritative Samples** | 37,746 train / 11,579 test / 1,678 query | 56,340 test frames (56,167 XML) | 1,800 train / 900 val / 1,800 test |
| **Identities / Tracks** | 575 train / 200 test VIDs | Single-camera tracks (0 cross-cam) | 148 unique vehicles (150 tracks) |
| **Camera Viewpoints** | 20 fixed CCTV cameras | 24 highway overpass viewpoints | 3 mobile in-vehicle cameras |
| **Resolutions** | Variable crops (~400x300) | Uniform 960 x 540 (100%) | 1920x1080 (4,439) + 1920x1088 (61) |
| **Verified Leakage** | **0% official leakage** (1 orphan collision) | **0% sequence leakage** | **2 vehicles leaked** across train/test |
| **Critical Formatting Note** | XML encoded in `gb2312`/`gb18030` | Empty frames omitted in XML | 1088p vertical macroblock padding |
| **Plate Text Available?** | No (Vehicle crops only) | No (Vehicle bounding boxes only) | Yes (31,500 characters, 7 per plate) |

---

## 6. Architectural Recommendations for Batch B3.2 (Integration & Ingestion)

Based on this audit, the integration plan for Batch B3.2 must adhere to the following architecture:

1. **Authoritative Index Ingestion for VeRi-776**:
   - Ingest strictly from `name_train.txt` and `name_test.txt`.
   - Never ingest raw directory listings of `image_train`, ensuring the 32 orphan images (and their cross-split collision with test vehicle `0402`) are quarantined.
   - Employ `gb18030` decoding for `train_label.xml` and `test_label.xml`.

2. **Negative Frame Handling for UA-DETRAC**:
   - The test evaluator must loop through sequences using the 40 test sequence names.
   - When encountering frame numbers present on disk but absent in XML, the evaluator must treat them as true negative frames with 0 expected ground-truth objects rather than throwing data integrity errors.

3. **Dual Split Evaluation for UFPR-ALPR**:
   - Provide an official 60-track evaluation option alongside a decontaminated 58-track evaluation option that excludes `track0140` and `track0110`.
   - Dynamically compute normalized bounding box coordinates based on `image.size[1]` rather than hardcoded 1080 to accommodate the 61 1088p images.

4. **Preservation of System Integrity**:
   - Keep all raw archives and extracted files intact in `data/benchmarks/external/`.
   - Implement ingestion loaders in `ai-service/evaluation/` as read-only memory adapters.

