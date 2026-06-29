import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { getBarrierFreeDetail } from "@/lib/providers/tour-barrier-free";

const querySchema = z.object({ contentId: z.string().min(1) });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    contentId: request.nextUrl.searchParams.get("contentId") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "contentId가 필요합니다." }, { status: 400 });
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ detail: null });
  try {
    const detail = await getBarrierFreeDetail(parsed.data.contentId);
    return NextResponse.json({ detail });
  } catch (e) {
    console.error("[api/places/barrier-free/detail]", e);
    return NextResponse.json({ error: "무장애 편의시설 조회 실패" }, { status: 502 });
  }
}
