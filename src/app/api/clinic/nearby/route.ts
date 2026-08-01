import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasDataGoKrKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { findNightClinicsNow } from "@/lib/clinics";

/**
 * GET /api/clinic/nearby?lat=..&lng=..
 * 내 주변 소아 야간·휴일 진료(달빛어린이병원·소아전문센터, B1).
 *
 * 좌표 → 전국 목록 Haversine 정렬 → 반경 내 **진료중 우선** 상위 N. 각 기관의
 * "지금 진료 상태"는 서버 KST 기준으로 계산한다(클라 시계 신뢰 대신 서버 시각 —
 * 단 자정 경계 표시는 조회 시점 기준). **공휴일은 특일정보(15012690)로 판정**해
 * dutyTime8 칸을 읽고, 판정 불가(키 없음·미신청·실패)면 요일로 폴백하며 어느
 * 기준이었는지 `basis`로 밝힌다(가짜 판정 금지 — 지하철 시간표와 동형).
 *
 * `total`은 반경 내 전체 수(절단 전) — UI가 "N곳 중 M곳"을 밝혀 침묵 절단을 막는다.
 *
 * 키 없음 → { clinics: [] }(canShowClinic 게이트와 이중 방어).
 * upstream 장애 → 502("조회 실패"와 "근처에 없음"을 구분 — 의료 정보 정본).
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
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
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ clinics: [] });
  }
  try {
    // 병합 결과를 그대로 투영 — 소스 구분(designated)·절단(total)·보완 실패
    // (supplementFailed)를 UI가 밝힐 수 있도록 필드를 숨기지 않는다.
    const result = await findNightClinicsNow(parsed.data.lat, parsed.data.lng);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/clinic/nearby]", e);
    return NextResponse.json(
      { error: "소아 야간·휴일 진료 정보 조회 실패" },
      { status: 502 },
    );
  }
}
