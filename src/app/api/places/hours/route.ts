import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { isInKorea } from "@/lib/coverage";
import { hasGooglePlacesKey } from "@/lib/env";
import { getPlaceHoursToday } from "@/lib/providers/google-places";

export const dynamic = "force-dynamic";

/**
 * 장소 상세 영업시간 한 줄(E24). 매칭 보조 라우트라 **어떤 실패도 `{hours:null}`**(무장애
 * `match` 동형) — 키 없음·한국 밖·매칭 실패·부재·429·타임아웃을 소비자는 구분하지 않고
 * 줄을 만들지 않는다. 소비자는 웹·iOS 장소 상세뿐(spec §1 — 채팅·CLI/MCP·내 주변 재도입 금지).
 */
const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
  name: z.string().min(1),
  roadAddress: z.string().optional(),
});

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
/** null 본문까지 no-store — iOS URLCache가 매칭 실패를 잠깐 고착시키지 않게 전 경로 공통. */
function silent() {
  return NextResponse.json({ hours: null }, NO_STORE);
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    lat: q.get("lat") ?? "",
    lng: q.get("lng") ?? "",
    name: q.get("name") ?? "",
    roadAddress: q.get("roadAddress") ?? undefined,
  });
  if (!parsed.success) return silent();
  const { lat, lng } = parsed.data;
  if (!isInKorea(lat, lng) || !hasGooglePlacesKey()) return silent();
  try {
    const hours = await getPlaceHoursToday(parsed.data);
    return NextResponse.json({ hours }, NO_STORE);
  } catch (e) {
    console.error("[api/places/hours]", e);
    return silent();
  }
}
