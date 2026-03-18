"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RaceStatus } from "./types";
import { makeTrackData, nearestTrackIndex, SAMPLE_COUNT } from "./track";
import { pickGroundHitNearHeight, findStartMarker, nameMatchesTokens } from "./collision";
import { DEFAULT_PHYSICS, updateCarSpeed, updateCarHeading, calculateVelocity } from "./physics";
import { updateCamera } from "./camera";
import {
  RACE_SECONDS,
  TOTAL_LAPS,
  MAX_DRIVE_SPEED,
  DISPLAY_TOP_SPEED,
  DISPLAY_SPEED_RESPONSE,
  TRACK_MODEL_FILE,
  DECOR_TRACK_MODEL_FILE,
  SPAWN_MARKER_MODEL_FILE,
  CAR_MODEL_FILE,
  CAR_FORWARD_OFFSET_Y,
  MAP_SCALE_MULTIPLIER,
  MAP_OFFSET_X,
  MAP_OFFSET_Z,
  CAR_RIDE_HEIGHT,
  CAR_SCALE_MULTIPLIER,
  START_MARKER_NAMES,
  ROAD_MESH_NAMES,
  WALL_SLOWDOWN_RATE,
  MIN_STEER_SPEED,
  LAP_DISTANCE_THRESHOLD_FACTOR,
} from "./gameConfig";
import { createInitialGameState, RuntimeGameState } from "./gameState";
import { SpeedTunnelBlurShader, updateSpeedBlurAmount } from "./postfx";

function shouldUseGroundMesh(mesh: THREE.Mesh): boolean {
  return nameMatchesTokens(mesh.name, ROAD_MESH_NAMES);
}

