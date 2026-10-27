import { haversineMeters } from "../geo";
import { lineHintMatches, normalizeStationName } from "../station-match";
import { subwayLineKey, subwayLineNameEn } from "../subway-line-names";
import type { JourneyStationInput } from "../types";

/**
 * 사용자가 고른 역과 ODsay 탈것 정류가 "같은 역"이라고 볼 좌표 반경(m). 이 판정의 유일한 새 수치.
 * 근거(저장 corpus 실측 2026-10-17): 한 환승 복합체 안 노선 간 정류 좌표 거리 최대 426m(잠실 8호선 ↔ 2호선),
 * 서울역 공항철도 331m. 동명 이역 신촌(경의중앙선 ↔ 2호선)은 680m대. "복합체 최대 < 500 < 동명 이역 최소"가
 * 깨지면 spec §4.3으로 돌아간다.
 */
export const JOURNEY_STATION_IDENTITY_M = 500;

const REGION_PREFIX = /^(수도권|부산|대구|광주|대전)\s*/;

function tableName(ko: string): string | null {
  // 급행 꼬리는 같은 노선의 출구 집합을 바꾸지 않으므로 표 조회 전에 뗀다(key는 급행이 이미 분리된 값).
  return subwayLineNameEn(subwayLineKey(ko).key);
}

function fallbackCore(ko: string): { region: string | null; core: string } {
  const s = ko.trim().replace(/\(급행\)$/, "");
  const m = s.match(REGION_PREFIX);
  const rest = (m ? s.slice(m[0].length) : s).replace(/[\s.·]/g, "");
  return { region: m ? m[1] : null, core: rest };
}

/**
 * 두 노선 표기가 같은 노선인가. 카카오 카테고리·출구 이름(`수도권2호선`·`수인분당선`)과 ODsay `lineName`
 * (`수도권 2호선`·`수도권 수인.분당선`)은 표기가 다르다. 두 쪽 모두 노선명 표(`subway-line-names.ts`)에 있으면
 * 영문 표 값끼리 비교하고(급행 꼬리는 무시), 아니면 지역 접두·구분자를 걷은 코어를 `lineHintMatches`로 비교한다
 * (지역 접두가 양쪽에 있고 다르면 다른 노선). `1호선` ↔ `11호선`은 다르다.
 */
export function sameLine(a: string, b: string): boolean {
  const fa = fallbackCore(a);
  const fb = fallbackCore(b);
  // 한쪽만 비수도권 지역 접두(`부산 2호선`)이고 다른 쪽이 맨 노선 토큰(`2호선` — 카카오 출구 이름은 지역을 싣지 않는다)이면
  // 표 비교를 건너뛴다: 표는 맨 번호를 수도권으로 읽어 `Line 2` ≠ `Busan Line 2`가 되고, 그 역의 출구가 전부 걸러져
  // 「출구 없음」으로 위장한다. 같은 역 안의 비교라 지역은 이미 정해져 있다 — 코어만 본다.
  const regional = (f: { region: string | null }) => f.region !== null && f.region !== "수도권";
  if ((regional(fa) && fb.region === null) || (regional(fb) && fa.region === null)) {
    return lineHintMatches(fa.core, fb.core);
  }
  const ta = tableName(a);
  const tb = tableName(b);
  if (ta !== null && tb !== null) return ta === tb;
  if (fa.region !== null && fb.region !== null && fa.region !== fb.region) return false;
  return lineHintMatches(fa.core, fb.core);
}

/**
 * ODsay 탈것의 승차·하차 정류가 사용자가 고른 역과 같은 역인가: 이름 키 같음 ∧ 좌표 500m 이내 ∧
 * (입력·정류 양쪽에 노선이 있으면 같은 노선). 좌표 조건은 노선 힌트 유무와 무관하게 늘 건다 — 노선 없는
 * 입력에서 이름만으로 동일성을 확정하는 경로는 없다(동명 이역 신촌).
 */
