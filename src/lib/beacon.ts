/**
 * 목적지 거리 비콘의 순수 판정 리듀서 (deterministic — navigator/React 비의존).
 *
 * 매 GPS fix마다 호출돼 (1) 직선거리 (2) accuracy로 스케일한 데드밴드 기준 추세
 * (가까워짐/멀어짐/유지) (3) 도착 임박 (4) 음성 발화여부를 결정한다. "무엇을
 * 알릴지"만 정하고, "어떻게 소리낼지"(톤·throttle·live region)는 오케스트레이터 몫.
 *
 * accuracy 스케일링이 핵심: 정확도 나쁜 지역일수록 데드밴드를 키워 GPS jitter로
 * 추세가 뒤집히는 것을 칼만 필터 없이 억제한다.
 */
import { haversineMeters } from "./geo";

export interface BeaconFix {
  lat: number;
  lng: number;
  /** 미터, 95% 신뢰 반경(GeolocationCoordinates.accuracy) */
  accuracy: number;
}

export interface BeaconDest {
  lat: number;
  lng: number;
}

export type Trend = "none" | "closer" | "farther";

export interface BeaconState {
  /** 추세 판정 기준 거리. 첫 수용 fix 전엔 null. */
  anchorDistance: number | null;
  trend: Trend;
  /** 마지막으로 음성 발화한 거리(마일스톤 throttle 기준). */
  lastSpokenDistance: number | null;
  /** 도착 임박 존 래치. */
  nearby: boolean;
}

export type AnnounceKind =
  | "first"
  | "closer"
  | "farther"
  | "hold"
  | "nearby"
  | "weak";

export interface BeaconAnnounce {
  kind: AnnounceKind;
  /** dest까지 직선거리(m). weak/NaN이면 0일 수 있음. */
  distance: number;
  /** 해당 fix의 accuracy(m). nearby 표시 ±값으로 사용. */
  accuracy: number;
  /** 음성 발화 여부(톤과 별개). */
  speak: boolean;
}

const MAX_USABLE_ACCURACY_M = 100;
const BASE_DEAD_BAND_M = 15;
const ARRIVAL_BASE_M = 20;
const SPEAK_INTERVAL_M = 50;

export const INITIAL_BEACON_STATE: BeaconState = {
  anchorDistance: null,
  trend: "none",
  lastSpokenDistance: null,
  nearby: false,
};

export function beaconStep(
  state: BeaconState,
  fix: BeaconFix,
  dest: BeaconDest,
): { state: BeaconState; announce: BeaconAnnounce } {
  const distance = haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng);

  // 신호 약함/무효: 추세·앵커 불변(상태 그대로 반환).
  // ⚠ `!(accuracy > 0)`은 NaN·0·음수를 한 번에 거른다. 음수는 iOS
  // `CLLocation.horizontalAccuracy`가 **좌표 무효**를 신호하는 값이고(웹 입력엔
  // 오지 않는다), 통과시키면 `deadBand = max(15, -1) = 15`가 되어 쓰레기 좌표가
  // 앵커를 잡는다. 가드가 플랫폼마다 갈리면 "단일 정본"이 거짓이 되므로 웹도 같이 좁힌다.
  if (
    !Number.isFinite(distance) ||
    !(fix.accuracy > 0) ||
    fix.accuracy > MAX_USABLE_ACCURACY_M
  ) {
    return {
      state,
      announce: {
        kind: "weak",
        distance: Number.isFinite(distance) ? distance : 0,
        accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : 0,
        speak: false,
      },
    };
  }

  const deadBand = Math.max(BASE_DEAD_BAND_M, fix.accuracy);
  const arrivalThreshold = Math.max(ARRIVAL_BASE_M, fix.accuracy);

  // 첫 수용 fix: 앵커 설정 + 첫 안내(도착 존이면 nearby).
  if (state.anchorDistance === null) {
    if (distance <= arrivalThreshold) {
      return {
        state: { anchorDistance: distance, trend: "none", lastSpokenDistance: distance, nearby: true },
        announce: { kind: "nearby", distance, accuracy: fix.accuracy, speak: true },
      };
    }
    return {
      state: { anchorDistance: distance, trend: "none", lastSpokenDistance: distance, nearby: false },
      announce: { kind: "first", distance, accuracy: fix.accuracy, speak: true },
    };
  }

  // 도착 임박(래치): 존 진입 시 1회만 발화, 머무는 동안 침묵.
  if (distance <= arrivalThreshold) {
    const wasNearby = state.nearby;
    return {
      state: { anchorDistance: distance, trend: "none", lastSpokenDistance: distance, nearby: true },
      announce: { kind: "nearby", distance, accuracy: fix.accuracy, speak: !wasNearby },
    };
  }

  // 래치 해제는 threshold+deadBand를 넘어야(히스테리시스). 그 전엔 hold 침묵.
  if (state.nearby && distance <= arrivalThreshold + deadBand) {
    return {
      state: { ...state, nearby: true },
      announce: { kind: "hold", distance, accuracy: fix.accuracy, speak: false },
    };
  }

  // 여기부터 nearby 해제 상태에서 추세 판정.
  const anchor = state.anchorDistance;
  let trend: Trend = state.trend;
  let newAnchor = anchor;
  let kind: AnnounceKind;

  if (distance <= anchor - deadBand) {
    trend = "closer";
    newAnchor = distance;
    kind = "closer";
  } else if (distance >= anchor + deadBand) {
    trend = "farther";
    newAnchor = distance;
    kind = "farther";
  } else {
    kind = "hold"; // 추세·앵커 불변
  }

  const trendFlipped =
    kind !== "hold" && state.trend !== "none" && kind !== state.trend;
  const lastSpoken = state.lastSpokenDistance ?? distance;
  const milestone = Math.abs(distance - lastSpoken) >= SPEAK_INTERVAL_M;
  const speak = kind !== "hold" && (trendFlipped || milestone);

  return {
    state: {
      anchorDistance: newAnchor,
      trend,
      lastSpokenDistance: speak ? distance : state.lastSpokenDistance,
      nearby: false,
    },
    announce: { kind, distance, accuracy: fix.accuracy, speak },
  };
}
