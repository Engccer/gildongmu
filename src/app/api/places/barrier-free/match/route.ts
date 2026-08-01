import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coordParam } from "@/lib/coord-param";
import { hasDataGoKrKey } from "@/lib/env";
import { matchBarrierFreePlace } from "@/lib/providers/tour-barrier-free";

// 이 라우트만 한국 bbox로 좁힌다(매칭 대상이 국내 관광지뿐). 그 덕에 `Number("")===0`
// 함정의 행동 결함은 원래 없었지만, 범위를 넓히는 순간 되살아나므로 헬퍼로 통일한다.
const querySchema = z.object({
  lat: coordParam(33, 43),
  lng: coordParam(124, 132),
  name: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    name: request.nextUrl.searchParams.get("name") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ detail: null }); // 매칭 보조 — 잘못된 입력도 조용히 null
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ detail: null });
  try {
    const detail = await matchBarrierFreePlace(parsed.data);
    return NextResponse.json({ detail });
  } catch (e) {
    console.error("[api/places/barrier-free/match]", e);
    return NextResponse.json({ detail: null }); // 매칭 실패는 미노출(throw 아님)
  }
}
