import * as THREE from "three";

export type RaceStatus = "ready" | "racing" | "won" | "lost";

export type TrackData = {
  curve: THREE.CatmullRomCurve3;
  samples: THREE.Vector3[];
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  cumulativeLengths: number[];
  totalLength: number;
  roadHalfWidth: number;
};

export type GameState = {
  status: RaceStatus;
  lap: number;
  lapDistance: number;
  timeLeft: number;
  speed: number;
  displaySpeed: number;
  heading: number;
  trackIndex: number;
  checkpoints: [boolean, boolean, boolean, boolean];
  lastNearStart: boolean;
  playerPos: THREE.Vector3;
  hudTimer: number;
  cleanup: () => void;
};
