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
  const ta = tableName(a);
  const tb = tableName(b);
  if (ta !== null && tb !== null) return ta === tb;
  const fa = fallbackCore(a);
  const fb = fallbackCore(b);
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
