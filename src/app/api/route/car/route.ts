import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/deeplink";
import { getCarRouteBriefing } from "@/lib/providers/kakao-navi";

/**
 * 자동차 경로 텍스트 브리핑 프록시 (카카오모빌리티 directions).
 *
 * 좌표 파라미터는 도메인 표준대로 "위도,경도" 순서를 받는다.
 * 경로 브리핑은 실데이터만 의미가 있으므로 mock 폴백이 없다 —
 * 카카오 키가 없으면 503으로 정직하게 알린다 (가짜 실데이터 금지 원칙).
 */

const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => isInKorea(c.lat, c.lng), "좌표가 한반도 권역을 벗어남");

const querySchema = z.object({
  origin: coordSchema,
  dest: coordSchema,
});

export async function GET(request: NextRequest) {
  if (!hasKakaoKey()) {
    return NextResponse.json(
      { error: "경로 브리핑은 카카오 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

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

  try {
    const briefing = await getCarRouteBriefing(parsed.data);
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
