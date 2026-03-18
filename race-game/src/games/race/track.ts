import * as THREE from "three";
import { TrackData } from "./types";

export const SAMPLE_COUNT = 700;

export function makeTrackData(): TrackData {
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(24, 0, -16),
    new THREE.Vector3(58, 0, -12),
    new THREE.Vector3(82, 0, 18),
    new THREE.Vector3(70, 0, 58),
    new THREE.Vector3(36, 0, 78),
    new THREE.Vector3(-6, 0, 66),
    new THREE.Vector3(-44, 0, 76),
    new THREE.Vector3(-78, 0, 48),
    new THREE.Vector3(-86, 0, 10),
    new THREE.Vector3(-66, 0, -28),
    new THREE.Vector3(-28, 0, -34),
  ];

  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.2);
  const samples: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const cumulativeLengths: number[] = [0];

  let totalLength = 0;
  let prevPoint = curve.getPointAt(0);
  let prevTangent = curve.getTangentAt(0).normalize();

  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    const t = i / SAMPLE_COUNT;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) {
      totalLength += point.distanceTo(prevPoint);
      cumulativeLengths.push(totalLength);

      if (tangent.dot(prevTangent) < 0) {
        tangent.multiplyScalar(-1);
      }
    }

    samples.push(point);
    tangents.push(tangent);
    normals.push(normal);
    prevPoint = point;
    prevTangent = tangent;
  }

  return {
    curve,
    samples,
    tangents,
    normals,
    cumulativeLengths,
    totalLength,
    roadHalfWidth: 7,
  };
}

export function nearestTrackIndex(track: TrackData, position: THREE.Vector3, hint: number): number {
  const count = SAMPLE_COUNT + 1;
  let best = hint;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (let offset = -26; offset <= 26; offset += 1) {
    const i = (hint + offset + count) % count;
    const p = track.samples[i];
    const dx = position.x - p.x;
    const dz = position.z - p.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = i;
    }
  }

  return best;
}
