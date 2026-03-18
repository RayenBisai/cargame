import * as THREE from "three";
import { RaceStatus } from "./types";
import { RACE_SECONDS } from "./gameConfig";

export interface RuntimeGameState {
  status: RaceStatus;
  lap: number;
  lapDistance: number;
  lapTravel: number;
  lapStartDistance: number;
  lapStartIndex: number;
  lapDirection: number;
  timeLeft: number;
  speed: number;
  displaySpeed: number;
  steer: number;
  heading: number;
  prevSpeed: number;
  visualRoll: number;
  visualPitch: number;
  visualYawOffset: number;
  trackIndex: number;
  checkpoints: [boolean, boolean, boolean, boolean];
  lastNearStart: boolean;
  playerPos: THREE.Vector3;
  hudTimer: number;
  cleanup: () => void;
}

export function createInitialGameState(
  playerPos: THREE.Vector3,
  heading: number,
  status: RaceStatus = "ready",
): RuntimeGameState {
  return {
    status,
    lap: 1,
    lapDistance: 0,
    lapTravel: 0,
    lapStartDistance: 0,
    lapStartIndex: 0,
    lapDirection: 1,
    timeLeft: RACE_SECONDS,
    speed: 0,
    displaySpeed: 0,
    steer: 0,
    heading,
    prevSpeed: 0,
    visualRoll: 0,
    visualPitch: 0,
    visualYawOffset: 0,
    trackIndex: 0,
    checkpoints: [false, false, false, false],
    lastNearStart: false,
    playerPos,
    hudTimer: 0,
    cleanup: () => {},
  };
}
