import { haversineMeters } from "./geo";
import type { Coord } from "./types";

/**
 * 넓은 부지 목적지의 **출입구 승격** 판정(순수 계층).
 * 설계 정본: `docs/superpowers/specs/2026-08-16-destination-entrance-promotion-design.md`.
 *
 * 왜 필요한가: 학교·아파트단지처럼 부지가 넓으면 검색이 주는 대표 좌표가 **본관**이고
 * 도보 경로는 **정문**에서 끝난다. 그 차이가 통째로 `finalApproach` 오프셋이 되어
 * 도착 반경(15m)에 영영 못 든다(등교 실보행 2026-08-10·08-11, 56m).
 *
 * 판정은 서버가 소유한다 — Kit 미러를 만들지 않는다. 클라이언트는 좌표 하나를 받는다.
 */

/** 카카오 키워드 응답 한 건 중 이 판정이 읽는 부분. */
export interface EntranceCandidate {
  name: string;
  category: string;
  lat: number;
  lng: number;
}

/** 승격 결과. `meters`는 대표 좌표에서 출입구까지의 거리(= 승격 폭). */
export interface EntranceMatch {
  name: string;
  lat: number;
  lng: number;
  meters: number;
}

/**
 * 자격·이득 게이트 상수(§2·§3.1). **셋 다 잠정값이고 실보행 재판정 대상이다.**
 * 도착 반경(15m)과 달리 이것들은 "승격이 이득인가"라는 다른 축이라 동결 대상이 아니다.
 */
export const ENTRANCE_CANDIDATE_RADIUS_M = 1000;
export const ENTRANCE_MAX_PROMOTION_M = 300;
export const ENTRANCE_MIN_ORIGIN_DISTANCE_M = 200;
/** 거리 동률 판정 폭(m). 이 안이면 이름으로 결정론적으로 가른다. */
const TIE_METERS = 1;

/** 카카오가 출입구 POI에 붙이는 카테고리 조각. 지하철 출구는 `지하철출구`로 다르다. */
const ENTRANCE_CATEGORY = "입출구";

/** `haversineMeters`가 스칼라 4개를 받으므로 좌표 쌍으로 감싼다(호출부 가독). */
function metersBetween(a: Coord, b: Coord): number {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

/**
 * 이름 정규화 — **조건 2(접두)와 조건 3(잔여)에 같은 것을 쓴다.**
 * 둘이 갈리면 "접두는 맞는데 잔여가 안 맞는" 조합이 생긴다.
 *
 * ⚠ `제` 접두는 지우지 않는다 — 이름 본문의 `제`까지 지워 접두 비교를 흔든다
 * (`제일고등학교`). 서수 정문(`제2정문`)은 토큰 문법이 `제?`로 흡수한다.
 */
function normalizeName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, "") // 괄호와 그 안의 부가명
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * 출입구 토큰 하나를 문자열 앞에서 소비한다.
 *
 * ⚠ 공백을 지운 뒤라 토큰이 붙어 있다(`1단지정문`). 그래서 분리 대신 **앞에서부터
 * 반복 소비**하고, 전부 소비되면 잔여가 출입구 토큰들뿐이라는 뜻이다.
 *
 * ⚠ `\d+동`은 자격 토큰이 아니다 — 단지 전체가 목적지인데 특정 동 입구로 옮기는 것은
 * 승격이 아니라 다른 목적지다.
 */
const ENTRANCE_TOKEN =
  /^(?:\d+단지|제?\d*정문|제?\d*후문|측문|쪽문|[동서남북]{1,2}\d*문|\d+문|\d*번?출입구\d*|입구|\d*번?게이트\d*(?:-\d+)?|gate\d*)/;

/**
 * POI 이름에서 목적지 이름을 뗀 **잔여**. 출입구로 볼 수 없으면 null.
 *
 * - 접두가 아니면 null(타 시설 혼입 차단 — `"서울아산병원 출입구"` 응답에 섞여 오는
 *   `파크리오아파트 정문`·`한강공원풍납나들목 진출입로2`가 여기서 떨어진다).
 * - 잔여가 비면 null. **이 규칙이 승격을 멱등으로 만든다** — 승격된 `신명중학교 정문`을
 *   다시 조회해도 자기 자신은 후보가 아니다(안내 세션이 자기 경로를 다시 조회한다).
 * - 잔여에 출입구 토큰이 아닌 조각이 남으면 null(부속시설 오염 차단 —
 *   `올림픽공원 SK올림픽핸드볼경기장 게이트1-3`·`서울아산병원 동관 후문`).
 */
