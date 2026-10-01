import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { isInKorea } from "@/lib/coverage";
import { hasKakaoKey } from "@/lib/env";
import { checkWalkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getWalkProbe } from "@/lib/walk-probe";

/**
 * GET /api/walk/probe?lat&lng&bearing — 나들이 카카오 도보 탐침(E58 ①③, spec 2026-09-26 §6.6).
 * 진행 방위로 180m 앞까지 도보 경로를 묻고 횡단보도·회전 지점만 돌려준다.
 *
 * ⚠ 결과는 저장하지 않는다(카카오 약관 — `walk-probe.ts` 머리말): 이 라우트는 동적(`force-dynamic`)이고 응답에
 * `Cache-Control: no-store`를 단다. 3-state: 입력 오류 400 · 한국 밖 200 `{outOfCoverage:true}`(upstream 미호출) ·
 * 카카오 키 없음 404(탐침은 카카오만 부른다 — Tmap 폴백 없음, `walk-probe.ts`) · 경로 없음 200 빈 목록 · 조회 실패 502.
 * 요청 한도는 도보 경로와 같은 통.
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
  bearing: z.coerce.number().min(0).max(360),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    // `Number("")===0`이라 누락이 정북(0)으로 위장한다 — 빈 값은 NaN으로 보내 400이 되게 한다.
    bearing: request.nextUrl.searchParams.get("bearing") || "NaN",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
  }
  const { lat, lng, bearing } = parsed.data;
  if (!isInKorea(lat, lng)) return NextResponse.json({ outOfCoverage: true }, { headers: NO_STORE });
  if (!hasKakaoKey()) {
    return NextResponse.json({ error: "도보 경로를 조회할 수 없습니다." }, { status: 404, headers: NO_STORE });
  }
  if (!checkWalkRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: NO_STORE },
    );
  }
  try {
    const probe = await getWalkProbe(lat, lng, bearing);
    return NextResponse.json({ probe }, { headers: NO_STORE });
  } catch (e) {
    // upstream 오류 본문에 좌표가 섞일 수 있어 소수 셋째 자리 이상 숫자를 가린다(결과 비저장 계약 — 로그도 저장이다).
    console.error("[walk-probe] 조회 실패:", String(e instanceof Error ? e.message : e).replace(/\d+\.\d{3,}/g, "…"));
    return NextResponse.json({ error: "도보 경로 조회에 실패했습니다." }, { status: 502, headers: NO_STORE });
  }
}
