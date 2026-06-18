import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasOdsayKey } from "@/lib/env";
import { isInKorea } from "@/lib/deeplink";
import { getTransitRoute } from "@/lib/providers/odsay";

/**
 * 대중교통 길찾기 프록시(ODsay). 좌표는 "위도,경도" 순서(도메인 표준).
 *
 * 3-state 응답(설계 §I5): 경로 없음과 조회 실패를 뭉개지 않는다.
 * - 입력 오류(좌표 범위 밖) → 400
 * - 경로 없음(graceful) → 200 { result: null }
 * - upstream 장애 → 502
 * 실데이터만 의미 있으므로 mock 폴백 없음(키 없으면 503, 단 게이트로 호출 자체가 안 옴).
 */

const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => isInKorea(c.lat, c.lng), "좌표가 한반도 권역을 벗어남");

const querySchema = z.object({ origin: coordSchema, dest: coordSchema });

export async function GET(request: NextRequest) {
  if (!hasOdsayKey()) {
    return NextResponse.json(
      { error: "대중교통 길찾기는 API 키 등록 후 사용할 수 있습니다." },
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
    const result = await getTransitRoute(parsed.data);
    // null = 경로 없음(graceful). 컴포넌트가 "찾지 못함"으로 표시.
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[api/route/transit] 길찾기 실패:", e);
    return NextResponse.json(
      { error: "대중교통 길찾기에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
