import {
  parseManualLocation,
  type Fix,
  type ManualLocation,
  type ManualVerdict,
} from "./manual-location";

/**
 * 수동 위치의 **런타임 정본**. `localStorage`는 그 뒤의 영속 매체일 뿐이다.
 *
 * 저장 매체를 직접 읽고 쓰면 이미 열린 화면의 표시줄·길찾기 출발지가 즉시
 * 동기화되지 않고, 다른 탭의 변경이 전파되지 않는다. `geolocation.ts`의 모듈
 * 싱글턴 + 구독 패턴을 그대로 미러한다.
 */
const STORAGE_KEY = "gildongmu:manual-location";

let state: ManualLocation | null = null;
/**
 * **마지막 판정 시도의 결과**. `null` = 아직 판정하지 않음(지정 직후·복원 직후).
 *
 * 영속하지 않는다 — 저장하면 며칠 전 판정이 새 세션의 라벨을 정한다. 수명은 지금
 * 담긴 수동 위치와 같아 `set`/`clear`가 함께 초기화하고, 판정 기록은 CAS를 통과한
 * 뒤에만 반영된다(늦게 온 옛 판정이 새 위치의 라벨을 정하지 않게).
 */
let verdict: ManualVerdict | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    state = raw ? parseManualLocation(JSON.parse(raw)) : null;
  } catch {
    // JSON 파싱 실패·저장소 접근 거부 모두 "없음"으로 떨어뜨린다. 손상된 값을
    // 복원하면 haversine이 NaN을 내고 모든 비교가 false가 되어 영구 유지된다.
    state = null;
  }
  if (state === null) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장소 접근 불가는 무시 — 런타임 상태는 이미 null이다.
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    // 다른 탭의 값도 같은 경계 검증을 지난다. 파싱이 던지면 "없음"으로 —
    // hydrate와 같은 계약이라야 손상값 폐기 불변식이 두 경로 모두에서 성립한다.
    try {
      state = e.newValue ? parseManualLocation(JSON.parse(e.newValue)) : null;
    } catch {
      state = null;
    }
    // 다른 탭이 바꾼 값에 이 탭의 판정 결과를 물려주지 않는다(다른 위치다).
    verdict = null;
    // 이 시점의 state가 정본이다. hydrate가 나중에 저장소를 다시 읽어 덮지 않게 한다.
    hydrated = true;
    emit();
  });
}

export function getManualLocation(): ManualLocation | null {
  hydrate();
  return state;
}

/** SSR 스냅샷 — 서버에는 저장소가 없다. */
export function getManualLocationServerSnapshot(): ManualLocation | null {
  return null;
}

/** 마지막 판정 결과. `null` = 아직 판정하지 않음. */
export function getManualVerdict(): ManualVerdict | null {
  return verdict;
}

/** SSR 스냅샷 — 서버에서는 판정이 돌지 않는다. */
export function getManualVerdictServerSnapshot(): ManualVerdict | null {
  return null;
}

/**
 * 판정 결과 기록. `runManualLocationJudgment`만 부른다.
 *
 * ⚠ 호출부가 CAS(revision 동일)를 통과한 뒤에만 부를 것 — 판정 왕복 중 재지정이
 * 있었다면 이 결과는 다른 위치에 대한 판정이다.
 */
export function setManualVerdict(next: ManualVerdict): void {
  if (verdict === next) return;
  verdict = next;
  emit();
}

export function subscribeManualLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ManualLocationInput {
  label: string;
  /** 라벨의 라틴 표기(E28 병기). 없으면 병기 없음 — `ManualLocation.labelRoman` 참조. */
  labelRoman?: string;
  lat: number;
  lng: number;
  /** 지정 시점의 적격 실측 fix. 없으면 판정이 undecidable이 된다. */
  origin: Fix | null;
  setAt: number;
}

/** 지정. `revision`은 이 함수만 증가시킨다(CAS 토큰의 단일 발급처). */
export function setManualLocation(input: ManualLocationInput): void {
  hydrate();
  const next = parseManualLocation({
    ...input,
    revision: (state?.revision ?? 0) + 1,
  });
  if (!next) return;
  state = next;
  // 새 위치에는 아직 판정이 없다(옛 위치의 결과를 물려주면 라벨이 거짓말한다).
  verdict = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패해도 런타임 상태는 유지한다(세션 안에서는 동작).
  }
  emit();
}

export function clearManualLocation(): void {
  hydrate();
  if (state === null) return;
  state = null;
  verdict = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시 — 런타임 상태가 정본이다.
  }
  emit();
}

export function __resetManualLocationForTest(): void {
  state = null;
  verdict = null;
  hydrated = false;
  listeners.clear();
}
