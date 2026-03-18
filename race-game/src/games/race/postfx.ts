import * as THREE from "three";
import { BLUR_START_SPEED_FACTOR, BLUR_PEAK_AMOUNT } from "./gameConfig";

export const SpeedTunnelBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform vec2 center;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - center;
      float dist = length(dir);
      vec2 ndir = dist > 0.0001 ? normalize(dir) : vec2(0.0, 1.0);

      float edgeFactor = smoothstep(0.18, 1.08, dist);
      float blur = amount * edgeFactor;
      float stepSize = (0.010 + 0.030 * blur) * edgeFactor;

      vec4 base = texture2D(tDiffuse, vUv);
      vec4 accum = base * 0.22;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 1.0) * 0.20;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 2.0) * 0.17;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 3.0) * 0.14;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 4.0) * 0.11;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 5.0) * 0.09;
      accum += texture2D(tDiffuse, vUv - ndir * stepSize * 6.0) * 0.07;

      vec4 blurred = accum;
      float blend = clamp(blur * 1.08, 0.0, 0.82);
      gl_FragColor = vec4(mix(base.rgb, blurred.rgb, blend), base.a);
    }
  `,
};

export function updateSpeedBlurAmount(
  currentAmount: number,
  speed: number,
  maxSpeed: number,
  dt: number,
): number {
  const speedFactor = THREE.MathUtils.clamp(speed / maxSpeed, 0, 1);
  const normSpeed = THREE.MathUtils.clamp(
    (speedFactor - BLUR_START_SPEED_FACTOR) / (1 - BLUR_START_SPEED_FACTOR),
    0,
    1,
  );
  const shapedSpeed = normSpeed * normSpeed;
  const topEndBoost = Math.max(0, (speedFactor - 0.9) / 0.1);
  const blurTarget = THREE.MathUtils.clamp(
    (shapedSpeed + topEndBoost * 0.5) * BLUR_PEAK_AMOUNT,
    0,
    1,
  );
  const blurResponse = blurTarget > currentAmount
    ? 1 - Math.exp(-10.5 * dt)
    : 1 - Math.exp(-4.8 * dt);

  return THREE.MathUtils.lerp(currentAmount, blurTarget, blurResponse);
}
