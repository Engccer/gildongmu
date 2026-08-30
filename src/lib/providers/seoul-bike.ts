import type { BikeStation } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";
import { metersOutsideSeoul } from "../coverage";
import { readSeoulOpenJson } from "./seoul-open-json";
import { romanNameOf } from "../romanize";

/**
 * 서울 따릉이(공공자전거) provider — bikeList(OA-15493).
 *
 * bikeList는 좌표/반경 파라미터가 없어 전체(~2,720)를 페이지 루프로 받은 뒤
 * 서버에서 Haversine 정렬→1km cap→상위 5로 좁힌다(산술은 코드 책임).
 * envelope: rentBikeStatus.RESULT.CODE("INFO-000") + rentBikeStatus.row[].
 * list_total_count는 "전체 수"가 아니라 "그 페이지 row 수"라 종료 조건에 신뢰하지 않는다.
 */

type RawRow = Record<string, unknown>;

/** rentBikeStatus.row 배열을 안전 추출. */
export function parseBikeRows(raw: unknown): RawRow[] {
  const row = (raw as { rentBikeStatus?: { row?: unknown } })?.rentBikeStatus?.row;
  return Array.isArray(row) ? (row as RawRow[]) : [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 유한 실수 또는 NaN(파싱 불가 표식). */
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 음수·비유한 방어 후 반올림 정수(0 이상). */
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** bikeList 응답 → 거리 오름차순 BikeStation[]. 좌표 비유한이면 거리 Infinity(후미). */
export function parseBikeStations(
  raw: unknown,
  originLat: number,
  originLng: number,
): BikeStation[] {
  return parseBikeRows(raw)
    .map((it): BikeStation => {
      const lat = numF(it.stationLatitude);
      const lng = numF(it.stationLongitude);
      const finite = Number.isFinite(lat) && Number.isFinite(lng);
      return {
        stationId: str(it.stationId),
        name: str(it.stationName),
        nameRoman: romanNameOf(str(it.stationName)),
        lat,
        lng,
        distanceMeters: finite
          ? Math.round(haversineMeters(originLat, originLng, lat, lng))
          : Number.POSITIVE_INFINITY,
        racksTotal: nonNegInt(it.rackTotCnt),
        bikesAvailable: nonNegInt(it.parkingBikeTotCnt),
      };
    })
    .filter((s) => s.stationId)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

const BASE = "http://openapi.seoul.go.kr:8088";
const PAGE = 1000; // bikeList 1회 상한
const MAX_PAGES = 5; // 안전상한(~5,000건, 현재 전체 ~2,720)
const MAX_DISTANCE_METERS = 1000; // 도보권 cap
const TOP_N = 5;

/**
 * 이 좌표에서 따릉이 대여소가 **존재할 수 있는가**. false면 upstream 호출이 무의미하다.
 *
 * 따릉이는 서울시 사업이라 대여소가 서울 안에만 있다(2026-08-02 전량 실측 2,743개소:
 * lat 37.431~37.691 · lng 126.799~127.181). 따라서 서울 bbox에서 조회 반경만큼
 * 벗어나면 대여소가 반경에 들어올 수 없고, 이는 "지금 근처에 없다"가 아니라
 * "이 지역에는 서비스가 없다"다 — 둘을 뭉개면 부산 사용자가 반경을 넓히거나
 * 나중에 다시 볼 여지를 상상하게 된다(3-state 불변식).
 *
 * ⚠ 판정선은 `MAX_DISTANCE_METERS`를 그대로 쓴다. 상수를 바꾸면 판정도 함께
 * 움직여야 하므로 값을 복제하지 말 것.
 */
export function isBikeServiceArea(lat: number, lng: number): boolean {
  return metersOutsideSeoul(lat, lng) <= MAX_DISTANCE_METERS;
}

/**
 * bikeList 한 페이지를 호출하고 정상 envelope를 반환한다.
 * RESULT.CODE가 INFO-000이 아니거나 rentBikeStatus가 없으면 throw
 * (라우트가 502로 변환 — "조회 실패"와 "정보 없음"을 구분).
 */
async function fetchBikePage(start: number, end: number): Promise<unknown> {
  const key = env.SEOUL_OPEN_DATA_KEY!;
  const url = `${BASE}/${key}/json/bikeList/${start}/${end}/`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`bikeList HTTP ${res.status}`);
  // res.json() 직접 호출 금지 — 무효 키는 200 + XML로 와서 원인 없는 SyntaxError가 된다.
  const data = (await readSeoulOpenJson(res, "bikeList")) as {
    rentBikeStatus?: { RESULT?: { CODE?: string } };
  };
  const status = data?.rentBikeStatus;
  if (!status) throw new Error("bikeList 비정상 응답(rentBikeStatus 없음)");
  // INFO-000만 정상으로 허용. RESULT/CODE 부재(비정상 응답)·기타 코드는 모두 throw.
  // 따릉이는 빈 결과도 INFO-000 + row:[]로 오므로(TAGO의 NODATA 통과와 다름) 안전하다.
  const code = status.RESULT?.CODE ?? null;
  if (code !== "INFO-000") throw new Error(`bikeList ${code ?? "RESULT.CODE 없음"}`);
  return data;
}

/**
 * 좌표 → 1km 이내 근접 따릉이 대여소 상위 5(거리순).
 * 키 없으면 빈 배열(라우트 게이트로 사실상 미도달, 방어적).
 * 전체를 페이지 루프로 모은 뒤에야 정렬·cap(부분집합 슬라이스 금지).
 */
export async function fetchNearbyBikeStations(
  lat: number,
  lng: number,
): Promise<BikeStation[]> {
  if (!env.SEOUL_OPEN_DATA_KEY) return [];
  let all: BikeStation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE + 1;
    const end = start + PAGE - 1;
    const raw = await fetchBikePage(start, end);
    const rowCount = parseBikeRows(raw).length;
    all = all.concat(parseBikeStations(raw, lat, lng));
    if (rowCount < PAGE) break; // 받은 row 수 < 요청 크기 = 마지막 페이지(list_total_count 불신)
  }
  return all
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((s) => s.distanceMeters <= MAX_DISTANCE_METERS)
    .slice(0, TOP_N);
}