export default function RaceGame() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<RaceStatus>("ready");
  const [resetToken, setResetToken] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RACE_SECONDS);
  const [lap, setLap] = useState(1);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);

  const gameRef = useRef<RuntimeGameState>(createInitialGameState(new THREE.Vector3(), 0));
  const mapReadyRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    scene.fog = new THREE.Fog(0x87ceeb, 38, 210);
    let isDisposed = false;

    const camera = new THREE.PerspectiveCamera(
      72,
      mount.clientWidth / mount.clientHeight,
      0.1,
      600,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.setSize(mount.clientWidth, mount.clientHeight);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const speedBlurPass = new ShaderPass(SpeedTunnelBlurShader);
    speedBlurPass.uniforms.amount.value = 0;
    composer.addPass(speedBlurPass);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8866ff, 0.6);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(18, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    scene.add(sun);

    const track = makeTrackData();
    const startPoint = track.samples[0].clone();
    const startTangent = track.tangents[0];
    const trackBounds = new THREE.Box3();
    for (const point of track.samples) {
      trackBounds.expandByPoint(point);
    }
    const trackCenter = new THREE.Vector3();
    const trackSize = new THREE.Vector3();
    trackBounds.getCenter(trackCenter);
    trackBounds.getSize(trackSize);

    const kart = new THREE.Group();
    kart.position.set(0, CAR_RIDE_HEIGHT, 0);
    scene.add(kart);

    const gltfLoader = new GLTFLoader();
    const mapGroundMeshes: THREE.Mesh[] = [];
    const allMapMeshes: THREE.Mesh[] = [];
    const groundRaycaster = new THREE.Raycaster();
    const downOrigin = new THREE.Vector3();
    const downDirection = new THREE.Vector3(0, -1, 0);
    let carHalfWidth = 0.7;
    let carHalfLength = 1.15;
    mapReadyRef.current = false;

    const getRoadHitPoint = (basePosition: THREE.Vector3): THREE.Vector3 | null => {
      if (mapGroundMeshes.length === 0) {
        return null;
      }

      downOrigin.copy(basePosition).setY(basePosition.y + 60);
      groundRaycaster.set(downOrigin, downDirection);
      groundRaycaster.far = 160;
      const groundHits = groundRaycaster.intersectObjects(mapGroundMeshes, false);
      const groundHit = pickGroundHitNearHeight(groundHits, basePosition.y);
      if (groundHit) {
        return groundHit.point.clone();
      }

      return null;
    };

    const canOccupyRoad = (basePosition: THREE.Vector3, heading: number): THREE.Vector3 | null => {
      const centerHit = getRoadHitPoint(basePosition);
      if (!centerHit) {
        return null;
      }

      const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      const probeOffsets = [
        new THREE.Vector3(),
        right.clone().multiplyScalar(carHalfWidth),
        right.clone().multiplyScalar(-carHalfWidth),
        forward.clone().multiplyScalar(carHalfLength),
        forward.clone().multiplyScalar(-carHalfLength),
        forward.clone().multiplyScalar(carHalfLength).add(right.clone().multiplyScalar(carHalfWidth)),
        forward.clone().multiplyScalar(carHalfLength).add(right.clone().multiplyScalar(-carHalfWidth)),
        forward
          .clone()
          .multiplyScalar(-carHalfLength)
          .add(right.clone().multiplyScalar(carHalfWidth)),
        forward
          .clone()
          .multiplyScalar(-carHalfLength)
          .add(right.clone().multiplyScalar(-carHalfWidth)),
      ];

      for (const offset of probeOffsets) {
        const probePosition = basePosition.clone().add(offset);
        const probeHit = getRoadHitPoint(probePosition);
        if (!probeHit) {
          return null;
        }
        if (Math.abs(probeHit.y - centerHit.y) > 0.9) {
          return null;
        }
      }

      return centerHit;
    };

    const resolveSpawnOnRoad = (
      fallbackPosition: THREE.Vector3,
      markerPosition?: THREE.Vector3,
    ): THREE.Vector3 => {
      const candidates: THREE.Vector3[] = [];
      if (markerPosition) {
        candidates.push(markerPosition.clone());
      }
      candidates.push(fallbackPosition.clone());

      for (const mesh of mapGroundMeshes) {
        const meshPos = new THREE.Vector3();
        mesh.getWorldPosition(meshPos);
        candidates.push(meshPos);
      }

      for (const candidate of candidates) {
        const hit = getRoadHitPoint(candidate);
        if (hit || mapGroundMeshes.length === 0) {
          return hit ?? candidate;
        }
      }

      return fallbackPosition.clone();
    };

    gltfLoader.load(
      TRACK_MODEL_FILE,
      (gltf) => {
        if (isDisposed) {
          return;
        }
        const mapRoot = gltf.scene;
        mapRoot.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = false;
            obj.receiveShadow = true;
          }
        });

        const mapBounds = new THREE.Box3().setFromObject(mapRoot);
        const mapSize = new THREE.Vector3();
        mapBounds.getSize(mapSize);
        const mapSpan = Math.max(mapSize.x, mapSize.z, 0.001);
        const trackSpan = Math.max(trackSize.x, trackSize.z, 0.001);
        const mapScale = (trackSpan / mapSpan) * MAP_SCALE_MULTIPLIER;
        mapRoot.scale.setScalar(mapScale);

        mapBounds.setFromObject(mapRoot);
        const mapCenter = new THREE.Vector3();
        mapBounds.getCenter(mapCenter);
        mapRoot.position.set(
          trackCenter.x - mapCenter.x + MAP_OFFSET_X,
          -mapBounds.min.y,
          trackCenter.z - mapCenter.z + MAP_OFFSET_Z,
        );

        mapRoot.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) {
            return;
          }
          allMapMeshes.push(obj);
          if (shouldUseGroundMesh(obj)) {
            mapGroundMeshes.push(obj);
          }
        });

        if (mapGroundMeshes.length === 0) {
          mapGroundMeshes.push(...allMapMeshes);
        }

        scene.add(mapRoot);

        // Visual-only overlay: racetrack model for appearance, not collision.
        gltfLoader.load(
          DECOR_TRACK_MODEL_FILE,
          (decorGltf) => {
            if (isDisposed) {
              return;
            }

            const decorRoot = decorGltf.scene;
            decorRoot.traverse((obj) => {
              if (obj instanceof THREE.Mesh) {
                obj.castShadow = false;
                obj.receiveShadow = true;
              }
            });

            decorRoot.scale.copy(mapRoot.scale);
            decorRoot.position.copy(mapRoot.position);
            decorRoot.position.y += 0.02;
            scene.add(decorRoot);
          },
          undefined,
          () => {},
        );

        let spawnPos = startPoint.clone();
        let spawnHeading = Math.atan2(startTangent.x, startTangent.z);
        let markerPosForSnap: THREE.Vector3 | undefined;

        const applySpawnFromRoot = (root: THREE.Object3D): boolean => {
          const startMarker = findStartMarker(root, START_MARKER_NAMES);
          if (!startMarker) {
            return false;
          }

          const markerPos = new THREE.Vector3();
          const markerRot = new THREE.Quaternion();
          const markerForward = new THREE.Vector3();
          startMarker.getWorldPosition(markerPos);
          startMarker.getWorldQuaternion(markerRot);
          markerForward.set(0, 0, 1).applyQuaternion(markerRot);
          const markerHeading = Math.atan2(markerForward.x, markerForward.z);
          spawnPos = markerPos;
          markerPosForSnap = markerPos.clone();
          spawnHeading = markerHeading;
          return true;
        };

        const finalizeSpawn = () => {
          const resolvedSpawnPos = resolveSpawnOnRoad(spawnPos, markerPosForSnap);
          const spawnTrackIndex = nearestTrackIndex(track, resolvedSpawnPos, 0);
          const spawnTangent = track.tangents[spawnTrackIndex];
          const trackHeading = Math.atan2(spawnTangent.x, spawnTangent.z);
          spawnHeading = trackHeading + Math.PI;
          const headingForward = new THREE.Vector3(Math.sin(spawnHeading), 0, Math.cos(spawnHeading));
          const tangentForward = new THREE.Vector3(spawnTangent.x, 0, spawnTangent.z).normalize();
          const lapDirection = headingForward.dot(tangentForward) >= 0 ? 1 : -1;

          gameRef.current.playerPos.copy(resolvedSpawnPos);
          gameRef.current.heading = spawnHeading;
          gameRef.current.trackIndex = spawnTrackIndex;
          gameRef.current.lapStartIndex = spawnTrackIndex;
          gameRef.current.lapStartDistance = track.cumulativeLengths[spawnTrackIndex];
          gameRef.current.lapDirection = lapDirection;
          gameRef.current.lapDistance = 0;
          gameRef.current.lapTravel = 0;

          // Add small directional arrow above spawn point
          const arrowGeo = new THREE.ConeGeometry(0.6, 1.5, 8);
          const arrowMat = new THREE.MeshStandardMaterial({
            color: 0x00ff00,
            emissive: 0x00ff00,
            emissiveIntensity: 2
          });
          const arrow = new THREE.Mesh(arrowGeo, arrowMat);
          arrow.position.copy(resolvedSpawnPos).add(new THREE.Vector3(0, 3, 0));
          arrow.rotation.set(Math.PI / 2, spawnHeading, 0);
          scene.add(arrow);

          kart.position.copy(resolvedSpawnPos).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));
          kart.rotation.y = spawnHeading;
          mapReadyRef.current = true;
        };

        if (applySpawnFromRoot(mapRoot)) {
          finalizeSpawn();
        } else {
          gltfLoader.load(
            SPAWN_MARKER_MODEL_FILE,
            (spawnGltf) => {
              if (isDisposed) {
                return;
              }

              const spawnRoot = spawnGltf.scene;
              spawnRoot.scale.copy(mapRoot.scale);
              spawnRoot.position.copy(mapRoot.position);
              spawnRoot.updateMatrixWorld(true);
              applySpawnFromRoot(spawnRoot);
              finalizeSpawn();
            },
            undefined,
            () => {
              finalizeSpawn();
            },
          );
        }
      },
      undefined,
      () => {},
    );

    gltfLoader.load(
      CAR_MODEL_FILE,
      (gltf) => {
        if (isDisposed) {
          return;
        }

        const carRoot = gltf.scene;
        carRoot.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = false;
            obj.receiveShadow = true;
          }
        });

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        const box = new THREE.Box3().setFromObject(carRoot);
        box.getSize(size);

        const baseSize = Math.max(size.x, size.z, size.y, 0.001);
        const targetLength = track.roadHalfWidth * 0.9;
        const scale = (targetLength / baseSize) * CAR_SCALE_MULTIPLIER;
        carRoot.scale.setScalar(scale);
        carRoot.rotation.y = CAR_FORWARD_OFFSET_Y;

        box.setFromObject(carRoot);
        box.getSize(size);
        box.getCenter(center);
        const footprintMin = Math.min(size.x, size.z);
        const footprintMax = Math.max(size.x, size.z);
        carHalfWidth = Math.max(0.28, footprintMin * 0.22);
        carHalfLength = Math.max(0.5, footprintMax * 0.34);
        carRoot.position.set(-center.x, -box.min.y + 0.02, -center.z);
        kart.add(carRoot);
      },
      undefined,
      () => {},
    );

    const keys = new Set<string>();

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      keys.add(key);
      if (gameRef.current.status === "ready" && mapReadyRef.current) {
        gameRef.current.status = "racing";
        setStatus("racing");
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key.toLowerCase());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    gameRef.current = createInitialGameState(
      startPoint.clone(),
      Math.atan2(startTangent.x, startTangent.z),
    );

    kart.position.copy(startPoint).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));

    let frameId = 0;
    let prev = performance.now();
    let blurAmount = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      const game = gameRef.current;
      const frameStartPos = game.playerPos.clone();

      if (game.status === "racing") {
        const accelInput = keys.has("arrowup") || keys.has("w") ? 1 : 0;
        const brakeInput = keys.has("arrowdown") || keys.has("s") ? 1 : 0;
        const maxSpeed = MAX_DRIVE_SPEED;
        const steerSpeedFactor = THREE.MathUtils.clamp(game.speed / maxSpeed, 0, 1);
        const canSteer = game.speed > MIN_STEER_SPEED || accelInput > 0;
        const steerInput =
          canSteer
            ? (keys.has("arrowright") || keys.has("a") ? 1 : 0) -
              (keys.has("arrowleft") || keys.has("d") ? 1 : 0)
            : 0;
        const steerResponse = steerInput === 0
          ? THREE.MathUtils.lerp(11.5, 7.2, steerSpeedFactor)
          : THREE.MathUtils.lerp(6.2, 4.1, steerSpeedFactor);
        const steerAlpha = 1 - Math.exp(-steerResponse * dt);
        game.steer = THREE.MathUtils.lerp(game.steer, steerInput, steerAlpha);
        if (steerInput === 0 && game.speed > 0.1) {
          const selfAlign = 1 - Math.exp(-(2.8 + steerSpeedFactor * 4.2) * dt);
          game.steer = THREE.MathUtils.lerp(game.steer, 0, selfAlign);
        }
        
        const previousHeading = game.heading;
        game.speed = updateCarSpeed(game.speed, accelInput, brakeInput, dt, DEFAULT_PHYSICS);
        game.heading = updateCarHeading(game.heading, game.steer, game.speed, dt, DEFAULT_PHYSICS);
        const headingStep = Math.atan2(
          Math.sin(game.heading - previousHeading),
          Math.cos(game.heading - previousHeading),
        );
        const yawRate = headingStep / Math.max(dt, 1e-4);
        const velocity = calculateVelocity(game.heading, game.speed);
        const moveVector = velocity.clone().multiplyScalar(dt);
        const moveDistance = moveVector.length();
        if (moveDistance > 0) {
          const steps = Math.max(1, Math.ceil(moveDistance / 3.5));
          const step = moveVector.clone().divideScalar(steps);
          const forwardDir = new THREE.Vector3(Math.sin(game.heading), 0, Math.cos(game.heading));
          const rightDir = new THREE.Vector3(forwardDir.z, 0, -forwardDir.x);
          for (let i = 0; i < steps; i += 1) {
            const stepTarget = game.playerPos.clone().add(step);
            if (mapGroundMeshes.length > 0) {
              const roadPoint = canOccupyRoad(stepTarget, game.heading);
              if (!roadPoint) {
                // Smoothly lose speed on wall contact instead of hard-braking to near-zero.
                const wallSlowdown = Math.exp(-WALL_SLOWDOWN_RATE * dt);
                game.speed = Math.max(0, game.speed * wallSlowdown);

                const steerSign = Math.sign(game.steer);
                const recoverCandidates: THREE.Vector3[] = [
                  game.playerPos
                    .clone()
                    .addScaledVector(forwardDir, 0.2)
                    .addScaledVector(rightDir, -steerSign * 0.18),
                  game.playerPos.clone().addScaledVector(forwardDir, 0.18),
                  game.playerPos.clone().addScaledVector(rightDir, 0.2),
                  game.playerPos.clone().addScaledVector(rightDir, -0.2),
                  game.playerPos.clone().addScaledVector(forwardDir, -0.16),
                ];

                let recovered = false;
                for (const candidate of recoverCandidates) {
                  const recoverHit = canOccupyRoad(candidate, game.heading);
                  if (!recoverHit) {
                    continue;
                  }
                  game.playerPos.lerp(recoverHit, 0.55);
                  recovered = true;
                  break;
                }

                if (!recovered) {
                  break;
                }
                continue;
              }
              game.playerPos.lerp(roadPoint, 0.75);
            } else {
              game.playerPos.copy(stepTarget);
            }
          }
        }

        game.lapTravel += frameStartPos.distanceTo(game.playerPos);

        game.timeLeft = Math.max(0, game.timeLeft - dt);
        game.trackIndex = nearestTrackIndex(track, game.playerPos, game.trackIndex);
        const tangent = track.tangents[game.trackIndex];
        const facing = Math.atan2(tangent.x, tangent.z);
        const headingDelta = Math.atan2(
          Math.sin(game.heading - facing),
          Math.cos(game.heading - facing),
        );
        game.speed -= Math.abs(headingDelta) * 2.2 * dt;
        game.speed = THREE.MathUtils.clamp(game.speed, 0, maxSpeed);
        const targetDisplaySpeed = (game.speed / maxSpeed) * DISPLAY_TOP_SPEED;
        game.displaySpeed = THREE.MathUtils.lerp(
          game.displaySpeed,
          targetDisplaySpeed,
          1 - Math.exp(-DISPLAY_SPEED_RESPONSE * dt),
        );

        const lapDeltaIndex =
          (game.trackIndex - game.lapStartIndex + SAMPLE_COUNT) % SAMPLE_COUNT;
        const lapProgressIndex =
          game.lapDirection >= 0
            ? lapDeltaIndex
            : (SAMPLE_COUNT - lapDeltaIndex) % SAMPLE_COUNT;

        const absDistance = track.cumulativeLengths[game.trackIndex];
        const forwardDistance =
          (absDistance - game.lapStartDistance + track.totalLength) % track.totalLength;
        const reverseDistance =
          (game.lapStartDistance - absDistance + track.totalLength) % track.totalLength;
        game.lapDistance = game.lapDirection >= 0 ? forwardDistance : reverseDistance;
        const checkpointThresholds = [0.2, 0.45, 0.7, 0.9];
        for (let i = 0; i < checkpointThresholds.length; i += 1) {
          if (lapProgressIndex >= Math.floor(SAMPLE_COUNT * checkpointThresholds[i])) {
            game.checkpoints[i] = true;
          }
        }

        const nearStart = lapProgressIndex < 8;
        const lapDistanceThreshold = track.totalLength * LAP_DISTANCE_THRESHOLD_FACTOR;
        if (
          !game.lastNearStart &&
          nearStart &&
          game.checkpoints.every(Boolean) &&
          game.speed > 8 &&
          game.lapTravel >= lapDistanceThreshold
        ) {
          game.lap += 1;
          game.checkpoints = [false, false, false, false];
          game.lapTravel = 0;
          setLap(Math.min(game.lap, TOTAL_LAPS));
          if (game.lap > TOTAL_LAPS) {
            game.status = "won";
            setStatus("won");
          }
        }
        game.lastNearStart = nearStart;

        const speedFactor = THREE.MathUtils.clamp(game.speed / maxSpeed, 0, 1);
        const accelDelta = (game.speed - game.prevSpeed) / Math.max(dt, 1e-4);
        game.prevSpeed = game.speed;

        const targetRoll = THREE.MathUtils.clamp(
          -game.steer * (0.035 + speedFactor * 0.13),
          -0.16,
          0.16,
        );
        const targetPitch = THREE.MathUtils.clamp(
          accelDelta > 0
            ? -Math.min(0.06, accelDelta * 0.0038)
            : Math.min(0.07, -accelDelta * 0.0045),
          -0.08,
          0.08,
        );
        const targetYawOffset = THREE.MathUtils.clamp(
          -yawRate * (0.006 + speedFactor * 0.0035),
          -0.07,
          0.07,
        );

        game.visualRoll = THREE.MathUtils.lerp(game.visualRoll, targetRoll, 1 - Math.exp(-8.5 * dt));
        game.visualPitch = THREE.MathUtils.lerp(game.visualPitch, targetPitch, 1 - Math.exp(-6.8 * dt));
        game.visualYawOffset = THREE.MathUtils.lerp(
          game.visualYawOffset,
          targetYawOffset,
          1 - Math.exp(-7.2 * dt),
        );

        kart.position.copy(game.playerPos).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));
        kart.rotation.x = game.visualPitch;
        kart.rotation.y = game.heading + game.visualYawOffset;
        kart.rotation.z = game.visualRoll;

        updateCamera(camera, game.playerPos, game.heading, game.speed, maxSpeed, game.steer, dt);

        if (game.timeLeft <= 0) {
          game.status = "lost";
          setStatus("lost");
        }

        game.hudTimer += dt;
        if (game.hudTimer > 0.08) {
          game.hudTimer = 0;
          setTimeLeft(game.timeLeft);
          setProgress((game.lapDistance / track.totalLength) * 100);
          setSpeed(game.displaySpeed);
        }
      }

      blurAmount = updateSpeedBlurAmount(blurAmount, game.speed, MAX_DRIVE_SPEED, dt);
      speedBlurPass.uniforms.amount.value = blurAmount;

      composer.render();
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    const onResize = () => {
      if (!mount) {
        return;
      }
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
    };

    window.addEventListener("resize", onResize);

    gameRef.current.cleanup = () => {
      isDisposed = true;
      mapReadyRef.current = false;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };

    return () => {
      gameRef.current.cleanup();
    };
  }, [resetToken]);

  const restart = () => {
    setStatus("ready");
    setTimeLeft(RACE_SECONDS);
    setLap(1);
    setProgress(0);
    setSpeed(0);
    setResetToken((token) => token + 1);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#d6ffdf_0%,#9ed5ff_40%,#62a4df_100%)] text-white">
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3 sm:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-200 sm:text-sm">
            Time Trial
          </p>
          <h1 className="text-lg font-black uppercase tracking-wider text-white sm:text-2xl">
            Mushroom Sprint
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200 sm:text-sm">Timer</p>
          <p className="text-2xl font-black tabular-nums text-white sm:text-4xl">
            {timeLeft.toFixed(1)}s
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-16 sm:px-8 sm:pb-7">
        <div className="rounded-2xl border border-white/30 bg-black/45 px-4 py-3 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-100">Lap</p>
          <p className="text-xl font-black tabular-nums text-lime-300 sm:text-2xl">
            {Math.min(lap, TOTAL_LAPS)} / {TOTAL_LAPS}
          </p>
        </div>
        <div className="rounded-2xl border border-white/30 bg-black/45 px-4 py-3 text-right backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-100">Track</p>
          <p className="text-xl font-black tabular-nums text-amber-300 sm:text-2xl">
            {progress.toFixed(0)}%
          </p>
        </div>
        <div className="rounded-2xl border border-white/30 bg-black/45 px-4 py-3 text-right backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-100">Speed</p>
          <p className="text-xl font-black tabular-nums text-cyan-300 sm:text-2xl">
            {speed.toFixed(0)} km/h
          </p>
        </div>
      </div>

      {status === "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 px-6">
          <div className="max-w-lg rounded-3xl border border-white/40 bg-black/55 p-6 text-center shadow-2xl backdrop-blur-md sm:p-8">
            <h2 className="text-3xl font-black uppercase tracking-wider text-amber-300 sm:text-4xl">
              Solo Cup
            </h2>
            <p className="mt-3 text-sm text-zinc-100 sm:text-base">
              3-lap time trial on a full circuit. Finish in {RACE_SECONDS} seconds.
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-cyan-200 sm:text-sm">
              Drive: W/S + A/D or Arrow Keys
            </p>
            <p className="mt-4 text-sm text-zinc-200">No drifting. No abilities. Pure driving.</p>
          </div>
        </div>
      )}

      {(status === "won" || status === "lost") && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-6">
          <div className="max-w-md rounded-3xl border border-white/40 bg-black/60 p-7 text-center shadow-2xl backdrop-blur-md">
            <h2 className="text-3xl font-black uppercase tracking-wider text-white sm:text-4xl">
              {status === "won" ? "Finish! Gold Trophy" : "Time Up"}
            </h2>
            <p className="mt-3 text-zinc-100">
              {status === "won"
                ? `You cleared all ${TOTAL_LAPS} laps with ${timeLeft.toFixed(1)}s left.`
                : `You reached lap ${Math.min(lap, TOTAL_LAPS)} with ${progress.toFixed(0)}% on this lap.`}
            </p>
            <button
              type="button"
              onClick={restart}
              className="mt-6 cursor-pointer rounded-full border border-white/40 bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-2 text-sm font-black uppercase tracking-[0.14em] text-black transition hover:brightness-110"
            >
              Race Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
