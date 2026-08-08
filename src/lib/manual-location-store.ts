import { parseManualLocation, type Fix, type ManualLocation } from "./manual-location";

/**
 * 수동 위치의 **런타임 정본**. `localStorage`는 그 뒤의 영속 매체일 뿐이다.
 *
 * 저장 매체를 직접 읽고 쓰면 이미 열린 화면의 표시줄·길찾기 출발지가 즉시
 * 동기화되지 않고, 다른 탭의 변경이 전파되지 않는다. `geolocation.ts`의 모듈
 * 싱글턴 + 구독 패턴을 그대로 미러한다.
 */
const STORAGE_KEY = "gildongmu:manual-location";

let state: ManualLocation | null = null;
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

export function subscribeManualLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ManualLocationInput {
  label: string;
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
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시 — 런타임 상태가 정본이다.
  }
  emit();
}

export function __resetManualLocationForTest(): void {
  state = null;
  hydrated = false;
  listeners.clear();
}
