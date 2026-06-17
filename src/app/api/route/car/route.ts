import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey, hasNcpMapsKeys } from "@/lib/env";
import { isInKorea } from "@/lib/deeplink";
import { getCarRouteBriefing } from "@/lib/providers/kakao-navi";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";

/**
 * 자동차 경로 텍스트 브리핑 프록시.
 *
 * 좌표 파라미터는 도메인 표준대로 "위도,경도" 순서를 받는다.
 * 경로 브리핑은 실데이터만 의미가 있으므로 mock 폴백이 없다 —
 * 어떤 provider도 못 쓰면 503으로 정직하게 알린다 (가짜 실데이터 금지 원칙).
 *
 * provider 디스패치(lang+키 유무):
 * - lang=en + NCP 키 → NCP Directions(영문 턴바이턴, 외국인 정본)
 * - 그 외(ko, 또는 en이지만 NCP 키 없음) → 카카오모빌리티(한국어, 현 동작 graceful)
 * 두 provider 모두 동일한 CarRouteBriefing shape를 반환해 컴포넌트는 불변이다.
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
  // en + NCP 키가 있으면 영문 턴바이턴, 아니면 카카오 한국어로 폴백
  const useNcp =
    request.nextUrl.searchParams.get("lang") === "en" && hasNcpMapsKeys();
  if (!useNcp && !hasKakaoKey()) {
    return NextResponse.json(
      { error: "경로 브리핑은 API 키 등록 후 사용할 수 있습니다." },
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
    const briefing = useNcp
      ? await getCarRouteBriefingEn(parsed.data)
      : await getCarRouteBriefing(parsed.data);
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
