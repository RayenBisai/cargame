import * as THREE from "three";

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  playerPos: THREE.Vector3,
  heading: number,
  speed: number,
  maxSpeed: number,
  cameraLerpFactor: number = 0.28
): void {
  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  
  const speedFactor = speed / maxSpeed;
  const camDistance = THREE.MathUtils.lerp(-3.0, -5.5, speedFactor);
  
  const camBack = playerPos
    .clone()
    .addScaledVector(forward, camDistance)
    .add(new THREE.Vector3(0, 2.8, 0));
  
  const camTarget = playerPos
    .clone()
    .addScaledVector(forward, 6)
    .add(new THREE.Vector3(0, 1.2, 0));
  
  camera.position.lerp(camBack, cameraLerpFactor);
  camera.lookAt(camTarget);
}
