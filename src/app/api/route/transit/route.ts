import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasOdsayKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { langParam } from "@/lib/lang-param";
import { getTransitRoute } from "@/lib/providers/odsay";

/**
 * 대중교통 길찾기 프록시(ODsay). 좌표는 "위도,경도" 순서(도메인 표준).
 *
 * 3-state 응답(설계 §I5): 경로 없음과 조회 실패를 뭉개지 않는다.
 * - 입력 오류(형식·전지구 범위 밖) → 400
 * - 한국 밖(출발·도착 어느 한쪽이든) → 200 { outOfCoverage: true } 마커
 * - 경로 없음(graceful) → 200 { result: null }
 * - upstream 장애 → 502
 * 실데이터만 의미 있으므로 mock 폴백 없음(키 없으면 503, 단 게이트로 호출 자체가 안 옴).
 */

const querySchema = z.object({
  origin: coordSchema,
  dest: coordSchema,
  // 경유지 1개(N4): 누락=없음. 형식 오류는 400(조용한 무시 금지, walk 동형).
  via: coordSchema.nullable().transform((v) => v ?? undefined),
  // 경유 정류장 옵트인(B2 §7, walk includeGeometry 선례): "1"만 허용, 그 외 400.
  // 미지정 응답은 기존과 byte-호환(stops 키 자체 부재).
  includeStops: z.union([z.literal("1"), z.null()]),
  // 응답 언어(E27): en이면 ODsay `lang=1`로 영문을 받아 `*En`에 additive로 싣는다. 한국어 필드는
  // 어느 응답에서도 그대로(조인 키). 미지정·ko는 종전과 byte-identical(CLI/MCP 무변화).
  lang: langParam(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
    via: request.nextUrl.searchParams.get("via"),
    includeStops: request.nextUrl.searchParams.get("includeStops"),
    lang: request.nextUrl.searchParams.get("lang"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  const { origin, dest, via } = parsed.data;
  if (
    !isInKorea(origin.lat, origin.lng) ||
    !isInKorea(dest.lat, dest.lng) ||
    (via && !isInKorea(via.lat, via.lng))
  ) {
    return NextResponse.json({ outOfCoverage: true });
  }

  // ODsay에 경유지가 없다(N4). `result: null`만 주면 "경로 없음"으로 낭독돼 거짓이라
  // 마커로 가른다(outOfCoverage·unavailableHere와 같은 층의 정직 상태). upstream 미호출.
  if (via) {
    return NextResponse.json({ result: null, unsupported: "waypoint" });
  }

  if (!hasOdsayKey()) {
    return NextResponse.json(
      { error: "대중교통 길찾기는 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  try {
    const result = await getTransitRoute({
      origin: parsed.data.origin,
      dest: parsed.data.dest,
      includeStops: parsed.data.includeStops === "1",
      lang: parsed.data.lang,
    });
    // null = 경로 없음(graceful). 컴포넌트가 "찾지 못함"으로 표시.
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[api/route/transit] 길찾기 실패:", e);
    // 꼬리 문장 금지: 실패에 재시도 권유는 자명(SR 통지 정리 판정선 2026-08-02).
    return NextResponse.json(
      { error: "대중교통 길찾기에 실패했습니다." },
      { status: 502 },
    );
  }
}
