# 목적지 거리 비콘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세에서 목적지까지 직선거리를 실시간 추적해, 가까워지면 상승 톤·"가까워지는 중", 멀어지면 하강 톤·"멀어지는 중"으로 시각장애인에게 방향 피드백을 주는 전경 전용 비콘을 추가한다.

**Architecture:** 비결정적 I/O(GPS watchPosition·Wake Lock·Web Audio)와 결정적 판정(거리·추세·발화여부)을 분리한다. 판정은 순수 리듀서 `beacon.ts`로 잠그고 fixture 테스트, I/O는 훅 3종이 담당하며 오케스트레이터 훅이 매 fix를 리듀서에 위임한다.

**Tech Stack:** Next.js 16 / React 19 / next-intl 4 / Vitest 4 / Web Audio API / Geolocation watchPosition / Screen Wake Lock API. 신규 의존성 0.

## Global Constraints

- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수명: 영어. (워크스페이스 공통)
- 커밋 이메일 `engccer@gmail.com`.
- `src/lib/`는 React/Next 비의존(이식성). 순수 로직은 navigator·DOM 비의존.
- 미니멀 접근성: 단일 `aria-live="polite"`, assertive 금지, 중복 role 금지, 44px(`min-h-11`) 터치 타깃, 시각 텍스트 덮는 aria-label 금지. UI 라벨 이모지 금지.
- 외부 데이터 fetch 없음 → `dataLocale` 무관. i18n은 5개 언어(ko/en/es/fr/it) 전부, `i18n-messages.test.ts`가 키 패리티 게이트.
- 게이트 테스트(`beacon.ts`·`beacon-tones.ts`)는 매 커밋 통과. 훅·컴포넌트는 I/O라 node-env 단위테스트 없음(프로젝트 관행) → 타입체크·빌드·실기기 스모크로 검증.
- 상수(verbatim): `MAX_USABLE_ACCURACY_M = 100`, `BASE_DEAD_BAND_M = 15`, `ARRIVAL_BASE_M = 20`, `SPEAK_INTERVAL_M = 50`, 톤 throttle `TONE_THROTTLE_MS = 2000`.

---

### Task 1: `beacon-tones.ts` 톤 디스크립터 (순수)

**Files:**
- Create: `src/lib/beacon-tones.ts`
- Test: `src/lib/__tests__/beacon-tones.test.ts`

**Interfaces:**
- Consumes: `Tone` 타입 (`src/lib/recording-tones.ts`의 `export interface Tone { freq: number; start: number; dur: number; }`)
- Produces: `CLOSER_TONES`, `FARTHER_TONES`, `NEARBY_TONES`, `TICK_TONES` (각 `Tone[]`)

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/beacon-tones.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "../beacon-tones";

