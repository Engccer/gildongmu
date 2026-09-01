import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasCarRouteKey, hasNcpMapsKeys } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { langParam } from "@/lib/lang-param";
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
  // 경유지 1개(N4): 누락=없음. 형식 오류는 400(조용한 무시 금지, walk 동형).
  via: coordSchema.nullable().transform((v) => v ?? undefined),
  // 폴리라인 옵트인(B1 실시간 자동차 안내). 누락 또는 정확히 "1"만 — 그 외 값은
  // 400으로 거절해 옵트인을 조용히 무시하지 않는다(walk 라우트 동형).
  includeGeometry: z
    .union([z.literal("1"), z.null()])
    .transform((v) => v === "1"),
  // 안내 문장 언어(E27 계약, 2026-09-02 통일): 누락=ko, 그 외는 정확히 ko/en만. 종전엔
  // `=== "en"` 문자열 비교라 `EN`·`eng`가 조용히 한국어로 떨어졌다 — 그 응답은 `guidanceLang: "ko"`가
  // 실려 폴백처럼 보이지만 실제로는 요청이 틀린 것이라, 400이 정직하다.
  lang: langParam(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
    via: request.nextUrl.searchParams.get("via"),
    includeGeometry: request.nextUrl.searchParams.get("includeGeometry"),
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

  // en + NCP 키가 있으면 영문 턴바이턴, 아니면 car-route 서비스(ko)로 폴백.
  // 경유지(N4)는 NCP 경로 미검증이라 ko 서비스로 보낸다 — 조용히 버리는 것보다
  // 한국어 문장이 낫다. 기하 요청(`includeGeometry`, 실시간 자동차 안내)도 같다 — NCP 응답엔
  // 기하·`provider`·`terminalCoord`가 없어 클라이언트가 상세 안내를 세우지 못하고 간략(직선)으로
  // 강등된다(리뷰 검출 2026-08-31: iOS en 사용자의 자동차 안내가 문장 없는 직선이 됐다).
  // 폴백 사유 셋(키 부재·경유지·기하)은 전부 `guidanceLang: "ko"`로 응답에 드러난다.
  // 여기서 가르므로 아래 키 게이트도 ko 서비스 기준으로 돈다.
  const useNcp =
    parsed.data.lang === "en" &&
    hasNcpMapsKeys() &&
    !via &&
    !parsed.data.includeGeometry;
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
    // en(NCP) 경로는 기하·경유지 미지원 — 그 둘은 위에서 ko 서비스로 갈렸다.
    const briefing = useNcp
      ? await getCarRouteBriefingEn({ origin, dest })
      : await getCarRoute({
          origin,
          dest,
          includeGeometry: parsed.data.includeGeometry,
          via,
        });
    // 안내문 언어 마커(A26): ko 폴백은 위 판정 그대로 두고, 그 결과만 응답에 싣는다 —
    // en 화면이 한국어 문장을 받았을 때 `lang="ko"`로 정직하게 표기할 유일한 근거.
    return NextResponse.json({ ...briefing, guidanceLang: useNcp ? "en" : "ko" });
  } catch (e) {
    console.error("[api/route/car] 경로 브리핑 실패:", e);
    // 경로 탐색 실패(result_code != 0)는 사용자 입력에 가까운 문제라 메시지를 전달.
    // `code`는 로케일 소비자(웹 카드)가 자기 언어 문장을 고르는 키 — `error`는 CLI/MCP 계약 유지.
    const noRoute = e instanceof Error && e.message.includes("경로 탐색 실패");
    const message = noRoute
      ? "경로를 찾지 못했습니다. 출발지와 목적지를 확인해 주세요."
      : "경로 브리핑에 실패했습니다.";
    return NextResponse.json(
      { error: message, ...(noRoute ? { code: "noRoute" } : {}) },
      { status: 502 },
    );
  }
}