export function isSameStation(
  stop: { name: string; lat: number; lng: number; lineName?: string },
  input: JourneyStationInput,
): boolean {
  if (normalizeStationName(stop.name) !== normalizeStationName(input.name)) return false;
  const d = haversineMeters(stop.lat, stop.lng, input.coord.lat, input.coord.lng);
  if (!Number.isFinite(d) || d > JOURNEY_STATION_IDENTITY_M) return false;
  if (input.line && stop.lineName) return sameLine(stop.lineName, input.line);
  return true;
}

/**
 * 버스 정류장 이름의 비교 키(E70-e spec §4.2): 공백 제거 → 괄호 묶음 전부 제거 → 숫자 사이가 아닌 첫 `.` 앞부분.
 * 「강남역.삼성전자」→「강남역」, 「부산진역 (해양수산부.동구청)」→「부산진역」, 「2.28기념중앙공원건너1」→ 그대로.
 * Swift ICU 미러(`journeyBusStopKey`)가 같은 표를 읽으므로 정규식은 문자 클래스 안 `[`를 쓰지 않는다.
 */
export function busStopKey(name: string): string {
  const s = name.replace(/\s+/g, "").replace(/\([^)]*\)/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ".") continue;
    const digitsAround = /^[0-9]$/.test(s[i - 1] ?? "") && /^[0-9]$/.test(s[i + 1] ?? "");
    if (!digitsAround) return s.slice(0, i);
  }
  return s;
}

/** 이름이 달라도 같은 정류장으로 보는 거리(m) — 같은 모퉁이의 이웃 정류장(「시청.덕수궁」 ↔ 「시청앞.덕수궁」, 실측 37m). */
export const JOURNEY_SAME_STOP_M = 50;

/**
 * 정류장 입력 ↔ 버스 leg 끝 정류(강): (빈 키가 아니고 키 같음 ∧ 좌표 500m 이내) ∨ 좌표 50m 이내(이름 무관).
 * 길 건너·부속명만 다른 정류장은 같은 곳으로 본다.
 */
export function isSameBusStop(
  stop: { name: string; lat: number; lng: number },
  input: JourneyStationInput,
): boolean {
  if (withinRadius(stop, input, JOURNEY_SAME_STOP_M)) return true;
  const key = busStopKey(input.name);
  // 빈 키(이름이 `.`·괄호뿐)는 이름 조건을 없애 500m 안이면 다 같은 곳이 되므로 이름 경로로는 맞지 않는다.
  if (key === "" || busStopKey(stop.name) !== key) return false;
  return withinRadius(stop, input, JOURNEY_STATION_IDENTITY_M);
}

function withinRadius(stop: { lat: number; lng: number }, input: JourneyStationInput, meters: number): boolean {
  const d = haversineMeters(stop.lat, stop.lng, input.coord.lat, input.coord.lng);
  return Number.isFinite(d) && d <= meters;
}

const HANGUL_SYLLABLE = /^[가-힣]$/;

/**
 * 역 입력 ↔ 버스 leg 끝 정류(약, `stops`일 때만): 좌표 500m 이내 ∧ (정류장 키를 역 키로 정규화한 것이 같다 ∨
 * 정류장 키 안에 `${역 키}역`이 있고 그 앞 글자가 없거나 한글 음절이 아니거나 `선`·`도`다).
 * 역 키는 `normalizeStationName` 재사용 — 자체 역명 정규화는 두지 않는다.
 */
export function busStopNamesStation(
  stop: { name: string; lat: number; lng: number },
  input: JourneyStationInput,
): boolean {
  if (!withinRadius(stop, input, JOURNEY_STATION_IDENTITY_M)) return false;
  const k = normalizeStationName(input.name);
  if (!k) return false;
  const key = busStopKey(stop.name).toLowerCase();
  if (key === "") return false;
  if (normalizeStationName(key) === k) return true;
  const needle = `${k}역`;
  for (let i = key.indexOf(needle); i >= 0; i = key.indexOf(needle, i + 1)) {
    const prev = i === 0 ? "" : key[i - 1];
    if (prev === "" || !HANGUL_SYLLABLE.test(prev) || prev === "선" || prev === "도") return true;
  }
  return false;
}