describe("beacon-tones", () => {
  it("CLOSER는 상승(낮은음→높은음)", () => {
    expect(CLOSER_TONES.length).toBeGreaterThanOrEqual(2);
    expect(CLOSER_TONES[1].freq).toBeGreaterThan(CLOSER_TONES[0].freq);
  });
  it("FARTHER는 하강(높은음→낮은음)", () => {
    expect(FARTHER_TONES[1].freq).toBeLessThan(FARTHER_TONES[0].freq);
  });
  it("NEARBY·TICK은 비어있지 않다", () => {
    expect(NEARBY_TONES.length).toBeGreaterThan(0);
    expect(TICK_TONES.length).toBe(1);
  });
  it("모든 톤은 양의 freq·dur", () => {
    for (const arr of [CLOSER_TONES, FARTHER_TONES, NEARBY_TONES, TICK_TONES]) {
      for (const t of arr) {
        expect(t.freq).toBeGreaterThan(0);
        expect(t.dur).toBeGreaterThan(0);
        expect(t.start).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- beacon-tones`
Expected: FAIL ("Cannot find module '../beacon-tones'")

- [ ] **Step 3: 구현**

`src/lib/beacon-tones.ts`:
```ts
/**
 * 거리 비콘 효과음의 톤 시퀀스(순수 데이터, Web Audio 비의존).
 *
 * 음높이 방향으로 추세를 즉시 구분: 가까워짐=상승, 멀어짐=하강, 도착=밝은 더블,
 * tick=낮은 단음("추적 중" 하트비트). recording-tones.ts와 동일한 Tone 형식.
 */
import type { Tone } from "./recording-tones";

export const CLOSER_TONES: Tone[] = [
  { freq: 660, start: 0, dur: 0.07 },
  { freq: 990, start: 0.08, dur: 0.09 },
];

export const FARTHER_TONES: Tone[] = [
  { freq: 990, start: 0, dur: 0.07 },
  { freq: 660, start: 0.08, dur: 0.09 },
];

export const NEARBY_TONES: Tone[] = [
  { freq: 880, start: 0, dur: 0.08 },
  { freq: 1320, start: 0.1, dur: 0.14 },
];

export const TICK_TONES: Tone[] = [{ freq: 330, start: 0, dur: 0.05 }];
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- beacon-tones`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/beacon-tones.ts src/lib/__tests__/beacon-tones.test.ts
git commit -m "feat(beacon): 거리 비콘 톤 디스크립터(상승/하강/도착/tick)"
```

---

### Task 2: `beacon.ts` 순수 리듀서 (판정의 심장)

**Files:**
- Create: `src/lib/beacon.ts`
- Test: `src/lib/__tests__/beacon.test.ts`

**Interfaces:**
- Consumes: `haversineMeters(aLat, aLng, bLat, bLng): number` (`src/lib/geo.ts`)
- Produces:
  - 타입 `BeaconFix { lat; lng; accuracy }`, `BeaconDest { lat; lng }`, `Trend = "none"|"closer"|"farther"`, `BeaconState { anchorDistance: number|null; trend: Trend; lastSpokenDistance: number|null; nearby: boolean }`, `AnnounceKind = "first"|"closer"|"farther"|"hold"|"nearby"|"weak"`, `BeaconAnnounce { kind: AnnounceKind; distance: number; accuracy: number; speak: boolean }`
  - `INITIAL_BEACON_STATE: BeaconState`
  - `beaconStep(state: BeaconState, fix: BeaconFix, dest: BeaconDest): { state: BeaconState; announce: BeaconAnnounce }`
  - 상수 `MAX_USABLE_ACCURACY_M`, `BASE_DEAD_BAND_M`, `ARRIVAL_BASE_M`, `SPEAK_INTERVAL_M`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/beacon.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  beaconStep,
  INITIAL_BEACON_STATE,
  type BeaconState,
  type BeaconFix,
} from "../beacon";

// 목적지: 서울시청 부근. 거리는 haversine 실제값을 쓰되, 같은 경도선에서
// 위도차로 거리를 만든다(위도 0.001° ≈ 111m). dest 기준 북쪽으로 떨어진 점.
const DEST = { lat: 37.5665, lng: 126.978 };
// dest에서 정북으로 d미터 떨어진 fix 생성(경도 고정, 위도만 가감).
function fixAt(metersNorth: number, accuracy = 10): BeaconFix {
  const dLat = metersNorth / 111_320; // 위도 1° ≈ 111.32km
  return { lat: DEST.lat + dLat, lng: DEST.lng, accuracy };
}

describe("beaconStep", () => {
  it("첫 fix는 first·speak=true·앵커 설정", () => {
    const { state, announce } = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST);
    expect(announce.kind).toBe("first");
    expect(announce.speak).toBe(true);
    expect(Math.round(announce.distance)).toBeGreaterThan(250);
    expect(state.anchorDistance).not.toBeNull();
  });

  it("데드밴드 내 미세 진동은 추세를 뒤집지 않는다(flapping 억제)", () => {
    let s: BeaconState = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    // ±10m 진동(데드밴드 15m 미만) → 전부 hold
    for (const d of [305, 295, 308, 293]) {
      const r = beaconStep(s, fixAt(d), DEST);
      expect(r.announce.kind).toBe("hold");
      s = r.state;
    }
  });

  it("앵커보다 deadBand 이상 줄면 closer", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(250), DEST); // 50m 감소 > 15
    expect(r.announce.kind).toBe("closer");
  });

  it("앵커보다 deadBand 이상 늘면 farther", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(350), DEST);
    expect(r.announce.kind).toBe("farther");
  });

  it("accuracy>100은 weak·추세 불변", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(200, 150), DEST);
    expect(r.announce.kind).toBe("weak");
    expect(r.state.anchorDistance).toBe(s.anchorDistance);
  });

  it("정확도가 크면 데드밴드가 커져 같은 변화도 hold", () => {
    // accuracy=60 → deadBand=60. 첫 fix도 accuracy 60으로.
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300, 60), DEST).state;
    const r = beaconStep(s, fixAt(260, 60), DEST); // 40m 감소 < 60
    expect(r.announce.kind).toBe("hold");
  });

  it("추세 flip이면 speak=true(마일스톤 미달이어도)", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    s = beaconStep(s, fixAt(280), DEST).state; // closer 확립
    const r = beaconStep(s, fixAt(300), DEST); // 다시 farther = flip
    expect(r.announce.kind).toBe("farther");
    expect(r.announce.speak).toBe(true);
  });

  it("같은 추세 지속은 50m 마일스톤에서만 speak", () => {
    let s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state; // lastSpoken≈300
    let r = beaconStep(s, fixAt(280), DEST); // 20m, closer, milestone 미달
    expect(r.announce.kind).toBe("closer");
    expect(r.announce.speak).toBe(false);
    s = r.state;
    r = beaconStep(s, fixAt(245), DEST); // 누적 55m > 50 → speak
    expect(r.announce.speak).toBe(true);
  });

  it("도착 임박은 nearby·정밀숫자 대신 ±accuracy·진입 시 1회 speak", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(15, 12), DEST); // 15m ≤ arrivalThreshold(max(20,12)=20)
    expect(r.announce.kind).toBe("nearby");
    expect(r.announce.speak).toBe(true);
    expect(r.state.nearby).toBe(true);
    // 머무는 동안 재발화 안 함
    const r2 = beaconStep(r.state, fixAt(14, 12), DEST);
    expect(r2.announce.kind).toBe("nearby");
    expect(r2.announce.speak).toBe(false);
  });

  it("nearby 이탈(threshold+deadBand 초과) 시 추세 재개", () => {
    const s0 = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const near = beaconStep(s0, fixAt(15, 10), DEST).state; // nearby, anchor≈15
    const r = beaconStep(near, fixAt(120, 10), DEST); // 120 > 20+10 → 이탈, farther
    expect(r.state.nearby).toBe(false);
    expect(r.announce.kind).toBe("farther");
  });

  it("hold는 speak=false", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, fixAt(305), DEST);
    expect(r.announce.kind).toBe("hold");
    expect(r.announce.speak).toBe(false);
  });

  it("NaN 좌표는 weak로 graceful", () => {
    const s = beaconStep(INITIAL_BEACON_STATE, fixAt(300), DEST).state;
    const r = beaconStep(s, { lat: NaN, lng: NaN, accuracy: 10 }, DEST);
    expect(r.announce.kind).toBe("weak");
    expect(r.state.anchorDistance).toBe(s.anchorDistance);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- "beacon.test"`
Expected: FAIL ("Cannot find module '../beacon'")

- [ ] **Step 3: 구현**

`src/lib/beacon.ts`:
```ts
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

export const MAX_USABLE_ACCURACY_M = 100;
export const BASE_DEAD_BAND_M = 15;
export const ARRIVAL_BASE_M = 20;
export const SPEAK_INTERVAL_M = 50;

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
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(fix.accuracy) ||
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- "beacon.test"`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/beacon.ts src/lib/__tests__/beacon.test.ts
git commit -m "feat(beacon): 순수 판정 리듀서(accuracy 스케일 데드밴드·추세·도착 degrade)"
```

---

### Task 3: i18n `beacon` 키 ×5 언어

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json` (각 최상위에 `"beacon"` 네임스페이스 추가)

**Interfaces:**
- Produces: `beacon.*` 키 — `heading`·`start`·`stop`·`first`·`closer`·`farther`·`nearby`·`weak`·`denied`·`screenHint`·`straightLineNote`. `{meters}` ICU 플레이스홀더(first/closer/farther/nearby).

- [ ] **Step 1: ko.json에 추가** — 최상위 `"offline"` 등 기존 키와 형제로 `"beacon"` 객체 삽입:
```json
"beacon": {
  "heading": "목적지 거리 추적",
  "start": "거리 추적 시작",
  "stop": "거리 추적 중지",
  "first": "목적지까지 약 {meters}m",
  "closer": "{meters}m, 가까워지는 중",
  "farther": "{meters}m, 멀어지는 중",
  "nearby": "목적지 근처 (약 ±{meters}m)",
  "weak": "신호 약함",
  "denied": "위치 권한이 필요합니다",
  "screenHint": "화면을 켜고 손에 든 채 사용하세요. 화면이 꺼지면 안내가 멈춥니다.",
  "straightLineNote": "직선거리 기준입니다. 실제 경로는 길찾기 앱을 이용하세요."
}
```

- [ ] **Step 2: en.json에 추가**:
```json
"beacon": {
  "heading": "Distance to destination",
  "start": "Start distance tracking",
  "stop": "Stop distance tracking",
  "first": "About {meters}m to destination",
  "closer": "{meters}m, getting closer",
  "farther": "{meters}m, getting farther",
  "nearby": "Near destination (about ±{meters}m)",
  "weak": "Weak signal",
  "denied": "Location permission required",
  "screenHint": "Keep the screen on and the phone in hand. Guidance stops when the screen turns off.",
  "straightLineNote": "Straight-line distance. Use a maps app for the actual route."
}
```

- [ ] **Step 3: es.json에 추가**:
```json
"beacon": {
  "heading": "Distancia al destino",
  "start": "Iniciar seguimiento de distancia",
  "stop": "Detener seguimiento de distancia",
  "first": "Unos {meters} m hasta el destino",
  "closer": "{meters} m, acercándose",
  "farther": "{meters} m, alejándose",
  "nearby": "Cerca del destino (unos ±{meters} m)",
  "weak": "Señal débil",
  "denied": "Se requiere permiso de ubicación",
  "screenHint": "Mantén la pantalla encendida y el teléfono en la mano. La guía se detiene cuando la pantalla se apaga.",
  "straightLineNote": "Distancia en línea recta. Usa una app de mapas para la ruta real."
}
```

- [ ] **Step 4: fr.json에 추가**:
```json
"beacon": {
  "heading": "Distance jusqu'à la destination",
  "start": "Démarrer le suivi de distance",
  "stop": "Arrêter le suivi de distance",
  "first": "Environ {meters} m jusqu'à la destination",
  "closer": "{meters} m, vous vous rapprochez",
  "farther": "{meters} m, vous vous éloignez",
  "nearby": "Près de la destination (environ ±{meters} m)",
  "weak": "Signal faible",
  "denied": "Autorisation de localisation requise",
  "screenHint": "Gardez l'écran allumé et le téléphone en main. Le guidage s'arrête quand l'écran s'éteint.",
  "straightLineNote": "Distance à vol d'oiseau. Utilisez une appli de cartes pour l'itinéraire réel."
}
```

- [ ] **Step 5: it.json에 추가**:
```json
"beacon": {
  "heading": "Distanza dalla destinazione",
  "start": "Avvia il monitoraggio della distanza",
  "stop": "Ferma il monitoraggio della distanza",
  "first": "Circa {meters} m alla destinazione",
  "closer": "{meters} m, ti stai avvicinando",
  "farther": "{meters} m, ti stai allontanando",
  "nearby": "Vicino alla destinazione (circa ±{meters} m)",
  "weak": "Segnale debole",
  "denied": "Autorizzazione alla posizione richiesta",
  "screenHint": "Tieni lo schermo acceso e il telefono in mano. La guida si interrompe quando lo schermo si spegne.",
  "straightLineNote": "Distanza in linea d'aria. Usa un'app di mappe per il percorso reale."
}
```

- [ ] **Step 6: i18n 패리티 테스트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS (ko 기준 키 집합·ICU 플레이스홀더가 5개 언어 동일)

- [ ] **Step 7: 커밋**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
git commit -m "feat(beacon·i18n): 거리 비콘 5개 언어 메시지"
```

---

### Task 4: `useScreenWakeLock.ts` (화면 유지 I/O)

**Files:**
- Create: `src/hooks/useScreenWakeLock.ts`

**Interfaces:**
- Produces: `useScreenWakeLock(): { acquire: () => Promise<void>; release: () => Promise<void> }`

- [ ] **Step 1: 구현**

`src/hooks/useScreenWakeLock.ts`:
```ts
"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Screen Wake Lock으로 비콘 추적 중 화면이 꺼지지 않게 한다(꺼지면 watchPosition이
 * 멈추는 웹 한계 완화). 탭이 백그라운드로 가면 락이 자동 해제되므로 visibilitychange로
 * 재획득한다. 미지원·거부는 graceful no-op — 비콘 동작을 막지 않는다(화면이 꺼지면
 * 멈추는 건 고지된 한계이지 차단 사유가 아니다).
 */
export function useScreenWakeLock(): {
  acquire: () => Promise<void>;
  release: () => Promise<void>;
} {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(false);

  const acquire = useCallback(async () => {
    activeRef.current = true;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      lockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // 거부·정책 차단 등 — graceful.
    }
  }, []);

  const release = useCallback(async () => {
    activeRef.current = false;
    try {
      await lockRef.current?.release();
    } catch {
      // 이미 해제됨 등 — 무시.
    }
    lockRef.current = null;
  }, []);

  // 탭 재가시화 시 활성 상태면 재획득.
  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        activeRef.current &&
        !lockRef.current
      ) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [acquire]);

  return { acquire, release };
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음. (`WakeLockSentinel`은 현행 TS DOM lib 기본 제공. 만약 미정의 오류가 나면 파일 상단에 `/// <reference lib="dom" />` 불필요 — tsconfig의 `lib`에 DOM 포함 여부 확인 후 보고.)

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useScreenWakeLock.ts
git commit -m "feat(beacon): Screen Wake Lock 훅(재획득·graceful)"
```

---

### Task 5: `useBeaconSound.ts` (톤 재생 I/O)

**Files:**
- Create: `src/hooks/useBeaconSound.ts`

**Interfaces:**
- Consumes: `CLOSER_TONES`·`FARTHER_TONES`·`NEARBY_TONES`·`TICK_TONES` (`@/lib/beacon-tones`), `START_TONES`·`STOP_TONES`·`Tone` (`@/lib/recording-tones`)
- Produces: `useBeaconSound(): { playCloser; playFarther; playNearby; playTick; playStart; playStop }` (각 `() => void`)

- [ ] **Step 1: 구현**

`src/hooks/useBeaconSound.ts`:
```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "@/lib/beacon-tones";
import { START_TONES, STOP_TONES, type Tone } from "@/lib/recording-tones";

/**
 * 거리 비콘 톤 재생(Web Audio 합성). useRecordingSound와 동일한 lazy AudioContext·
 * graceful no-op 패턴. tick은 보조 하트비트라 낮은 gain으로 재생한다.
 */
export function useBeaconSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (ctxRef.current?.state === "closed") return null;
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AC();
      } catch {
        return null;
      }
    }
    return ctxRef.current;
  }, []);

  const playTones = useCallback(
    (tones: Tone[], peakGain = 0.15) => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      try {
        const now = ctx.currentTime;
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = tone.freq;
          const t0 = now + tone.start;
          const t1 = t0 + tone.dur;
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.012);
          gain.gain.linearRampToValueAtTime(0, t1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0);
          osc.stop(t1 + 0.02);
        }
      } catch {
        // InvalidStateError 등 — graceful no-op.
      }
    },
    [getCtx],
  );

  return {
    playCloser: useCallback(() => playTones(CLOSER_TONES), [playTones]),
    playFarther: useCallback(() => playTones(FARTHER_TONES), [playTones]),
    playNearby: useCallback(() => playTones(NEARBY_TONES), [playTones]),
    playTick: useCallback(() => playTones(TICK_TONES, 0.06), [playTones]),
    playStart: useCallback(() => playTones(START_TONES), [playTones]),
    playStop: useCallback(() => playTones(STOP_TONES), [playTones]),
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useBeaconSound.ts
git commit -m "feat(beacon): 비콘 톤 재생 훅(Web Audio 합성, tick 저gain)"
```

---

### Task 6: `useDistanceBeacon.ts` (오케스트레이터 I/O)

**Files:**
- Create: `src/hooks/useDistanceBeacon.ts`

**Interfaces:**
- Consumes: `beaconStep`·`INITIAL_BEACON_STATE`·`BeaconState`·`BeaconAnnounce` (`@/lib/beacon`), `useBeaconSound` (`./useBeaconSound`), `useScreenWakeLock` (`./useScreenWakeLock`)
- Produces: `useDistanceBeacon(destLat: number, destLng: number): { status: "idle"|"tracking"|"denied"|"unsupported"; announce: BeaconAnnounce | null; supported: boolean; toggle: () => void }`

- [ ] **Step 1: 구현**

`src/hooks/useDistanceBeacon.ts`:
```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beaconStep,
  INITIAL_BEACON_STATE,
  type BeaconState,
  type BeaconAnnounce,
} from "@/lib/beacon";
import { useBeaconSound } from "./useBeaconSound";
import { useScreenWakeLock } from "./useScreenWakeLock";

