/**
 * Compatibility exports for callers of the former static road-corridor module.
 * This module intentionally contains no bundled camera coordinates or routes.
 * Route geometry must come from observed camera metadata or an authorized router.
 */
export type Coordinate = [number, number];

export const UP14_CAMERA_NODES: Record<string, Coordinate> = {};
export const CAMERA_PAIR_PATHS: Record<string, Coordinate[]> = {};

export function findCameraSequence(_startCam: string, _endCam: string): string[] | null {
  return null;
}

export function buildRoadPathFromSequence(_cameraSequence: string[]): Coordinate[] {
  return [];
}

export function findNearestUp14Camera(
  _coord: Coordinate,
  _maxDistanceDeg = 0.015,
): string | null {
  return null;
}

export function getRoadRouteBetweenPoints(
  _p1: Coordinate,
  _p2: Coordinate,
  _cam1Id?: string | null,
  _cam2Id?: string | null,
): Coordinate[] | null {
  return null;
}

export function getHardcodedRoute(
  _coordinates: Coordinate[],
  _cameraIds?: string[],
): Coordinate[] {
  return [];
}

