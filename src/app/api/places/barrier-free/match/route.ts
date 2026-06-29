import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { matchBarrierFreePlace } from "@/lib/providers/tour-barrier-free";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
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
