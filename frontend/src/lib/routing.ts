/**
 * Routing estimate between persisted camera observations.
 * OSRM provides a plausible road-network connection; this is not proof of
 * the vehicle's actual path between two sightings.
 */

const routeCache = new Map<string, [number, number][]>();

function haversineDist(pt1: [number, number], pt2: [number, number]): number {
  const R = 6371; // km
  const dLat = ((pt2[1] - pt1[1]) * Math.PI) / 180;
  const dLng = ((pt2[0] - pt1[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pt1[1] * Math.PI) / 180) *
      Math.cos((pt2[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch a candidate driving route between GPS waypoints [longitude, latitude].
 * Returns an empty array when routing cannot be verified; never fabricates a fallback path.
 */
export async function fetchRoadRoute(
  waypoints: [number, number][],
): Promise<[number, number][]> {
  // Deduplicate consecutive identical coordinates
  const cleanWaypoints: [number, number][] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const curr = waypoints[i];
    const prev = cleanWaypoints[cleanWaypoints.length - 1];
    if (!prev || prev[0] !== curr[0] || prev[1] !== curr[1]) {
      cleanWaypoints.push(curr);
    }
  }
  if (cleanWaypoints.length < 2) return cleanWaypoints;

  const cacheKey = cleanWaypoints.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
  const cached = routeCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  // Calculate direct straight-line distance across waypoints
  let directDist = 0;
  for (let i = 0; i < cleanWaypoints.length - 1; i++) {
    directDist += haversineDist(cleanWaypoints[i], cleanWaypoints[i + 1]);
  }

  // Build OSRM query string: lng,lat;lng,lat;...
  const coordsParam = cleanWaypoints.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(osrmUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const data = await response.json();
      if (
        data.code === "Ok" &&
        Array.isArray(data.routes) &&
        data.routes.length > 0 &&
        data.routes[0].geometry?.coordinates
      ) {
        const roadCoords: [number, number][] = data.routes[0].geometry.coordinates;

        // Calculate OSRM route total distance
        let osrmDist = 0;
        for (let i = 0; i < roadCoords.length - 1; i++) {
          osrmDist += haversineDist(roadCoords[i], roadCoords[i + 1]);
        }

        // Only accept OSRM route if it stays within 2.5x of direct waypoint distance
        if (roadCoords.length >= 2 && (directDist < 0.5 || osrmDist <= directDist * 2.5)) {
          routeCache.set(cacheKey, roadCoords);
          return roadCoords;
        }
      }
    }
  } catch (err) {
    console.warn("OSRM road-routing estimate unavailable; no route line will be displayed:", err);
  } finally {
    clearTimeout(timeoutId);
  }

  return [];
}
