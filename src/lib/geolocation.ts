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

export type LocateOptions = {
  /**
   * 정확도 우선으로 좌표를 강제 재취득한다. 이미 ready여도 getCurrentPosition을
   * 다시 호출해 캐시된 옛 좌표를 새 좌표로 갱신한다("새로고침" 경로). GPS를 켜고
   * (enableHighAccuracy) OS 캐시를 무시(maximumAge:0)해 실내·이동 직후의 stale·
   * 부정확 좌표를 피한다. 기본(false)은 빠른 첫 획득용.
   */
  force?: boolean;
};

// 빠른 첫 획득용(저정밀·셀/와이파이). maximumAge는 짧게 둬 stale 좌표를 피하되,
// 첫 fix 속도는 보존한다(기존 5분은 이동 직후 직전 위치를 재사용해 부정확했다).
const FAST_OPTS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};
// 강제 갱신용(GPS 정밀·캐시 무시). GPS 락에 시간이 더 걸려 timeout을 늘린다.
const PRECISE_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

/**
 * 위치를 요청한다. 기본 경로는 세션당 한 번만 — 이미 좌표를 확보했거나(ready) 요청
 * 진행 중(locating)이면 no-op이라 네이티브 권한 팝업이 반복되지 않는다(이 모듈의
 * 핵심 목적). 거부/실패(denied) 후 재호출은 허용한다(브라우저가 차단을 기억하므로
 * 팝업 없이 즉시 실패하거나, 사용자가 설정에서 허용으로 바꿨다면 그때 성공).
 *
 * force:true면 ready여도 좌표를 다시 받아 갱신한다("새로고침"). 단 inflight(이미
 * 요청 중)면 force여도 중복 호출하지 않아, 동시 새로고침에도 getCurrentPosition은
 * 한 번만 실행된다(이때 진행 중 요청의 옵션으로 정착 — PRECISE_OPTS 미보장. 현재
 * force는 done 상태에서만 발생해 inflight=false가 보장되므로 실무상 무해).
 */
export function requestLocation(opts?: LocateOptions): void {
  const force = opts?.force ?? false;
  if (inflight) return;
  if (!force && (state.status === "ready" || state.status === "locating")) return;
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
      // 단일 문구와 정합 — 기존 동작 보존).
      inflight = false;
      setState({ status: "denied" });
    },
    force ? PRECISE_OPTS : FAST_OPTS,
  );
}

/**
 * 좌표를 비동기로 얻는다 — 이미 ready/unsupported면 즉시 반환(팝업 없음), 아니면
 * 공유 requestLocation을 트리거하고 상태가 ready/denied/unsupported로 정착할 때
 * resolve. 여러 컴포넌트가 동시에 호출해도 requestLocation의 inflight 가드 덕에
 * getCurrentPosition은 한 번만 실행된다. "내 주변" 버튼들이 이 함수로 좌표를 얻어,
 * 첫 1회 권한 획득 뒤로는 캐시된 좌표를 팝업 없이 재사용한다.
 *
 * force:true면 ready 캐시를 건너뛰고 좌표를 정밀 재취득해 resolve한다("새로고침"
 * 버튼 경로). 갱신된 좌표는 공유 스토어에 반영되어 useGeolocation 구독자 전체
 * (거리 정렬·공기질/날씨 등)가 함께 새 좌표를 받는다. unsupported는 force여도 즉시
 * 반환(지원 여부는 갱신 대상이 아님).
 */
export function awaitGeolocation(opts?: LocateOptions): Promise<GeoState> {
  const force = opts?.force ?? false;
  if (state.status === "unsupported") return Promise.resolve(state);
  if (!force && state.status === "ready") return Promise.resolve(state);
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
    requestLocation({ force });
  });
}

/** 테스트 전용 — 모듈 상태 초기화(navigator mock 교체 사이). */
export function __resetGeolocationForTest(): void {
  state = IDLE;
  inflight = false;
  listeners.clear();
}
