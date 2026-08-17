import { NextRequest, NextResponse } from "next/server";
import { searchPlaces } from "@/lib/providers/places";
import { parsePlacesQuery } from "./query-schema";

/**
 * 장소 검색 프록시.
 *
 * 클라이언트는 이 라우트만 호출한다 — 네이버 API Secret은 서버에만 존재하고,
 * openapi.naver.com은 브라우저 CORS도 허용하지 않으므로 프록시가 필수다.
 * 쿼리 계약(좌표 처리·sort 축)은 `query-schema.ts`가 정본이다.
 */
export async function GET(request: NextRequest) {
  const parsed = parsePlacesQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    const result = await searchPlaces(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    // 리뷰순 키 부재 throw도 여기로 온다(spec §3.1 — 새 상태 코드·마커 없음).
    console.error("[api/places] 검색 실패:", e);
    return NextResponse.json(
      { error: "장소 검색에 실패했습니다." },
      { status: 502 },
    );
  }
}
