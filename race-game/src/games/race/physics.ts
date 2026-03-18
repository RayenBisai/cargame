import * as THREE from "three";

export interface PhysicsConfig {
  accel: number;
  brake: number;
  drag: number;
  maxSpeed: number;
  steerRate: number;
  movementStepSize: number;
  positionLerpFactor: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  accel: 13,
  brake: 15,
  drag: 7,
  maxSpeed: 33,
  steerRate: 1.5,
  movementStepSize: 2.0,     // Balanced: smooth collisions without too much overhead
  positionLerpFactor: 0.85,  // Fluid motion
};

export function updateCarSpeed(
  speed: number,
  accelInput: number,
  brakeInput: number,
  dt: number,
  config: PhysicsConfig
): number {
  if (accelInput > 0) {
    speed += config.accel * dt;
  } else {
    speed -= config.drag * dt;
  }

  if (brakeInput > 0) {
    speed -= config.brake * dt;
  }

  return THREE.MathUtils.clamp(speed, 0, config.maxSpeed);
}

export function updateCarHeading(
  heading: number,
  steerInput: number,
  speed: number,
  dt: number,
  config: PhysicsConfig
): number {
  const speedRatio = THREE.MathUtils.clamp(speed / Math.max(config.maxSpeed, 0.001), 0, 1);
  const baseTurn = 0.2 + speedRatio;
  const lowSpeedGrip = THREE.MathUtils.lerp(1.22, 1.0, speedRatio);
  const highSpeedSlip = THREE.MathUtils.lerp(1.0, 0.88, THREE.MathUtils.smoothstep(speedRatio, 0.7, 1.0));

  return heading + steerInput * config.steerRate * dt * baseTurn * lowSpeedGrip * highSpeedSlip;
}

export function calculateVelocity(heading: number, speed: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(heading) * speed,
    0,
    Math.cos(heading) * speed,
  );
}
