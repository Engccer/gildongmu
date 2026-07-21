import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { coordToAddress } from "@/lib/providers/kakao-address";

/**
 * 좌표 → 대표 주소 문자열 (역지오코딩) 프록시 — 카카오 coord2address.
 *
 * "현재 위치" 라벨 주소 병기용(길찾기 F-B). where-am-i는 4조각 합성이라 과해서
 * 대표 주소 한 문자열만 주는 경량 라우트를 둔다. 3-state:
 * - 매칭 없음은 성공 응답의 `address: null`(정보 없음).
 * - upstream 실패는 502(조회 실패) — 소비자는 주소가 부가 정보이므로 조용히 병기 생략.
 */

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export async function GET(request: NextRequest) {
  if (!hasKakaoKey()) {
    return NextResponse.json(
      { error: "주소 변환은 카카오 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 좌표" }, { status: 400 });
  }

  try {
    const address = await coordToAddress(parsed.data);
    return NextResponse.json({ address: address?.display ?? null });
  } catch (e) {
    console.error("[api/geocode/reverse] 좌표→주소 변환 실패:", e);
    return NextResponse.json(
      { error: "주소 변환에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
