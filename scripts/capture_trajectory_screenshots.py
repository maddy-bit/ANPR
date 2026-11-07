import time
from playwright.sync_api import sync_playwright

def capture_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1050})
        page = context.new_page()

        print("[Screenshot 1] Capturing trajectory dashboard with real backend identity...")
        page.goto("http://localhost:3000/trajectory")
        page.wait_for_selector("[data-testid='dimension-identityMembership']", timeout=20000)
        time.sleep(2) # Give MapLibre GL a moment to render tiles
        page.screenshot(path="data/screenshots/01_trajectory_dashboard_real_identity.png", full_page=True)
        print("  -> Saved data/screenshots/01_trajectory_dashboard_real_identity.png")

        print("[Screenshot 2] Capturing quality panel with all six dimensions...")
        # Focus on the Quality Panel container
        quality_container = page.locator("[data-testid='dimension-identityMembership']").locator("xpath=ancestor::div[contains(@class, 'rounded-md border border-slate-300')]")
        if quality_container.count() > 0:
            quality_container.first.screenshot(path="data/screenshots/03_quality_panel_six_dimensions.png")
        else:
            page.screenshot(path="data/screenshots/03_quality_panel_six_dimensions.png")
        print("  -> Saved data/screenshots/03_quality_panel_six_dimensions.png")

        # Controlled fixture for Verified & Unverified Transitions
        print("[Screenshot 3] Capturing map showing verified road edge and unverified geodesic (Controlled Fixture)...")
        def route_dual_transition(route):
            url = route.request.url
            if "/trajectory/quality" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='''{
                        "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                        "label": "GLOBAL-VEH-CONTROLLED-DUAL-EDGE",
                        "overallQuality": "HIGH_CONFIDENCE",
                        "summary": "[Controlled Fixture] Multi-camera trajectory with verified road edge and unverified geodesic corridor.",
                        "isCrossCameraConfirmed": true,
                        "hasImpossibleTransitions": false,
                        "hasContradictions": false,
                        "counts": {
                            "totalObservations": 3, "confirmedObservations": 3, "uncertainObservations": 0, "excludedObservations": 0,
                            "distinctCameraCount": 3, "totalTransitions": 2, "feasibleTransitions": 2, "impossibleTransitions": 0,
                            "unknownFeasibilityTransitions": 0, "verifiedRoadTransitions": 1, "unverifiedGeodesicTransitions": 1, "sameCameraTransitions": 0
                        },
                        "dimensions": {
                            "identityMembership": { "status": "CONFIRMED", "confirmedCount": 3, "excludedCount": 0, "reviewStatusesSeen": ["CONFIRMED_BY_USER"], "summary": "All 3 observations confirmed." },
                            "detectionConfidence": { "status": "HIGH", "minConfidence": 0.92, "avgConfidence": 0.94, "maxConfidence": 0.96, "lowConfidenceCount": 0, "summary": "High detection confidence." },
                            "ocrAndPlateConsistency": { "status": "CONSISTENT", "platesSeen": ["MH12DE1001"], "minPlateConfidence": 0.92, "avgPlateConfidence": 0.92, "summary": "Consistent plate MH12DE1001." },
                            "reidSimilarity": { "status": "HIGH_SIMILARITY", "isAvailable": true, "minScore": 0.95, "avgScore": 0.95, "maxScore": 0.95, "modelName": "fastreid_veri_sbs_r50_ibn", "summary": "High Re-ID similarity." },
                            "spatialTemporalFeasibility": { "status": "VERIFIED_ROAD_NETWORK", "distinctCameras": 3, "verifiedRoadEdges": 1, "unverifiedGeodesics": 1, "sameCameraTransitions": 0, "impossibleTransitions": 0, "unknownTransitions": 0, "summary": "1 verified road edge and 1 unverified geodesic corridor." },
                            "evidenceCompleteness": { "status": "COMPLETE", "missingTimestampsCount": 0, "missingCoordinatesCount": 0, "missingReidCount": 0, "missingPlateCount": 0, "summary": "All telemetry complete." }
                        },
                        "supportingEvidence": ["[Controlled Fixture] Verified road edge and geodesic corridor"],
                        "missingEvidence": [],
                        "warningsAndContradictions": []
                    }'''
                )
            elif "/trajectory" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='''{
                        "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                        "label": "GLOBAL-VEH-CONTROLLED-DUAL-EDGE",
                        "primaryPlate": "MH12DE1001",
                        "vehicleClass": "car",
                        "reviewStatus": "ACTIVE",
                        "totalObservations": 3,
                        "confirmedObservations": 3,
                        "excludedObservations": 0,
                        "segmentCount": 1,
                        "hasImpossibleTransitions": false,
                        "hasUnknownFeasibility": false,
                        "totalFeasibleDistanceKm": 3.3,
                        "totalDurationSeconds": 360.0,
                        "firstSeenTimestamp": "2026-11-04T14:00:00Z",
                        "lastSeenTimestamp": "2026-11-04T14:06:00Z",
                        "observations": [
                            {
                                "detectionId": 53, "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                                "cameraId": "CAM-01", "cameraName": "Shivajinagar Chowk",
                                "timestamp": "2026-11-04T14:00:00Z", "latitude": 18.5308, "longitude": 73.8474,
                                "hasCoordinates": true, "direction": "SE", "speedKmh": null, "vehicleClass": "car",
                                "detectionConfidence": 0.95, "plateText": "MH12DE1001", "plateConfidence": 0.92,
                                "reidConfidence": 0.94, "imagePath": "crop.jpg", "trackId": 101, "frameNumber": 75,
                                "provenance": { "associationId": "69e667e2-1cfb-49cf-8e34-5235f11ed3d1", "associationDecision": "MATCH", "associationReviewStatus": "CONFIRMED_BY_USER", "reidScore": 1.0, "plateScore": null, "isSeedObservation": true }
                            },
                            {
                                "detectionId": 54, "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                                "cameraId": "CAM-02", "cameraName": "FC Road Junction",
                                "timestamp": "2026-11-04T14:02:00Z", "latitude": 18.5236, "longitude": 73.8478,
                                "hasCoordinates": true, "direction": "S", "speedKmh": null, "vehicleClass": "car",
                                "detectionConfidence": 0.94, "plateText": "MH12DE1001", "plateConfidence": 0.90,
                                "reidConfidence": 0.93, "imagePath": "crop.jpg", "trackId": 102, "frameNumber": 75,
                                "provenance": { "associationId": "d8e321eb-130c-454d-9913-866d629af19d", "associationDecision": "MATCH", "associationReviewStatus": "SYSTEM_DECIDED", "reidScore": 0.96, "plateScore": 0.946, "isSeedObservation": false }
                            },
                            {
                                "detectionId": 55, "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                                "cameraId": "CAM-03", "cameraName": "JM Road - Deccan Gymkhana",
                                "timestamp": "2026-11-04T14:06:00Z", "latitude": 18.5158, "longitude": 73.8412,
                                "hasCoordinates": true, "direction": "SW", "speedKmh": null, "vehicleClass": "car",
                                "detectionConfidence": 0.93, "plateText": "MH12DE1001", "plateConfidence": 0.91,
                                "reidConfidence": 0.92, "imagePath": "crop.jpg", "trackId": 103, "frameNumber": 75,
                                "provenance": { "associationId": "69e667e2-1cfb-49cf-8e34-5235f11ed3d1", "associationDecision": "MATCH", "associationReviewStatus": "CONFIRMED_BY_USER", "reidScore": 0.94, "plateScore": null, "isSeedObservation": false }
                            }
                        ],
                        "transitions": [
                            {
                                "fromDetectionId": 53, "toDetectionId": 54, "fromCameraId": "CAM-01", "toCameraId": "CAM-02",
                                "fromTimestamp": "2026-11-04T14:00:00Z", "toTimestamp": "2026-11-04T14:02:00Z",
                                "deltaSeconds": 120.0, "distanceKm": 1.2, "distanceMethod": "VERIFIED_ROAD_NETWORK",
                                "connectivity": "VERIFIED_ROAD_EDGE", "isVerifiedTopology": true, "apparentSpeedKmh": 36.0,
                                "status": "FEASIBLE", "reason": "Feasible transit via verified road edge (1.20 km in 120.0s, speed=36.0 km/h)"
                            },
                            {
                                "fromDetectionId": 54, "toDetectionId": 55, "fromCameraId": "CAM-02", "toCameraId": "CAM-03",
                                "fromTimestamp": "2026-11-04T14:02:00Z", "toTimestamp": "2026-11-04T14:06:00Z",
                                "deltaSeconds": 240.0, "distanceKm": 2.1, "distanceMethod": "POSTGIS_GEODESIC_SPHERE",
                                "connectivity": "UNVERIFIED_GEODESIC", "isVerifiedTopology": false, "apparentSpeedKmh": 31.5,
                                "status": "FEASIBLE", "reason": "Feasible straight-line transit (2.10 km in 240.0s, apparent speed=31.5 km/h); road topology unverified."
                            }
                        ],
                        "segments": []
                    }'''
                )
            else:
                route.continue_()

        page.route("**/api/identities/71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595*", route_dual_transition)
        page.reload()
        page.wait_for_selector("[data-testid='dimension-identityMembership']", timeout=20000)
        time.sleep(2)
        # Screenshot the Map component
        map_box = page.locator(".lg\\:col-span-7")
        if map_box.count() > 0:
            map_box.first.screenshot(path="data/screenshots/02_map_verified_and_unverified_transitions.png")
        else:
            page.screenshot(path="data/screenshots/02_map_verified_and_unverified_transitions.png", full_page=True)
        print("  -> Saved data/screenshots/02_map_verified_and_unverified_transitions.png")

        # Controlled fixture for Impossible Transition in Timeline
        print("[Screenshot 4] Capturing timeline containing impossible transition (Controlled Fixture)...")
        def route_impossible(route):
            url = route.request.url
            if "/trajectory/quality" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='''{
                        "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                        "label": "GLOBAL-VEH-IMPOSSIBLE-TEST",
                        "overallQuality": "LOW_CONFIDENCE",
                        "summary": "[Controlled Test Fixture] Trajectory contains 1 impossible transition violating physical speed threshold.",
                        "isCrossCameraConfirmed": true,
                        "hasImpossibleTransitions": true,
                        "hasContradictions": true,
                        "counts": {
                            "totalObservations": 2, "confirmedObservations": 2, "uncertainObservations": 0, "excludedObservations": 0,
                            "distinctCameraCount": 2, "totalTransitions": 1, "feasibleTransitions": 0, "impossibleTransitions": 1,
                            "unknownFeasibilityTransitions": 0, "verifiedRoadTransitions": 0, "unverifiedGeodesicTransitions": 1, "sameCameraTransitions": 0
                        },
                        "dimensions": {
                            "identityMembership": { "status": "CONFIRMED", "confirmedCount": 2, "excludedCount": 0, "reviewStatusesSeen": ["CONFIRMED_BY_USER"], "summary": "Confirmed." },
                            "detectionConfidence": { "status": "HIGH", "minConfidence": 0.95, "avgConfidence": 0.95, "maxConfidence": 0.95, "lowConfidenceCount": 0, "summary": "High." },
                            "ocrAndPlateConsistency": { "status": "CONSISTENT", "platesSeen": ["MH12DE1001"], "minPlateConfidence": 0.9, "avgPlateConfidence": 0.9, "summary": "Consistent." },
                            "reidSimilarity": { "status": "HIGH_SIMILARITY", "isAvailable": true, "minScore": 0.98, "avgScore": 0.98, "maxScore": 0.98, "modelName": "fastreid_veri_sbs_r50_ibn", "summary": "High." },
                            "spatialTemporalFeasibility": { "status": "CONTAINS_IMPOSSIBLE_TRANSITIONS", "distinctCameras": 2, "verifiedRoadEdges": 0, "unverifiedGeodesics": 1, "sameCameraTransitions": 0, "impossibleTransitions": 1, "unknownTransitions": 0, "summary": "Physical speed constraint violated (apparent speed=1800 km/h)." },
                            "evidenceCompleteness": { "status": "COMPLETE", "missingTimestampsCount": 0, "missingCoordinatesCount": 0, "missingReidCount": 0, "missingPlateCount": 0, "summary": "Complete." }
                        },
                        "supportingEvidence": [],
                        "missingEvidence": [],
                        "warningsAndContradictions": [
                            "Apparent straight-line speed (1800.0 km/h) exceeds physical threshold (180.0 km/h) over 2.50 km in 5.0s"
                        ]
                    }'''
                )
            elif "/trajectory" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='''{
                        "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                        "label": "GLOBAL-VEH-IMPOSSIBLE-TEST",
                        "primaryPlate": "MH12DE1001",
                        "vehicleClass": "car",
                        "reviewStatus": "ACTIVE",
                        "totalObservations": 2,
                        "confirmedObservations": 2,
                        "excludedObservations": 0,
                        "segmentCount": 0,
                        "hasImpossibleTransitions": true,
                        "hasUnknownFeasibility": false,
                        "totalFeasibleDistanceKm": 0.0,
                        "totalDurationSeconds": 5.0,
                        "firstSeenTimestamp": "2026-11-04T14:00:00Z",
                        "lastSeenTimestamp": "2026-11-04T14:00:05Z",
                        "observations": [
                            {
                                "detectionId": 101, "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                                "cameraId": "CAM-01", "cameraName": "Shivajinagar Chowk",
                                "timestamp": "2026-11-04T14:00:00Z", "latitude": 18.5308, "longitude": 73.8474,
                                "hasCoordinates": true, "direction": "SE", "speedKmh": null, "vehicleClass": "car",
                                "detectionConfidence": 0.95, "plateText": "MH12DE1001", "plateConfidence": 0.92,
                                "reidConfidence": 0.94, "imagePath": "crop.jpg", "trackId": 101, "frameNumber": 75,
                                "provenance": { "associationId": "69e667e2-1cfb-49cf-8e34-5235f11ed3d1", "associationDecision": "MATCH", "associationReviewStatus": "CONFIRMED_BY_USER", "reidScore": 1.0, "plateScore": null, "isSeedObservation": true }
                            },
                            {
                                "detectionId": 102, "globalIdentityId": "71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595",
                                "cameraId": "CAM-02", "cameraName": "FC Road Junction",
                                "timestamp": "2026-11-04T14:00:05Z", "latitude": 18.5236, "longitude": 73.8478,
                                "hasCoordinates": true, "direction": "S", "speedKmh": null, "vehicleClass": "car",
                                "detectionConfidence": 0.95, "plateText": "MH12DE1001", "plateConfidence": 0.92,
                                "reidConfidence": 0.94, "imagePath": "crop.jpg", "trackId": 102, "frameNumber": 75,
                                "provenance": { "associationId": "d8e321eb-130c-454d-9913-866d629af19d", "associationDecision": "MATCH", "associationReviewStatus": "SYSTEM_DECIDED", "reidScore": 0.98, "plateScore": 0.946, "isSeedObservation": false }
                            }
                        ],
                        "transitions": [
                            {
                                "fromDetectionId": 101, "toDetectionId": 102, "fromCameraId": "CAM-01", "toCameraId": "CAM-02",
                                "fromTimestamp": "2026-11-04T14:00:00Z", "toTimestamp": "2026-11-04T14:00:05Z",
                                "deltaSeconds": 5.0, "distanceKm": 2.5, "distanceMethod": "POSTGIS_GEODESIC_SPHERE",
                                "connectivity": "UNVERIFIED_GEODESIC", "isVerifiedTopology": false, "apparentSpeedKmh": 1800.0,
                                "status": "IMPOSSIBLE", "reason": "Apparent straight-line speed (1800.0 km/h) exceeds physical threshold (180.0 km/h) over 2.50 km in 5.0s; unverified geodesic transition."
                            }
                        ],
                        "segments": []
                    }'''
                )
            else:
                route.continue_()

        page.unroute("**/api/identities/71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595*")
        page.route("**/api/identities/71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595*", route_impossible)
        page.reload()
        page.wait_for_selector("text=IMPOSSIBLE", timeout=20000)
        time.sleep(2)
        # Scroll to timeline and screenshot
        timeline = page.locator("text=Chronological Multi-Camera Timeline").locator("xpath=ancestor::div[contains(@class, 'rounded-md border border-slate-300')]")
        if timeline.count() > 0:
            timeline.first.screenshot(path="data/screenshots/04_timeline_impossible_transition.png")
        else:
            page.screenshot(path="data/screenshots/04_timeline_impossible_transition.png", full_page=True)
        print("  -> Saved data/screenshots/04_timeline_impossible_transition.png")

        # Empty / Error State
        print("[Screenshot 5] Capturing empty / error state...")
        page.unroute("**/api/identities/71d7ad84-a5e6-48f4-bff9-6b5f6d6b9595*")
        def route_not_found(route):
            route.fulfill(
                status=404,
                content_type="application/json",
                body='{"error": "NOT_FOUND", "message": "No global vehicle identity found matching: NONEXISTENT-VEHICLE", "timestamp": "2026-11-04T16:00:00Z"}'
            )
        page.route("**/api/identities/search*", route_not_found)
        search_input = page.locator("input[placeholder*='Search identity']")
        if search_input.count() > 0:
            search_input.fill("NONEXISTENT-VEHICLE")
            search_input.press("Enter")
            time.sleep(2)
        page.screenshot(path="data/screenshots/05_empty_or_error_state.png", full_page=True)
        print("  -> Saved data/screenshots/05_empty_or_error_state.png")

        browser.close()
        print("\nAll 5 visual verification screenshots captured successfully!")

if __name__ == "__main__":
    capture_screenshots()