export type BeaconStatus = "idle" | "tracking" | "denied" | "unsupported";

const TONE_THROTTLE_MS = 2000;

/**
 * 거리 비콘 오케스트레이터. watchPosition 생명주기를 쥐고, 매 fix를 순수
 * beaconStep에 위임한 뒤 결과(announce)를 톤·음성(live region용 상태)·Wake Lock으로
 * 라우팅한다. 결정 로직은 beacon.ts에 있고 여기는 I/O·throttle·정리만 담당한다.
 */
export function useDistanceBeacon(
  destLat: number,
  destLng: number,
): {
  status: BeaconStatus;
  announce: BeaconAnnounce | null;
  supported: boolean;
  toggle: () => void;
} {
  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [announce, setAnnounce] = useState<BeaconAnnounce | null>(null);

  const stateRef = useRef<BeaconState>(INITIAL_BEACON_STATE);
  const watchIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastToneAtRef = useRef(0);
  const startingRef = useRef(false);

  const { playCloser, playFarther, playNearby, playTick, playStart, playStop } =
    useBeaconSound();
  const wakeLock = useScreenWakeLock();

  const supported =
    typeof navigator !== "undefined" && !!navigator.geolocation;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const routeTone = useCallback(
    (kind: BeaconAnnounce["kind"]) => {
      // nearby 도착음은 throttle 없이 항상(중요 이벤트).
      if (kind === "nearby") {
        playNearby();
        lastToneAtRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (now - lastToneAtRef.current < TONE_THROTTLE_MS) return;
      lastToneAtRef.current = now;
      if (kind === "closer") playCloser();
      else if (kind === "farther") playFarther();
      else if (kind === "hold") playTick();
      // first·weak: 톤 없음.
    },
    [playCloser, playFarther, playNearby, playTick],
  );

  const stop = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    startingRef.current = false;
    void wakeLock.release();
    stateRef.current = INITIAL_BEACON_STATE;
    if (mountedRef.current) {
      setStatus("idle");
      setAnnounce(null);
    }
    playStop();
  }, [wakeLock, playStop]);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null || startingRef.current) return;
    startingRef.current = true;
    stateRef.current = INITIAL_BEACON_STATE;
    setStatus("tracking");
    setAnnounce(null);
    playStart();
    void wakeLock.acquire();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!mountedRef.current) return;
        const result = beaconStep(
          stateRef.current,
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
          { lat: destLat, lng: destLng },
        );
        stateRef.current = result.state;
        setAnnounce(result.announce);
        routeTone(result.announce.kind);
      },
      (err) => {
        if (!mountedRef.current) return;
        if (err.code === err.PERMISSION_DENIED) {
          if (
            watchIdRef.current !== null &&
            navigator.geolocation
          ) {
            navigator.geolocation.clearWatch(watchIdRef.current);
          }
          watchIdRef.current = null;
          void wakeLock.release();
          setStatus("denied");
          setAnnounce(null);
        } else {
          // POSITION_UNAVAILABLE·TIMEOUT: 추적 유지, 신호 약함만 표시.
          setAnnounce({ kind: "weak", distance: 0, accuracy: 0, speak: false });
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
    startingRef.current = false;
  }, [supported, destLat, destLng, wakeLock, playStart, routeTone]);

  // 언마운트 정리.
  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      void wakeLock.release();
    };
  }, [wakeLock]);

  const toggle = useCallback(() => {
    if (status === "tracking") stop();
    else start();
  }, [status, start, stop]);

  return { status, announce, supported, toggle };
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useDistanceBeacon.ts
git commit -m "feat(beacon): watchPosition 오케스트레이터(throttle·부분실패 유지·정리)"
```

---

### Task 7: `DistanceBeacon.tsx` + `PlaceDetail` 와이어링

**Files:**
- Create: `src/components/DistanceBeacon.tsx`
- Modify: `src/components/PlaceDetail.tsx` (import + `RouteLinks` 아래에 삽입)

**Interfaces:**
- Consumes: `useDistanceBeacon` (`@/hooks/useDistanceBeacon`)
- Produces: `DistanceBeacon({ dest }: { dest: { lat: number; lng: number; name: string } })`

- [ ] **Step 1: 컴포넌트 구현**

`src/components/DistanceBeacon.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useDistanceBeacon } from "@/hooks/useDistanceBeacon";

