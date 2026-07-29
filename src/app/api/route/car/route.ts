import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasCarRouteKey, hasNcpMapsKeys } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { checkCarRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getCarRoute } from "@/lib/car-route";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";

/**
 * 자동차 경로 텍스트 브리핑 프록시.
 *
 * 좌표 파라미터는 도메인 표준대로 "위도,경도" 순서를 받는다.
 * 좌표는 전지구 범위로 형식만 가드하고, 출발·도착 어느 한쪽이든 한국 밖이면
 * 200 { outOfCoverage: true } 마커로 응답한다(nearby 라우트와 통일).
 * 경로 브리핑은 실데이터만 의미가 있으므로 mock 폴백이 없다 —
 * 어떤 provider도 못 쓰면 503으로 정직하게 알린다 (가짜 실데이터 금지 원칙).
 *
 * provider 디스패치(lang+키 유무):
 * - lang=en + NCP 키 → NCP Directions(영문 턴바이턴, 외국인 정본)
 * - 그 외(ko, 또는 en이지만 NCP 키 없음) → car-route.ts 서비스
 *   (기본 Tmap, Tmap 실패 시 카카오모빌리티 폴백 — 2026-07-30 전환)
 * 두 provider 모두 동일한 CarRouteBriefing shape를 반환해 컴포넌트는 불변이다.
 * 기본 Tmap도 일 1,000건 무료 쿼터를 도보 경로와 공유하는 유료 API라
 * 도보 라우트와 동일한 IP 레이트리밋(60초 10회)으로 호출 *전*에 비용을 방어한다.
 */

const querySchema = z.object({
  origin: coordSchema,
  dest: coordSchema,
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  const { origin, dest } = parsed.data;
  if (!isInKorea(origin.lat, origin.lng) || !isInKorea(dest.lat, dest.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }

  // en + NCP 키가 있으면 영문 턴바이턴, 아니면 car-route 서비스(ko)로 폴백
  const useNcp =
    request.nextUrl.searchParams.get("lang") === "en" && hasNcpMapsKeys();
  if (!useNcp && !hasCarRouteKey()) {
    return NextResponse.json(
      { error: "경로 브리핑은 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  if (!checkCarRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  try {
    const briefing = useNcp
      ? await getCarRouteBriefingEn(parsed.data)
      : await getCarRoute(parsed.data);
    return NextResponse.json(briefing);
  } catch (e) {
    console.error("[api/route/car] 경로 브리핑 실패:", e);
    // 경로 탐색 실패(result_code != 0)는 사용자 입력에 가까운 문제라 메시지를 전달
    const message =
      e instanceof Error && e.message.includes("경로 탐색 실패")
        ? "경로를 찾지 못했습니다. 출발지와 목적지를 확인해 주세요."
        : "경로 브리핑에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
