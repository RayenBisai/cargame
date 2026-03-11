"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type RaceStatus = "ready" | "racing" | "won" | "lost";

type TrackData = {
  curve: THREE.CatmullRomCurve3;
  samples: THREE.Vector3[];
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  cumulativeLengths: number[];
  totalLength: number;
  roadHalfWidth: number;
};

const RACE_SECONDS = 110;
const TOTAL_LAPS = 3;
const SAMPLE_COUNT = 700;
const TRACK_MODEL_FILE = "/glbmap/racetrack.glb";
const CAR_MODEL_FILE = "/glbmap/racecar.glb";
const CAR_FORWARD_OFFSET_Y = -Math.PI / 2;
const MAP_SCALE_MULTIPLIER = 2;
const MAP_OFFSET_X = -8;
const MAP_OFFSET_Z = 0;
const CAR_RIDE_HEIGHT = 0.12;
const CAR_SCALE_MULTIPLIER = 0.5;
const START_MARKER_NAMES = ["start", "startline", "spawn"];
const ROAD_MESH_NAMES = ["road"];

function makeTrackData(): TrackData {
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

function nearestTrackIndex(track: TrackData, position: THREE.Vector3, hint: number): number {
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

function findStartMarker(root: THREE.Object3D): THREE.Object3D | null {
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

function nameMatchesTokens(name: string, tokens: string[]): boolean {
  const lowered = name.toLowerCase();
  return tokens.some((token) => lowered.includes(token));
}

function pickGroundHit(hits: THREE.Intersection[]): THREE.Intersection | null {
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

function shouldUseGroundMesh(mesh: THREE.Mesh): boolean {
  return nameMatchesTokens(mesh.name, ROAD_MESH_NAMES);
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<RaceStatus>("ready");
  const [resetToken, setResetToken] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RACE_SECONDS);
  const [lap, setLap] = useState(1);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);

  const gameRef = useRef({
    status: "ready" as RaceStatus,
    lap: 1,
    lapDistance: 0,
    timeLeft: RACE_SECONDS,
    speed: 0,
    heading: 0,
    trackIndex: 0,
    checkpoints: [false, false, false, false],
    lastNearStart: false,
    playerPos: new THREE.Vector3(),
    hudTimer: 0,
    cleanup: (() => {}) as () => void,
  });
  const mapReadyRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xa8deff, 38, 210);
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

    const hemi = new THREE.HemisphereLight(0xc4f8ff, 0x287042, 1.15);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffefb0, 1.2);
    sun.position.set(18, 28, 10);
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
    const groundRaycaster = new THREE.Raycaster();
    const downOrigin = new THREE.Vector3();
    let lastGroundY = 0;
    mapReadyRef.current = false;

    const snapToRoad = (basePosition: THREE.Vector3): THREE.Vector3 => {
      if (mapGroundMeshes.length === 0) {
        return basePosition.clone();
      }

      downOrigin.copy(basePosition).setY(basePosition.y + 60);
      groundRaycaster.set(downOrigin, new THREE.Vector3(0, -1, 0));
      groundRaycaster.far = 160;
      const groundHits = groundRaycaster.intersectObjects(mapGroundMeshes, false);
      const groundHit = pickGroundHit(groundHits);
      if (groundHit) {
        return groundHit.point.clone();
      }

      return basePosition.clone();
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
        const hit = snapToRoad(candidate);
        if (!hit.equals(candidate) || mapGroundMeshes.length === 0) {
          return hit;
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
          if (shouldUseGroundMesh(obj)) {
            mapGroundMeshes.push(obj);
          }
        });

        scene.add(mapRoot);

        let spawnPos = startPoint.clone();
        let spawnHeading = Math.atan2(startTangent.x, startTangent.z);
        let markerPosForSnap: THREE.Vector3 | undefined;
        const startMarker = findStartMarker(mapRoot);
        if (startMarker) {
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
        }

        spawnPos = resolveSpawnOnRoad(spawnPos, markerPosForSnap);

        gameRef.current.playerPos.copy(spawnPos);
        gameRef.current.heading = spawnHeading;
        gameRef.current.trackIndex = nearestTrackIndex(track, spawnPos, 0);
        gameRef.current.lapDistance = track.cumulativeLengths[gameRef.current.trackIndex];
        lastGroundY = spawnPos.y;

        kart.position.copy(spawnPos).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));
        kart.rotation.y = spawnHeading;
        mapReadyRef.current = true;
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
        box.getCenter(center);
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

    gameRef.current = {
      ...gameRef.current,
      status: "ready",
      lap: 1,
      lapDistance: 0,
      timeLeft: RACE_SECONDS,
      speed: 0,
      heading: Math.atan2(startTangent.x, startTangent.z),
      trackIndex: 0,
      checkpoints: [false, false, false, false],
      lastNearStart: false,
      playerPos: startPoint,
      hudTimer: 0,
      cleanup: () => {},
    };
    lastGroundY = startPoint.y;

    kart.position.copy(startPoint).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));

    let frameId = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      const game = gameRef.current;

      if (game.status === "racing") {
        const steerInput =
          (keys.has("arrowright") || keys.has("a") ? 1 : 0) -
          (keys.has("arrowleft") || keys.has("d") ? 1 : 0);

        const accelInput = keys.has("arrowup") || keys.has("w") ? 1 : 0;
        const brakeInput = keys.has("arrowdown") || keys.has("s") ? 1 : 0;

        const accel = 26;
        const brake = 36;
        const drag = 8;
        const maxSpeed = 42;

        if (accelInput > 0) {
          game.speed += accel * dt;
        } else {
          game.speed -= drag * dt;
        }

        if (brakeInput > 0) {
          game.speed -= brake * dt;
        }

        game.speed = THREE.MathUtils.clamp(game.speed, 0, maxSpeed);

        const steerRate = 2.1;
        game.heading += steerInput * steerRate * dt * (0.35 + game.speed / maxSpeed);

        const velocity = new THREE.Vector3(
          Math.sin(game.heading) * game.speed,
          0,
          Math.cos(game.heading) * game.speed,
        );

        const moveDistance = velocity.length() * dt;
        const nextPos = game.playerPos.clone().addScaledVector(velocity, dt);
        if (moveDistance > 0) {
          game.playerPos.copy(nextPos);
        }

        if (mapGroundMeshes.length > 0) {
          downOrigin.copy(game.playerPos).setY(game.playerPos.y + 20);
          groundRaycaster.set(downOrigin, new THREE.Vector3(0, -1, 0));
          groundRaycaster.far = 80;
          const groundHits = groundRaycaster.intersectObjects(mapGroundMeshes, false);
          const groundHit = pickGroundHit(groundHits);
          if (groundHit) {
            game.playerPos.y = groundHit.point.y;
            lastGroundY = groundHit.point.y;
          } else {
            game.playerPos.y = lastGroundY;
            game.speed *= 0.98;
          }
        }

        game.timeLeft = Math.max(0, game.timeLeft - dt);

        game.trackIndex = nearestTrackIndex(track, game.playerPos, game.trackIndex);
        const center = track.samples[game.trackIndex];
        const tangent = track.tangents[game.trackIndex];
        const normal = track.normals[game.trackIndex];
        const toKart = game.playerPos.clone().sub(center);
        const lateral = toKart.dot(normal);

        const lockedHalfWidth = Math.max(0.4, track.roadHalfWidth - 0.5);
        const offRoad = Math.abs(lateral) > lockedHalfWidth;
        if (offRoad) {
          game.speed = Math.max(game.speed - 14 * dt, 14);
        }

        const hardLimit = lockedHalfWidth;
        const clampedLateral = THREE.MathUtils.clamp(lateral, -hardLimit, hardLimit);
        if (clampedLateral !== lateral) {
          game.playerPos
            .copy(center)
            .addScaledVector(normal, clampedLateral)
            .addScaledVector(tangent, toKart.dot(tangent));
          game.speed *= 0.97;
        }

        const facing = Math.atan2(tangent.x, tangent.z);
        const headingDelta = Math.atan2(
          Math.sin(game.heading - facing),
          Math.cos(game.heading - facing),
        );
        game.speed -= Math.abs(headingDelta) * 2.2 * dt;

        game.lapDistance = track.cumulativeLengths[game.trackIndex];
        const checkpointThresholds = [0.2, 0.45, 0.7, 0.9];
        for (let i = 0; i < checkpointThresholds.length; i += 1) {
          if (game.trackIndex >= Math.floor(SAMPLE_COUNT * checkpointThresholds[i])) {
            game.checkpoints[i] = true;
          }
        }

        const nearStart = game.trackIndex < 8;
        if (!game.lastNearStart && nearStart && game.checkpoints.every(Boolean) && game.speed > 8) {
          game.lap += 1;
          game.checkpoints = [false, false, false, false];
          setLap(Math.min(game.lap, TOTAL_LAPS));
          if (game.lap > TOTAL_LAPS) {
            game.status = "won";
            setStatus("won");
          }
        }
        game.lastNearStart = nearStart;

        kart.position.copy(game.playerPos).add(new THREE.Vector3(0, CAR_RIDE_HEIGHT, 0));
        kart.rotation.y = game.heading;
        kart.rotation.z = -steerInput * 0.08;

        const forward = new THREE.Vector3(
          Math.sin(game.heading),
          0,
          Math.cos(game.heading),
        );
        const camBack = game.playerPos
          .clone()
          .addScaledVector(forward, -11)
          .add(new THREE.Vector3(0, 6.2, 0));
        const camTarget = game.playerPos
          .clone()
          .addScaledVector(forward, 7)
          .add(new THREE.Vector3(0, 1.8, 0));
        camera.position.lerp(camBack, 0.16);
        camera.lookAt(camTarget);

        if (game.timeLeft <= 0) {
          game.status = "lost";
          setStatus("lost");
        }

        game.hudTimer += dt;
        if (game.hudTimer > 0.08) {
          game.hudTimer = 0;
          setTimeLeft(game.timeLeft);
          setProgress((game.lapDistance / track.totalLength) * 100);
          setSpeed(game.speed);
        }
      }

      renderer.render(scene, camera);
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
    };

    window.addEventListener("resize", onResize);

    gameRef.current.cleanup = () => {
      isDisposed = true;
      mapReadyRef.current = false;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
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
            {(speed * 3.4).toFixed(0)} km/h
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