/**
 * 목적지 거리 비콘 UI — 시작/중지 토글 + 단일 polite live region.
 *
 * 접근성: 연속 피드백은 톤(useBeaconSound), 음성은 추세 flip·50m 마일스톤·도착·권한
 * 거부에서만 polite로 통지(장황한 낭독 회피). 화면 꺼짐·직선거리 한계는 정적 텍스트로
 * 항상 노출. geolocation 미지원이면 렌더 안 함(graceful).
 */
export function DistanceBeacon({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("beacon");
  const { status, announce, supported, toggle } = useDistanceBeacon(
    dest.lat,
    dest.lng,
  );

  const [live, setLive] = useState("");

  // live region 텍스트는 발화 신호(speak)·권한 거부·신호 약함에서만 갱신하고,
  // 그 외(hold·비발화 추세)는 직전 문구 유지(톤이 즉시 피드백을 준다).
  useEffect(() => {
    if (status === "idle") {
      setLive("");
      return;
    }
    if (status === "denied") {
      setLive(t("denied"));
      return;
    }
    if (!announce) return;
    if (announce.speak) {
      const meters = Math.round(
        announce.kind === "nearby" ? announce.accuracy : announce.distance,
      );
      if (announce.kind === "first") setLive(t("first", { meters }));
      else if (announce.kind === "closer") setLive(t("closer", { meters }));
      else if (announce.kind === "farther") setLive(t("farther", { meters }));
      else if (announce.kind === "nearby") setLive(t("nearby", { meters }));
    } else if (announce.kind === "weak") {
      setLive(t("weak"));
    }
  }, [announce, status, t]);

  if (!supported) return null;

  const tracking = status === "tracking";

  return (
    <section className="mt-4">
      <h3 className="text-base font-semibold">{t("heading")}</h3>
      <p className="mt-1 text-xs text-muted">{t("straightLineNote")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("screenHint")}</p>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={tracking}
        className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-white"
      >
        {tracking ? t("stop") : t("start")}
      </button>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {live}
      </p>
    </section>
  );
}
```

- [ ] **Step 2: PlaceDetail에 import 추가** — `src/components/PlaceDetail.tsx`의 import 블록(예: `RouteLinks` import 아래)에 추가:
```tsx
import { DistanceBeacon } from "./DistanceBeacon";
```

- [ ] **Step 3: PlaceDetail에 컴포넌트 삽입** — `<RouteLinks place={place} />` 바로 아래 줄에 추가:
```tsx
      <RouteLinks place={place} />
      <DistanceBeacon dest={{ lat: place.lat, lng: place.lng, name: place.name }} />
```

- [ ] **Step 4: 게이트 일괄 통과 확인**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 테스트 PASS(beacon·beacon-tones·i18n 포함), lint 통과, build 성공.

- [ ] **Step 5: 커밋**

```bash
git add src/components/DistanceBeacon.tsx src/components/PlaceDetail.tsx
git commit -m "feat(beacon): 거리 비콘 컴포넌트 + 장소 상세 와이어링"
```

- [ ] **Step 6: 실기기 보행 스모크(수동, 머지 현실 검증)**

`npm run dev`로 띄운 뒤(또는 프로덕션 프리뷰) **HTTPS/localhost에서 폰으로** 접속해 장소 상세 진입 → "거리 추적 시작" → 위치 권한 허용 → 실제로 몇 걸음 걸으며 확인:
- 목적지 방향으로 가면 상승 톤 + (50m마다)"…가까워지는 중"
- 반대로 가면 하강 톤 + "…멀어지는 중"
- 정지 시 미세 흔들림으로 추세가 깜빡이지 않음(데드밴드)
- 화면 켠 채 유지(Wake Lock)
검증 결과를 PROGRESS/커밋 메시지에 1줄 기록.

---

## Self-Review

**1. Spec coverage:**
- §1 포지셔닝·배치 → Task 7(PlaceDetail 삽입, canShow 게이트 없음 ✓)
- §2 한계 고지 → Task 3(screenHint·straightLineNote) + Task 7(정적 노출) ✓
- §3 아키텍처 분리 → Task 2(순수) vs Task 4–6(I/O) ✓
- §4 불변식(I1 accuracy 스케일·I2 알고리즘·I3 first·I4 announce) → Task 2 + 테스트 13개 ✓
- §5 톤·음성 → Task 1·5(톤), Task 6·7(라우팅·live region) ✓
- §6 Wake Lock → Task 4 ✓
- §7 생명주기·에러 → Task 6(denied/transient/정리/가드) + Task 7(토글·aria-pressed) ✓
- §8 i18n 5언어 → Task 3 ✓
- §9 테스트 게이트 → Task 1·2 단위, Task 3 i18n, Task 7 build+스모크 ✓
- §10 비목표 → 미구현(heading·백그라운드·경로거리·가변톤·사용자토글) ✓

**2. Placeholder scan:** 모든 step에 실제 코드/명령 포함. "TBD"·"적절히 처리" 없음 ✓

**3. Type consistency:** `beaconStep`·`BeaconState`·`BeaconAnnounce`·`AnnounceKind`(first/closer/farther/hold/nearby/weak)·`useDistanceBeacon(destLat,destLng)`·`useBeaconSound`(play*)·`useScreenWakeLock`(acquire/release)가 Task 2·4·5·6·7에서 일관 ✓. nearby 표시값은 `announce.accuracy`(Task 6 announce.accuracy 전달 → Task 7 round(accuracy)) 일관 ✓

**4. Ambiguity:** weak 시 distance/accuracy=0 가능 → live는 "신호 약함"(숫자 미사용)이라 안전 ✓
