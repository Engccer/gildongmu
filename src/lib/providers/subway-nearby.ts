import type { NearbySubwayStation, SubwayStationArrivals } from "../types";
import { hasSeoulSubwayRealtimeKey } from "../env";
import { findStationsNear, findStationMeta } from "../subway-stations";
import { cleanName, fetchSubwayArrivals } from "./seoul-subway-arrival";

/**
 * 내 주변 서울 지하철 실시간 도착(A2 홈 진입점) — 좌표→근접역→역별 실시간 합성.
 *
 * 버스/따릉이 nearby는 좌표를 그대로 API에 넘기지만(A-2/bikeList), 서울 지하철
 * 실시간(OA-12764)은 **역명** 기반이라 좌표를 직접 못 쓴다. 그래서
 *   1) A3 정적 seed(findStationsNear, Haversine)로 반경 내 근접역을 거리순으로 식별,
 *   2) 각 역명으로 실시간 도착(fetchSubwayArrivals)을 병렬 조회,
 *   3) 부분 실패를 BusStop.arrivalStatus와 동형으로 투영(buildNearbyArrivals).
 *
 * 순수 로직(buildNearbyArrivals)과 seed+fetch 합성(fetchNearbySubwayArrivals)을
 * 분리해, 부분/전체 실패 불변식을 seed·네트워크 없이 결정적으로 테스트한다.
 */

/** 근접 탐색 반경(m) — 도보 권역. 따릉이 1km cap과 동일 기준. */
const RADIUS_METERS = 1000;
/** 조회 역 수 상한 — 역마다 실시간 1콜이라 쿼터(1,000/일) 보호 + 미니멀 표시. */
const LIMIT = 3;

/** buildNearbyArrivals 입력 한 건 — seed 메타 + settled 실시간 결과. */
export interface NearbyArrivalInput {
  /** seed 역명(표시 전 cleanName 처리됨) */
  name: string;
  /** 영문 역명(seed 메타, 없을 수 있음) */
  nameEn?: string;
  /** 노선들(seed 메타 집계) */
  lines: string[];
  /** 현재 위치로부터 거리(m) */
  distanceMeters: number;
  /** 역별 실시간 도착 조회의 settled 결과(null=미커버 역) */
  result: PromiseSettledResult<SubwayStationArrivals | null>;
}

/**
 * settled 실시간 결과를 역별 표시 모델로 투영(순수).
 * - fulfilled & 값 있음 → arrivalStatus "ok", arrivals 정본.
 * - fulfilled & null   → 미커버 역(비서울 등) → 제외(섹션에서 숨김).
 * - rejected           → arrivalStatus "unavailable"(일시 장애, "열차 없음"과 구분).
 *
 * **전부 실패(시도한 역이 모두 rejected)면 throw** — 일시 장애를 빈 결과로
 * 위장하지 않는다(라우트가 502로 변환, seoul-subway-arrival 정본 원칙 동형).
 * 시도가 전부 null(비서울)이면 정상적 빈 배열(graceful degrade).
 */
export function buildNearbyArrivals(
  inputs: NearbyArrivalInput[],
): NearbySubwayStation[] {
  const stations: NearbySubwayStation[] = [];
  let attempted = 0;
  let failed = 0;
  for (const it of inputs) {
    const base = {
      stationName: cleanName(it.name),
      nameEn: it.nameEn,
      lines: it.lines,
      distanceMeters: Math.round(it.distanceMeters),
    };
    if (it.result.status === "fulfilled") {
      if (it.result.value === null) continue; // 미커버 역 — 숨김
      attempted += 1;
      stations.push({ ...base, arrivalStatus: "ok", arrivals: it.result.value.arrivals });
    } else {
      attempted += 1;
      failed += 1;
      stations.push({ ...base, arrivalStatus: "unavailable", arrivals: [] });
    }
  }
  if (attempted > 0 && failed === attempted) {
    throw new Error("서울 지하철 실시간 도착 근접 조회 전부 실패");
  }
  return stations;
}

/**
 * 좌표 근접 서울 지하철역들의 실시간 도착을 합성한다.
 * - 키 없음/근접역 없음 → 빈 배열(graceful, canShowSubway 게이트와 이중 방어).
 * - 부분 실패 → 해당 역만 unavailable, 나머지 실데이터 보존.
 * - 전부 실패 → throw(라우트 502).
 */
export async function fetchNearbySubwayArrivals(
  lat: number,
  lng: number,
): Promise<NearbySubwayStation[]> {
  if (!hasSeoulSubwayRealtimeKey()) return [];
  const near = findStationsNear(lat, lng, {
    radiusMeters: RADIUS_METERS,
    limit: LIMIT,
    dedupeByName: true,
  });
  if (near.length === 0) return [];
  const settled = await Promise.allSettled(
    near.map((s) => fetchSubwayArrivals(s.name)),
  );
  const inputs: NearbyArrivalInput[] = near.map((s, i) => {
    const meta = findStationMeta(s.name);
    return {
      name: s.name,
      nameEn: meta?.nameEn,
      lines: meta?.lines ?? [s.lineName],
      distanceMeters: s.distanceMeters,
      result: settled[i],
    };
  });
  return buildNearbyArrivals(inputs);
}
