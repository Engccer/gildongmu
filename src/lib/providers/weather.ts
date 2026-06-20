/**
 * 이 지역 날씨 provider — 기상청 단기예보 API(data.go.kr 15084084).
 *
 * 2-오퍼레이션 체인: WGS84→격자(LCC) 변환 → 초단기실황(getUltraSrtNcst, 현재
 * 실측 기온·습도·강수형태) + 단기예보(getVilageFcst, 하늘상태·최고최저·강수확률).
 * 인증: data.go.kr serviceKey(`DATA_GO_KR_API_KEY`, 공기질/버스와 동일 키).
 *
 * 정본 원칙(설계 `docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md`):
 * - 격자 변환은 기상청 공식 LCC 알고리즘(자체 파라미터라 표준 EPSG 없음 — 직접 이식).
 * - 상태 단어(하늘상태/강수형태)가 낭독 정본, 수치는 보강. 미매핑 코드 → unknown.
 * - upstream 장애 → throw → 502. 무데이터·미커버 → null(graceful). mock 폴백 없음.
 * - 부분 성공 보존: 실황·예보를 allSettled 독립 처리, 둘 다 실패해야 throw.
 */

import type { PrecipLabel, SkyLabel, Weather } from "../types";
import { env } from "../env";

/** 기상청 격자 변환 상수(공식 dfs_xy_conv). */
const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0; // 격자 간격(km)
const SLAT1 = 30.0; // 표준 위도 1
const SLAT2 = 60.0; // 표준 위도 2
const OLON = 126.0; // 기준점 경도
const OLAT = 38.0; // 기준점 위도
const XO = 43; // 기준점 격자 X
const YO = 136; // 기준점 격자 Y

/** WGS84(위도, 경도) → 기상청 격자(nx, ny). 순수·결정적(Lambert 정각원추). */
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
    Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}
