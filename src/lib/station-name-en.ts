/**
 * 역 POI 이름의 영문(`Yeouido Station, Line 5`) — 로마자 음차(`Yeouidoyeok 5hoseon`) 대신
 * `nameRoman` 자리에 싣는다(위원장 판정 2026-09-27). 역명은 seed 영문(`nameEn`), 노선은
 * 노선명 영문 표(`subwayLineNameEn`, E27)가 정본이다.
 *
 * 판정은 둘 다 맞을 때만 한다: 역 레이아웃 분류(`stationLayoutKind` — 출구 POI는 빠진다)와
 * 좌표 600m 안 같은 이름 seed 레코드(`findStationMetaNear` — 전국 동명이역 차단). 노선 토큰이
 * 표에 없으면 `undefined`라 호출부가 종전 로마자로 떨어진다(반쪽 영문을 만들지 않는다).
 */
import type { Place } from "./types";
import { stationLayoutKind } from "./station-phone";
import { findStationMetaNear } from "./subway-stations";
import { subwayLineNameEn } from "./subway-line-names";

export function stationPlaceNameEn(
  place: Pick<Place, "id" | "name" | "category" | "lat" | "lng">,
): string | undefined {
  if (!stationLayoutKind(place)) return undefined;
  const m = /^(\S+역)(?:\s+(.+))?$/.exec(place.name.trim());
  if (!m) return undefined;
  const meta = findStationMetaNear(m[1], place.lat, place.lng);
  if (!meta?.nameEn) return undefined;
  // 괄호 부기명(`Cheonho (Pungnaptoseong)`)은 뺀다 — 한국어 POI 이름("천호역 5호선")에도 없고, 역 정보 줄이 싣는다.
  const base = meta.nameEn.replace(/\s*\([^)]*\)/g, "").trim();
  if (!base) return undefined;
  const station = /station$/i.test(base) ? base : `${base} Station`;
  if (!m[2]) return station;
  const line = subwayLineNameEn(m[2]);
  return line ? `${station}, ${line}` : undefined;
}
