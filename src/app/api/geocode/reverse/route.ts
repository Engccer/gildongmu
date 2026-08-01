import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasKakaoKey, hasNcpMapsKeys } from "@/lib/env";
import { coordToAddress } from "@/lib/providers/kakao-address";
import { reverseRoadAddress } from "@/lib/providers/ncp-geocode";

/**
 * 좌표 → 대표 주소 문자열 (역지오코딩) 프록시.
 *
 * "현재 위치" 라벨 주소 병기용(길찾기 F-B). where-am-i는 4조각 합성이라 과해서
 * 대표 주소 한 문자열만 주는 경량 라우트를 둔다.
 *
 * 도로명 우선 선택 체인(2026-07-22 위원장 피드백 — 도로명 우선 보장 강화):
 * 1. 카카오 coord2address의 road_address — 정본.
 * 2. road_address가 null인 지점(좌표가 도로명주소 건물에 매핑 안 됨)은
 *    NCP 역지오코딩(reverseRoadAddress)의 최근접 도로명으로 폴백.
 *    NCP 실패·무결과는 조용히 다음 단계로(try/catch로 삼킴 — best-effort 보조).
 * 3. 카카오 jibun_address — 정직한 최후 폴백(지번).
 *
 * 3-state:
 * - 매칭 없음은 성공 응답의 `address: null`(정보 없음).
 * - upstream(카카오) 실패는 502(조회 실패) — 소비자는 주소가 부가 정보이므로 조용히 병기 생략.
 */

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
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
    let roadAddress = address?.roadAddress;

    if (!roadAddress && hasNcpMapsKeys()) {
      try {
        roadAddress = (await reverseRoadAddress(parsed.data)) ?? undefined;
      } catch (e) {
        console.error("[api/geocode/reverse] NCP 도로명 폴백 실패:", e);
      }
    }

    const display = roadAddress ?? address?.jibunAddress ?? null;
    return NextResponse.json({ address: display });
  } catch (e) {
    console.error("[api/geocode/reverse] 좌표→주소 변환 실패:", e);
    return NextResponse.json(
      { error: "주소 변환에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
