import * as THREE from "three";

export function pickGroundHit(hits: THREE.Intersection[]): THREE.Intersection | null {
  for (const hit of hits) {
    if (!hit.face || !(hit.object instanceof THREE.Mesh)) {
      continue;
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (worldNormal.y > 0.35) {
      return hit;
    }
  }
  return null;
}

export function pickGroundHitNearHeight(
  hits: THREE.Intersection[],
  preferredY: number,
): THREE.Intersection | null {
  let best: THREE.Intersection | null = null;
  let bestHeightDelta = Number.POSITIVE_INFINITY;

  for (const hit of hits) {
    if (!hit.face || !(hit.object instanceof THREE.Mesh)) {
      continue;
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (worldNormal.y <= 0.35) {
      continue;
    }

    const heightDelta = Math.abs(hit.point.y - preferredY);
    if (heightDelta < bestHeightDelta) {
      bestHeightDelta = heightDelta;
      best = hit;
    }
  }

  return best ?? pickGroundHit(hits);
}

export function findStartMarker(root: THREE.Object3D, START_MARKER_NAMES: string[]): THREE.Object3D | null {
  let marker: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (marker) {
      return;
    }
    const name = obj.name.toLowerCase();
    if (START_MARKER_NAMES.some((token) => name.includes(token))) {
      marker = obj;
    }
  });
  return marker;
}

export function nameMatchesTokens(name: string, tokens: string[]): boolean {
  const lowered = name.toLowerCase();
  return tokens.some((token) => lowered.includes(token));
}
