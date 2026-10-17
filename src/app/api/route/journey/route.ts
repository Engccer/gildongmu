import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey, hasOdsayKey, hasTmapKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { clientIpFromHeaders, reserveJourneyTmap } from "@/lib/rate-limit";
import { getJourney, journeyDeps } from "@/lib/journey/assemble";

/**
 * 여정 조회(E70, spec `2026-10-17-e70-mode-change-journey-design.md` §4): 택시(출발 → 역 A) + 대중교통(A → B) +
 * 택시(B의 출구 → 도착)를 한 트랜잭션으로 조립한다. 지정 역 판정이 ODsay 선정 전 후보를 보므로 서버에 있다.
 *
 * - 좌표는 형제 경로 라우트(`/api/route/car`·`/transit`)와 같은 `"위도,경도"` 쌍. 역은 좌표 + 이름이 함께 와야 하고
 *   A·B 중 하나는 있어야 한다. 노선 힌트(`boardLine`·`alightLine`)는 선택.
 * - ko 전용(D2): 택시 안내 기하가 Tmap ko 경로에만 있다. `lang`은 누락 또는 `ko`만, 그 밖은 400.
 * - 정식판 앱·웹은 이 라우트를 부르지 않는다(iOS 실험판 봉인). 웹에는 봉인이 없어 레이트 리밋과 키 쿼터가 유일한 방어다.
 * - Tmap 호출은 팬아웃 전 정확한 비용으로 한 번 예약한다(§4.5) — 예약하지 않은 호출은 없다.
 * - 택시 시간이 실시간이라 응답을 캐시하지 않는다.
 */
export const dynamic = "force-dynamic";

const optionalCoord = coordSchema.nullable().transform((v) => v ?? undefined);
const optionalText = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .transform((v) => v ?? undefined);

const querySchema = z
  .object({
    origin: coordSchema,
    dest: coordSchema,
    board: optionalCoord,
    boardName: optionalText,
    boardLine: optionalText,
    alight: optionalCoord,
    alightName: optionalText,
    alightLine: optionalText,
    lang: z.union([z.literal("ko"), z.null()]),
  })
  .refine((q) => q.board || q.alight, "갈아탈 역(board·alight) 중 하나는 필요합니다")
  .refine((q) => !q.board === !q.boardName && !q.alight === !q.alightName, "역 좌표와 역 이름은 함께 보내야 합니다");

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    origin: sp.get("origin") ?? "",
    dest: sp.get("dest") ?? "",
    board: sp.get("board"),
    boardName: sp.get("boardName"),
    boardLine: sp.get("boardLine"),
    alight: sp.get("alight"),
    alightName: sp.get("alightName"),
    alightLine: sp.get("alightLine"),
    lang: sp.get("lang"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
  }
  const q = parsed.data;
  const coords = [q.origin, q.dest, q.board, q.alight].filter((c) => c != null);
  if (!coords.every((c) => isInKorea(c.lat, c.lng))) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!(hasOdsayKey() && hasTmapKey() && hasKakaoKey())) {
    return NextResponse.json({ error: "여정 조회는 API 키 등록 후 사용할 수 있습니다." }, { status: 503 });
  }

  const ip = clientIpFromHeaders(request.headers);
  try {
    const outcome = await getJourney(
      {
        from: q.origin,
        to: q.dest,
        ...(q.board && q.boardName ? { board: { name: q.boardName, coord: q.board, ...(q.boardLine ? { line: q.boardLine } : {}) } } : {}),
        ...(q.alight && q.alightName ? { alight: { name: q.alightName, coord: q.alight, ...(q.alightLine ? { line: q.alightLine } : {}) } } : {}),
      },
      journeyDeps,
      (cost) => reserveJourneyTmap(ip, Date.now(), cost),
    );
    if (outcome.kind === "rateLimited") {
      return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }
    if (outcome.kind === "budgetExhausted") {
      return NextResponse.json({ budgetExhausted: true }, { status: 503 });
    }
    return NextResponse.json(outcome.result, { headers: NO_STORE });
  } catch (e) {
    console.error("[api/route/journey] 여정 조회 실패:", e);
    return NextResponse.json({ error: "여정 조회에 실패했습니다." }, { status: 502 });
  }
}
