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
  accel: 16,
  brake: 32,
  drag: 7,
  maxSpeed: 38,
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
  return heading + steerInput * config.steerRate * dt * (0.25 + speed / config.maxSpeed);
}

export function calculateVelocity(heading: number, speed: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(heading) * speed,
    0,
    Math.cos(heading) * speed,
  );
}
