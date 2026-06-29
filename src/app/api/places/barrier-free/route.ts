import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ places: [] });
  try {
    const places = await searchBarrierFreeNearby(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ places });
  } catch (e) {
    console.error("[api/places/barrier-free]", e);
    return NextResponse.json({ error: "무장애 여행 정보 조회 실패" }, { status: 502 });
  }
}
