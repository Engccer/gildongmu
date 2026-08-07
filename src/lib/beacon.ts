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

/**
 * closer 발화 마일스톤(잔여 거리 적응형, 위원장 실측 판정 2026-08-03). 정상 진행
 * (가까워짐)은 알림 가치가 낮고 추세 톤이 이미 연속 신호를 주므로 멀수록 성기게
 * 발화한다. farther는 경고라 50m 간격을 유지한다 — 두 축의 비대칭이 정책이다.
 * 간략 안내는 전 수단에서 참이라 차량 이동에서 50m 고정이 몇 초마다 발화되던
 * 문제도 이 사다리가 흡수한다(추세 반전 발화는 별도라 이 간격과 무관).
 */
export function closerSpeakIntervalM(distance: number): number {
  if (distance > 5000) return 1000;
  if (distance > 1000) return 500;
  if (distance > 300) return 200;
  return 100;
}

export type TrendKind = "closer" | "farther" | "hold";

/**
 * 데드밴드 기준 추세 판정(순수, 상태 미커밋). Kit `trendStep` 미러. 간략(직선거리)과
 * 상세(경로 잔여 거리)가 **같은 판정을 공유하는 유일한 지점**이다.
 *
 * ⚠ 리듀서(`beaconStep`) 전체를 상세에 재사용하는 안은 폐기됐다: 그 리듀서는 추세
 * 판정 외에 도착 판정·정확도 게이트(100m)·음성 마일스톤을 함께 소유하는데 셋 다
 * 상세와 충돌한다. 호출부가 결과를 채택할지 결정한다.
 */
export function trendStep(
  anchor: number | null,
  trend: Trend,
  distance: number,
  deadBand: number,
): { kind: TrendKind; anchor: number | null; trend: Trend } {
  if (anchor === null) return { kind: "hold", anchor: distance, trend };
  if (distance <= anchor - deadBand) {
    return { kind: "closer", anchor: distance, trend: "closer" };
  }
  if (distance >= anchor + deadBand) {
    return { kind: "farther", anchor: distance, trend: "farther" };
  }
  return { kind: "hold", anchor, trend };
}

/**
 * 거리 축이 바뀔 때(상세 경로 거리 ⇄ 간략 직선거리)의 재기준화. Kit `rebaseBeaconState`
 * 미러.
 *
 * 값이 **불연속으로** 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만 승계하고
 * `anchorDistance`와 `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로 재설정한다.
 *
 * ⚠ `lastSpokenDistance`를 옛 축 값(500m)으로 두면 새 축 현재값(120m)과의 차이 380m가
 * 즉시 마일스톤을 넘겨 **전환 직후 거짓 closer 음성**이 나가고, 반대 방향 전환에서는
 * 필요한 음성이 장기 억제된다. 앵커만 재설정하는 것으로는 부족하다.
 *
 * 새 축의 현재값을 모르면(낡은 fix) null이 정직한 폴백이다 — 다음 fix가 first 경로를
 * 타서 절대거리를 1회 발화하고 다시 추세를 잡는다.
 */
export function rebaseBeaconState(
  state: BeaconState,
  distance: number | null,
): BeaconState {
  return {
    anchorDistance: distance,
    trend: state.trend, // 방향만 승계
    lastSpokenDistance: distance,
    nearby: false,
  };
}

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

  // 여기부터 nearby 해제 상태에서 추세 판정(공용 `trendStep` — 상세 모드와 같은 축).
  const anchor = state.anchorDistance;
  const stepped = trendStep(anchor, state.trend, distance, deadBand);
  const trend = stepped.trend;
  const newAnchor = stepped.anchor ?? anchor;
  const kind: AnnounceKind = stepped.kind; // hold면 추세·앵커 불변

  const trendFlipped =
    kind !== "hold" && state.trend !== "none" && kind !== state.trend;
  const lastSpoken = state.lastSpokenDistance ?? distance;
  const speakInterval =
    kind === "closer" ? closerSpeakIntervalM(distance) : SPEAK_INTERVAL_M;
  const milestone = Math.abs(distance - lastSpoken) >= speakInterval;
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
