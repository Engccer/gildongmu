/**
 * 공유 위치 권한·좌표 스토어 (React/Next 비의존 — 브라우저 런타임 전용).
 *
 * 왜 공유 스토어인가:
 * 기존엔 "내 주변" 컴포넌트(지하철·버스·따릉이·소아진료·아이놀곳)가 각자
 * `navigator.geolocation.getCurrentPosition`을 버튼 누를 때마다 호출했다. 그 결과
 * 위치 권한 팝업이 컴포넌트마다·누를 때마다 반복됐다. 이 스토어는 좌표를 세션 1회만
 * 획득해 캐시하고, 모든 소비자가 같은 좌표를 공유하게 한다 — 첫 1회 이후엔
 * getCurrentPosition 자체를 다시 부르지 않아 팝업이 반복되지 않는다.
 *
 * useSyncExternalStore로 React에 노출(서버 스냅샷은 stable idle → hydration 안전,
 * LanguageSwitcher·useVoiceRecorder와 동일 패턴).
 */
import type { Coord } from "./types";

export type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; coords: Coord }
  | { status: "denied" } // 권한 거부·위치불가·타임아웃을 합친 "좌표 못 받음"
  | { status: "unsupported" };

// 서버 스냅샷 + 초기값으로 쓰는 stable 참조(useSyncExternalStore 동일성 요구).
const IDLE: GeoState = { status: "idle" };

let state: GeoState = IDLE;
let inflight = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: GeoState) {
  state = next;
  emit();
}

export function subscribeGeolocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGeolocationSnapshot(): GeoState {
  return state;
}

export function getGeolocationServerSnapshot(): GeoState {
  return IDLE;
}

/**
 * 위치를 세션당 한 번만 요청한다. 이미 좌표를 확보했거나(ready) 요청 진행 중
 * (locating)이면 no-op — 매 호출마다 getCurrentPosition을 다시 부르지 않아 네이티브
 * 권한 팝업이 반복되지 않는다(이 모듈의 핵심 목적). 거부/실패(denied) 후 재호출은
 * 허용한다: 브라우저가 차단을 기억하므로 팝업 없이 즉시 실패하거나, 사용자가 설정에서
 * 허용으로 바꿨다면 그때 성공한다.
 */
export function requestLocation(): void {
  if (state.status === "ready" || state.status === "locating" || inflight) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    setState({ status: "unsupported" });
    return;
  }
  inflight = true;
  setState({ status: "locating" });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      inflight = false;
      setState({
        status: "ready",
        coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
    },
    () => {
      // 거부·위치불가·타임아웃 모두 denied로 합친다(소비 컴포넌트의 geoerror denied
      // 단일 문구와 정합 — 기존 동작 보존). maximumAge로 직전 fix를 재사용한다.
      inflight = false;
      setState({ status: "denied" });
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
}

/**
 * 좌표를 비동기로 얻는다 — 이미 ready/unsupported면 즉시 반환(팝업 없음), 아니면
 * 공유 requestLocation을 트리거하고 상태가 ready/denied/unsupported로 정착할 때
 * resolve. 여러 컴포넌트가 동시에 호출해도 requestLocation의 inflight 가드 덕에
 * getCurrentPosition은 한 번만 실행된다. "내 주변" 버튼들이 이 함수로 좌표를 얻어,
 * 첫 1회 권한 획득 뒤로는 캐시된 좌표를 팝업 없이 재사용한다.
 */
export function awaitGeolocation(): Promise<GeoState> {
  if (state.status === "ready" || state.status === "unsupported") {
    return Promise.resolve(state);
  }
  return new Promise((resolve) => {
    const unsub = subscribeGeolocation(() => {
      if (
        state.status === "ready" ||
        state.status === "denied" ||
        state.status === "unsupported"
      ) {
        unsub();
        resolve(state);
      }
    });
    requestLocation();
  });
}

/** 테스트 전용 — 모듈 상태 초기화(navigator mock 교체 사이). */
export function __resetGeolocationForTest(): void {
  state = IDLE;
  inflight = false;
  listeners.clear();
}
