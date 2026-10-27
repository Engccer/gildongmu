import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey, hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { coordSchema } from "@/lib/route-coord-schema";
import { searchJourneyStops, stopSearchDeps } from "@/lib/journey/stop-search";

/**
 * 정류장 이름 검색(E70-e spec §4.6): 여정 칸 검색 시트가 제출 때만 부른다. `q`는 trim 2~30자(한 글자 부분 일치는
 * 수천 건이다), 좌표는 형제 여정 라우트와 같은 `"위도,경도"` 쌍이며 둘 중 하나 이상 필수다.
 * 한국 밖 좌표는 버리고 둘 다 밖이면 200 `{"outOfCoverage":true}`. 키가 없으면 503(죽은 기능 0 — 실험판만 부른다).
 * 라우트에 `use cache`를 두지 않는다: 이름 단위 캐시는 provider fetch의 revalidate가 맡는다.
 */

const optionalCoord = coordSchema.nullable().transform((v) => v ?? undefined);

const querySchema = z
  .object({
    q: z.string().trim().min(2, "정류장 이름은 두 글자 이상이어야 합니다").max(30, "정류장 이름은 30자 이하여야 합니다"),
    origin: optionalCoord,
    dest: optionalCoord,
  })
  .refine((v) => v.origin || v.dest, "origin·dest 중 하나는 필요합니다");

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    q: sp.get("q") ?? "",
    origin: sp.get("origin"),
    dest: sp.get("dest"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
  }
  const { q, origin, dest } = parsed.data;
  const coords = [origin, dest].filter((c) => c != null).filter((c) => isInKorea(c.lat, c.lng));
  if (coords.length === 0) {
    return NextResponse.json({ outOfCoverage: true }, { headers: NO_STORE });
  }
  if (!(hasDataGoKrKey() && hasKakaoKey())) {
    return NextResponse.json({ error: "정류장 검색은 API 키 등록 후 사용할 수 있습니다." }, { status: 503 });
  }
  try {
    const result = await searchJourneyStops(q, coords, stopSearchDeps);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    console.error("[api/route/journey/stops] 정류장 검색 실패:", e);
    return NextResponse.json({ error: "정류장 검색에 실패했습니다." }, { status: 502 });
  }
}
