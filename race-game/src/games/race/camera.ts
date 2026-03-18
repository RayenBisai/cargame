import * as THREE from "three";

const steerLagState = new WeakMap<THREE.Camera, number>();

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  playerPos: THREE.Vector3,
  heading: number,
  speed: number,
  maxSpeed: number,
  steerInput: number = 0,
  dt: number = 1 / 60
): void {
  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);

  const speedFactor = THREE.MathUtils.clamp(speed / Math.max(maxSpeed, 0.001), 0, 1);
  const steer = THREE.MathUtils.clamp(steerInput, -1, 1);
  const previousSteer = steerLagState.get(camera) ?? 0;
  const steerResponse = steer === 0 ? 8.5 : 4.2;
  const steerAlpha = 1 - Math.exp(-steerResponse * dt);
  let smoothSteer = THREE.MathUtils.lerp(previousSteer, steer, steerAlpha);
  if (speedFactor < 0.03 && Math.abs(steer) < 0.01) {
    const settleAlpha = 1 - Math.exp(-12 * dt);
    smoothSteer = THREE.MathUtils.lerp(smoothSteer, 0, settleAlpha);
  }
  steerLagState.set(camera, smoothSteer);
  const steerVisualFactor = THREE.MathUtils.smoothstep(speedFactor, 0.04, 0.3);
  const visualSteer = smoothSteer * steerVisualFactor;

  const camDistance = THREE.MathUtils.lerp(-3.15, -0.35, speedFactor);
  const camHeight = THREE.MathUtils.lerp(1.8, 1.8, speedFactor);
  const counterSteerOffset = -visualSteer * THREE.MathUtils.lerp(0.03, 0.45, speedFactor);

  const desiredPosition = playerPos
    .clone()
    .addScaledVector(forward, camDistance)
    .addScaledVector(right, counterSteerOffset)
    .add(new THREE.Vector3(0, camHeight, 0));

  const targetSideOffset = -visualSteer * THREE.MathUtils.lerp(0.02, 0.34, speedFactor);
  const desiredTarget = playerPos
    .clone()
    .addScaledVector(forward, THREE.MathUtils.lerp(5.5, 7.2, speedFactor))
    .addScaledVector(right, targetSideOffset)
    .add(new THREE.Vector3(0, 1.2, 0));

  const positionAlpha = 1 - Math.exp(-THREE.MathUtils.lerp(5.4, 7.5, speedFactor) * dt);
  const rotationAlpha = 1 - Math.exp(-THREE.MathUtils.lerp(6.2, 8.5, speedFactor) * dt);

  camera.position.lerp(desiredPosition, positionAlpha);

  const lookAtMatrix = new THREE.Matrix4().lookAt(camera.position, desiredTarget, camera.up);
  const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
  camera.quaternion.slerp(desiredQuat, rotationAlpha);
}
