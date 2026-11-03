# Dataset Specifications & Leakage-Safe Evaluation Architecture
## SIH26127 Traffic Intelligence & Vehicle Investigation Platform

---

## 1. Public Surveillance & ANPR Datasets Survey

### 1.1 CCPD (Chinese City Parking Dataset)
- **Origin & Curation:** CUHK & Megvii (ECCV 2018).
- **Volume:** >250,000 unique high-resolution images (>720p).
- **Variations:** CCPD-Base, CCPD-FN (night & low-light), CCPD-DB (blur/motion), CCPD-Weather (rain, snow, fog), CCPD-Challenge.
- **Annotations:** 4-point polygon vertices, bounding box, horizontal/vertical tilt angles, license plate string.
- **License:** Non-commercial academic research license.
- **Surveillance Applicability:** High utility for vehicle license plate detection and polygon localization; poor direct character recognition fit for Indian plates due to Chinese provincial ideograms.

### 1.2 UFPR-ALPR Dataset
- **Origin & Curation:** Federal University of Paraná (UFPR), Brazil.
- **Volume:** 4,500 video tracks from 30 FPS cameras, 150 vehicles, 10,800 total frames.
- **Annotations:** Full vehicle and license plate bounding boxes, character bounding boxes, normalized plate text.
- **License:** Open for academic non-commercial research.
- **Surveillance Applicability:** High utility for temporal multi-frame fusion, character recognition under real motion blur, and tracker association.

### 1.3 VeRi-776
- **Origin & Curation:** Beihang University & PKU.
- **Volume:** 776 vehicles, 20 CCTV cameras, 50,000 tracklets, spanning 1.0 km² urban traffic area.
- **Annotations:** Unique vehicle ID, camera ID, timestamp, GPS camera coordinate, vehicle type, vehicle color, visual bounding boxes.
- **License:** Academic research use on written application.
- **Surveillance Applicability:** Gold standard for urban CCTV vehicle Re-ID, cross-camera trajectory reconstruction, and camera topology modeling.

### 1.4 VehicleID
- **Origin & Curation:** Peking University (CVPR 2016).
- **Volume:** 26,267 vehicles, 221,763 surveillance images captured across daytime city checkpoints.
- **Annotations:** Unique vehicle ID and fine-grained vehicle model/make labels.
- **License:** Research license (PKU-NELVT).
- **Surveillance Applicability:** High utility for training deep metric learning feature representations (ResNet50 / OSNet) for vehicle appearance matching.

### 1.5 UA-DETRAC
- **Origin & Curation:** University at Albany, SUNY (AVSS 2015).
- **Volume:** 100 video sequences (140,000 frames), 8,250 vehicles, 1.21 million bounding boxes.
- **Variations:** Sunny, cloudy, rainy, night-time conditions.
- **Annotations:** Bounding boxes, occlusion status (no occlusion, partial occlusion, heavy occlusion), vehicle category (car, bus, van, other).
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0).
- **Surveillance Applicability:** Gold standard benchmark for ByteTrack / Kalman tracking, vehicle detector precision/recall, and adverse weather robustness.

### 1.6 Indian ALPR & Registration Standards (CMVR Rule 50 & MoRTH)
- **High Security Registration Plate (HSRP) Standards:**
  - Standard Private: Reflective white background, embossed black alphanumerics.
  - Commercial / Transport: Reflective yellow background, black alphanumerics.
  - Electric Vehicles (EV): Reflective green background, white alphanumerics (private) or yellow (commercial).
  - Self-Drive / Rental: Black background, yellow alphanumerics.
  - Bharat Series (`BH` series - MoRTH GSR 594(E)): Format `YY BH #### XX` where `YY` is the 2-digit registration year, `BH` code, 4 digits (`0001` - `9999`), and 2 letters (`AA` to `ZZ`).
  - Standard 36 State / UT Codes:
    - States: `AP`, `AR`, `AS`, `BR`, `CG`, `GA`, `GJ`, `HR`, `HP`, `JH`, `KA`, `KL`, `MP`, `MH`, `MN`, `ML`, `MZ`, `NL`, `OD`, `PB`, `RJ`, `SK`, `TN`, `TS`, `TR`, `UP`, `UK`, `WB`.
    - Union Territories: `AN`, `CH`, `DN`, `DD`, `DL`, `JK`, `LA`, `LD`, `PY`.

---

## 2. Train / Validation / Test Leakage-Safe Separation Policy

To guarantee rigorous evaluation without data leakage:

1. **Tracklet & Temporal Independence:**
   - Sequential video frames from the same vehicle transit MUST NOT be split across train and test sets.
   - All frames belonging to a single tracklet or transit are assigned exclusively to a single split (Train, Val, or Test).

2. **Identity-Disjoint Re-ID Split:**
   - In vehicle Re-ID evaluation, probe and gallery vehicle IDs must be completely disjoint from any vehicle IDs used in metric learning or feature representation training.
   - Zero ID overlap between train and evaluation partitions.

3. **Camera-Level Cross-Validation:**
   - Cameras CAM-01 through CAM-08 are used for reference calibration; CAM-09 through CAM-11 are reserved for blind cross-camera verification.
   - For trajectory evaluation, multi-hop journeys are tested on independent camera topologies.

4. **Adverse Weather Separation:**
   - Ground truth clear-weather crops are segregated from synthetic/real hazy crops (`data/dataset_samples/hazy`).
   - Dehazing parameter tuning must be evaluated on unseen hazy test pairs.