export function entranceRemainder(placeName: string, poiName: string): string | null {
  const base = normalizeName(placeName);
  const poi = normalizeName(poiName);
  if (!base || !poi.startsWith(base)) return null;

  const remainder = poi.slice(base.length);
  if (!remainder) return null;

  let rest = remainder;
  while (rest) {
    const token = ENTRANCE_TOKEN.exec(rest);
    if (!token) return null;
    rest = rest.slice(token[0].length);
  }
  return remainder;
}

/** 좌표 무관 자격(카테고리 + 이름). */
export function isEntranceCandidate(placeName: string, poi: EntranceCandidate): boolean {
  if (!poi.category.includes(ENTRANCE_CATEGORY)) return false;
  return entranceRemainder(placeName, poi.name) !== null;
}

/** 대표 출입구성 — 동률을 가르는 유일한 사회적 신호. */
function isMainGate(placeName: string, poiName: string): boolean {
  return (entranceRemainder(placeName, poiName) ?? "").includes("정문");
}

export interface ChooseEntranceInput {
  placeName: string;
  dest: Coord;
  /** 그 조회의 출발지(수동 위치 포함). 모르면 생략 — 이득 게이트 일부가 꺼진다. */
  from?: Coord | null;
  candidates: EntranceCandidate[];
}

/**
 * 승격 대상 출입구 하나를 고른다. 없으면 null(= 승격하지 않는다, 오류 아님).
 *
 * 선택 축은 **출발지 최근접**이다 — 접근 방향을 담는 신호는 GPS 실위치 하나뿐이라는
 * 것이 이미 확정된 판정이다(백로그 §9 "경로 종점" 폐기 근거: 목적지 8곳 × 접근 4방위
 * 32경로의 종점 산포가 전부 0m였다).
 *
 * ⚠ **출입구를 찾았다는 사실만으로 승격하지 않는다**(§3.1 이득 게이트). 단지 안에서
 * 출발해 같은 단지의 시설로 갈 때 정문 승격은 부지 밖으로 나갔다 되돌아오는 경로를
 * 만들고, 부지가 아주 큰 목적지에서 게이트 도착을 "목적지 도착"이라 선언하면 도착
 * 문장이 거짓이 된다.
 */
export function chooseEntrance(input: ChooseEntranceInput): EntranceMatch | null {
  const { placeName, dest, from, candidates } = input;

  // 이미 부지 부근에서 출발하면 승격은 개선이 아니라 회귀다.
  const originToDest = from ? metersBetween(from, dest) : null;
  if (originToDest !== null && originToDest <= ENTRANCE_MIN_ORIGIN_DISTANCE_M) return null;

  const eligible = candidates
    .filter((poi) => isEntranceCandidate(placeName, poi))
    .map((poi) => ({
      poi,
      meters: metersBetween(dest, poi),
      fromMeters: from ? metersBetween(from, poi) : null,
    }))
    .filter((c) => c.meters <= ENTRANCE_CANDIDATE_RADIUS_M)
    // 승격 폭 상한 — 후보 반경(1km)과 다른 축이다.
    .filter((c) => c.meters <= ENTRANCE_MAX_PROMOTION_M);
  // ⚠ "출입구가 출발지에서 더 가까울 때만"이라는 게이트는 두지 않는다(설계 리뷰 B4의
  // 셋 중 하나만 기각). 부지 반대편에 문이 하나뿐이면 도보 경로는 **어차피 그 문에서
  // 끝나므로**, 그때 승격을 막는 것은 A11 증상을 그대로 남기는 것과 같다. "이미 부지
  // 부근에서 출발"하는 경우는 위 `ENTRANCE_MIN_ORIGIN_DISTANCE_M` 게이트가 이미 막는다.

  if (eligible.length === 0) return null;

  const best = eligible.slice().sort((a, b) => {
    // 대표 출입구성(정문). 동률 tie-break이자, 출발지를 모를 때는 **1순위**다 —
    // 접근 방향을 모르면 기하로 고를 근거가 없고, 남는 신호는 "정문"이라는 사회적
    // 의미 하나뿐이다.
    const aMain = isMainGate(placeName, a.poi.name);
    const bMain = isMainGate(placeName, b.poi.name);

    if (a.fromMeters === null || b.fromMeters === null) {
      if (aMain !== bMain) return aMain ? -1 : 1;
      return a.meters - b.meters;
    }

    const primary = a.fromMeters - b.fromMeters;
    if (Math.abs(primary) > TIE_METERS) return primary;
    // 동률: 대표 출입구 → 이름 사전순. 카카오 응답 순서에 결과를 맡기지 않는다.
    if (aMain !== bMain) return aMain ? -1 : 1;
    return a.poi.name.localeCompare(b.poi.name, "ko");
  })[0];

  return {
    name: best.poi.name,
    lat: best.poi.lat,
    lng: best.poi.lng,
    meters: Math.round(best.meters),
  };
}
