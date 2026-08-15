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
  /**
   * 캐시 좌표의 **나이 상한(초)**. 지정하면 `ready` 캐시라도 이보다 오래됐을 때
   * 다시 잰다. 미지정이면 종전대로 캐시를 무조건 재사용한다.
   *
   * ⚠ `force`와 **다른 축**이다: `force`는 "무조건 다시 잰다"이고 이 옵션은
   * "낡았으면 다시 잰다"다. 이 스토어에는 TTL이 없어서 한 번 `ready`가 되면
   * 세션 내내 같은 좌표가 나오는데, "지금 어디 있는가"가 답의 일부인 조회는
   * 그 사이 이동을 조용히 놓친다(오류도 빈 결과도 아니라 그럴듯한 답이 온다).
   *
   * 재취득은 `force`와 같은 정밀 옵션으로 간다 — 나이 초과는 곧 "이동했을 수
   * 있다"는 판정이고, 그 상황의 저정밀 fix는 출발지로 쓰기에 나쁘다.
   */
  maxAgeSeconds?: number;
  /**
   * 재측위 중에도 **표시 상태를 흔들지 않는다**(이미 `ready`면 좌표를 그대로 둔 채
   * 조용히 갱신하고, 실패해도 직전 좌표를 유지한다).
   *
   * 쓰는 곳은 **화면이 요청하지 않은 측위** 하나뿐이다: 수동 위치 이동 판정은
   * 포그라운드 복귀마다 `force:true`로 도는데, 그때 스토어가 `locating`으로 후퇴하면
   * 그 좌표를 쓰는 섹션("이 지역 상황")이 통째로 언마운트·재마운트된다 — 포커스가
   * 이탈하고 fetch가 다시 나간다(백로그 D19). 판정은 옳고 **비용만** 문제였다.
   *
   * ⚠ 사용자가 누른 새로고침에는 쓰지 않는다 — 그쪽은 진행 신호가 필요하다.
   */
  silent?: boolean;
};

/**
 * 길찾기 조회가 출발지로 쓰는 "현재 위치"의 나이 상한(초, 위원장 판정 2026-08-16).
 * 연속 조회(수단을 바꿔 가며 여러 번)는 빠르게 두고 이동 뒤에만 재측위 대기가 붙는다.
 *
 * ⚠ iOS는 이 축이 이미 있다(`LocationFixPolicy.freshTTL` 60초 + `canReuseCachedFix`).
 * 웹만 TTL이 없어 여기에 생겼다 — 두 값이 다른 것은 드리프트가 아니라 계층 차이다
 * (iOS는 스토어 자체가 60초 TTL, 웹은 소비자가 상한을 들고 온다).
 */
export const DIRECTIONS_ORIGIN_MAX_AGE_SECONDS = 180;

/**
 * fix 시각(epoch 초). **수신 시각이 아니라 측정 시각**을 쓴다 — `maximumAge`로
 * OS 캐시 fix가 오면 수신 시각 도장은 나이를 그만큼 과소평가해 실효 수명이 늘어난다
 * (iOS `StoredFix.fixedAt`이 같은 이유로 수신 시각을 거부한다).
 *
 * ⚠ 표준은 `timestamp`를 epoch 밀리초로 규정하지만 그것을 신뢰만 하지는 않는다.
 * 값이 없거나 현재 시각에서 하루 이상 벗어나면(상대 시각 기반 구현·시계 점프)
 * 수신 시각으로 떨어진다 — 그 좌표를 영구히 낡은 것으로 만들어 매 조회마다 다시
 * 재는 것이 더 나쁜 실패다.
 */
function fixSeconds(timestamp: number | undefined, nowMs: number): number {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)
      && Math.abs(nowMs - timestamp) < 86_400_000) {
    return timestamp / 1000;
  }
  return nowMs / 1000;
}

/** 캐시 좌표가 상한보다 낡았는가. **나이를 모르면 낡은 것으로 본다.** */
function isStaleCoord(coords: Coord, maxAgeSeconds: number | undefined, now: number): boolean {
  if (maxAgeSeconds == null) return false;
  if (coords.at == null || !Number.isFinite(coords.at)) return true;
  return now / 1000 - coords.at > maxAgeSeconds;
}

/** 지금 상태가 이 요청의 요구(force·나이 상한)에 비추어 재측위를 필요로 하는가. */
function needsRefetch(opts: LocateOptions | undefined, now: number): boolean {
  if (opts?.force) return true;
  if (state.status !== "ready") return false;
  return isStaleCoord(state.coords, opts?.maxAgeSeconds, now);
}

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
  // 나이 초과는 force와 같은 취급을 받는다(재측위 실행 + 정밀 옵션). 판정은 한
  // 곳(needsRefetch)에서만 하고, 아래는 그 결과만 읽는다 — 두 군데서 각자 나이를
  // 재면 `awaitGeolocation`과 여기가 어긋나 요청이 걸리지 않는 조합이 생긴다.
  const refetch = needsRefetch(opts, Date.now());
  if (inflight) return;
  if (!refetch && (state.status === "ready" || state.status === "locating")) return;
  // 조용한 갱신은 `ready`를 유지한 채 좌표만 바꾼다. `ready`가 아니면(첫 획득·실패
  // 뒤) 숨길 상태가 없으므로 평소대로 진행한다.
  const silent = (opts?.silent ?? false) && state.status === "ready";
  const previous = state;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    setState({ status: "unsupported" });
    return;
  }
  inflight = true;
  if (!silent) setState({ status: "locating" });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      inflight = false;
      setState({
        status: "ready",
        coords: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          // 수동 위치 이동 판정이 오차 원을 차감하는 데 쓴다. 정확도를 버리면
          // 판정이 중심점 거리만 보게 되어 오차가 큰 실내 fix에서 오해제가 난다.
          accuracy: pos.coords.accuracy,
          at: fixSeconds(pos.timestamp, Date.now()),
        },
      });
    },
    () => {
      // 거부·위치불가·타임아웃 모두 denied로 합친다(소비 컴포넌트의 geoerror denied
      // 단일 문구와 정합 — 기존 동작 보존).
      inflight = false;
      // 조용한 갱신의 실패는 **직전 좌표를 유지**한다(재조회 실패가 데이터 포기는
      // 아니다 — "내 주변" 새로고침의 복원 계약과 같은 방향). 실패 사실은 판정
      // 결과(`undecidable` 라벨)가 전달하므로 여기서 화면을 비울 이유가 없다.
      setState(silent ? previous : { status: "denied" });
    },
    refetch ? PRECISE_OPTS : FAST_OPTS,
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
 *
 * maxAgeSeconds를 주면 캐시가 그보다 낡았을 때만 같은 재취득이 걸린다(A7 — 길찾기
 * 출발지). 캐시가 신선하면 종전과 같이 즉시 반환이다.
 */
export function awaitGeolocation(opts?: LocateOptions): Promise<GeoState> {
  if (state.status === "unsupported") return Promise.resolve(state);
  if (!needsRefetch(opts, Date.now()) && state.status === "ready") return Promise.resolve(state);
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
    requestLocation(opts);
  });
}

/** 테스트 전용 — 모듈 상태 초기화(navigator mock 교체 사이). */
export function __resetGeolocationForTest(): void {
  state = IDLE;
  inflight = false;
  listeners.clear();
}
