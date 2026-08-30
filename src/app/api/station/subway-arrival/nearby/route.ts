import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { langParam } from "@/lib/lang-param";
import { hasSeoulSubwayRealtimeKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import {
  fetchNearbySubwayArrivals,
  findNearestStationInfo,
} from "@/lib/providers/subway-nearby";

/**
 * GET /api/station/subway-arrival/nearby?lat=..&lng=..
 * 내 주변 서울 지하철역 실시간 도착(A2 홈 진입점) — 좌표→근접역→역별 실시간 합성.
 *
 * 키 없음 → { stations: [] }(canShowSubway 게이트와 이중 방어).
 * 부분 실패는 provider가 역별 arrivalStatus로 흡수 → 200. 전부 실패만 502.
 * 실시간이라 캐시하지 않는다(provider fetch no-store + dynamic).
 *
 * 좌표는 전지구 범위로 형식만 가드하고, 한국 밖은 커버리지 마커로 응답한다
 * (버스/따릉이 nearby 라우트와 통일).
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
  // `lang=en`은 노선·도착 영문 필드를 additive로 싣는다(E27). 미지정·ko는 종전과 byte-identical.
  lang: langParam(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    lang: request.nextUrl.searchParams.get("lang"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasSeoulSubwayRealtimeKey()) {
    return NextResponse.json({ stations: [] });
  }
  try {
    const stations = await fetchNearbySubwayArrivals(parsed.data.lat, parsed.data.lng, parsed.data.lang);
    // 0건이면 최근접 역을 동봉 — "1km 안에 없다"와 "이 지역엔 도시철도가 없다"를
    // 사용자가 거리로 구분한다(seed 조회라 추가 네트워크 0).
    if (stations.length === 0) {
      const nearest = findNearestStationInfo(parsed.data.lat, parsed.data.lng, parsed.data.lang);
      if (nearest) return NextResponse.json({ stations, nearest });
    }
    return NextResponse.json({ stations });
  } catch (e) {
    console.error("[api/station/subway-arrival/nearby]", e);
    return NextResponse.json({ error: "지하철 도착 정보 조회 실패" }, { status: 502 });
  }
}
