import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import {
  findNightClinicsNear,
  clinicOpenStatus,
  dayToHoursIndex,
} from "@/lib/providers/night-clinic";

/**
 * GET /api/clinic/nearby?lat=..&lng=..
 * 내 주변 소아 야간·휴일 진료(달빛어린이병원·소아전문센터, B1).
 *
 * 좌표 → 전국 목록 Haversine 정렬 → 반경 내 상위 N. 각 기관에 "지금 진료 상태"를
 * 서버 KST 기준으로 계산해 덧붙인다(클라 시계 신뢰 대신 서버 시각 — 단 자정 경계
 * 표시는 조회 시점 기준). **공휴일 자동판정은 V1 비포함**(한국 공휴일=음력 포함
 * 비결정적 → 가짜 판정 금지). 오늘 요일 기준으로만 open/closed/unknown 산출.
 *
 * 키 없음 → { clinics: [] }(canShowClinic 게이트와 이중 방어).
 * upstream 장애 → 502("조회 실패"와 "근처에 없음"을 구분 — 의료 정보 정본).
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
});

/** 서버 UTC → KST(+9) 기준 요일 index(0=월..6=일)와 HHMM. */
function kstNow(): { hoursIndex: number; hhmm: number } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  return { hoursIndex: dayToHoursIndex(kst.getUTCDay()), hhmm };
}

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
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ clinics: [] });
  }
  try {
    const near = await findNightClinicsNear(parsed.data.lat, parsed.data.lng);
    const { hoursIndex, hhmm } = kstNow();
    const clinics = near.map((c) => ({
      ...c,
      openStatus: clinicOpenStatus(c.hours, hoursIndex, hhmm),
    }));
    return NextResponse.json({ clinics });
  } catch (e) {
    console.error("[api/clinic/nearby]", e);
    return NextResponse.json(
      { error: "소아 야간·휴일 진료 정보 조회 실패" },
      { status: 502 },
    );
  }
}
