import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { langParam } from "@/lib/lang-param";
import { checkTransitTrackRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import {
  resolveTagoStop,
  trackSeoulRide,
  trackSeoulWait,
  trackSubway,
  trackTago,
} from "@/lib/transit-track";

/**
 * 대중교통 추적 폴링 라우트(B2 §7) — 판별 union 응답으로 provider 봉투 차이를
 * 서버가 흡수한다. 미등장(empty)·추적 불가(unsupported)·upstream 오류(502)를
 * 절대 뭉개지 않는다(3-state).
 *
 * 폴링 소비자(웹 useTransitGuide·iOS TransitGuideModel) 전용: no-store,
 * IP 60초 20회(폴링 최소 15초 + 복귀 즉폴 버스트 여유 — rate-limit.ts 주석).
 */

export const dynamic = "force-dynamic";

const seoulWaitSchema = z.object({
  arsId: z.string().trim().min(1).max(10),
  routeId: z.string().trim().min(1).max(20),
});
const seoulRideSchema = z.object({
  routeId: z.string().trim().min(1).max(20),
  boardId: z.string().trim().min(1).max(20),
  alightId: z.string().trim().min(1).max(20),
});
const tagoResolveSchema = z.object({ lat: latParam(), lng: lngParam() });
const tagoTrackSchema = z.object({
  cityCode: z.string().trim().min(1).max(10),
  nodeId: z.string().trim().min(1).max(30),
  routeNo: z.string().trim().min(1).max(20),
});
const subwaySchema = z.object({
  station: z.string().trim().min(1).max(50),
  line: z.string().trim().min(1).max(30),
});

function badRequest(message = "잘못된 요청"): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);
  if (!checkTransitTrackRateLimit(ip, Date.now())) {
    return NextResponse.json({ error: "요청이 너무 잦습니다." }, { status: 429 });
  }

  const q = request.nextUrl.searchParams;
  const mode = q.get("mode") ?? "";
  const phase = q.get("phase") ?? "";
  const params = Object.fromEntries(q.entries());

  // ⚠ `lang`은 mode·phase 분기 **앞에서** 한 번만 판정한다(E27 잔여 ①). 갈래마다 스키마가
  // 달라 넷에 흩으면 하나를 빠뜨리고, 그 갈래만 조용히 ko로 떨어진다.
  const langParsed = langParam().safeParse(q.get("lang"));
  if (!langParsed.success) return badRequest("lang은 ko 또는 en이어야 합니다");
  const lang = langParsed.data;

  try {
    if (mode === "seoulBus" && phase === "wait") {
      const parsed = seoulWaitSchema.safeParse(params);
      if (!parsed.success) return badRequest();
      return NextResponse.json({ mode, ...(await trackSeoulWait({ ...parsed.data, lang })) });
    }
    if (mode === "seoulBus" && phase === "ride") {
      const parsed = seoulRideSchema.safeParse(params);
      if (!parsed.success) return badRequest();
      const { routeId, boardId, alightId } = parsed.data;
      return NextResponse.json({
        mode,
        ...(await trackSeoulRide({ routeId, boardLocalId: boardId, alightLocalId: alightId, lang })),
      });
    }
    if (mode === "tagoBus" && phase === "resolve") {
      const parsed = tagoResolveSchema.safeParse(params);
      if (!parsed.success) {
        return badRequest(parsed.error.issues[0]?.message ?? "잘못된 요청");
      }
      return NextResponse.json({ mode, ...(await resolveTagoStop(parsed.data)) });
    }
    if (mode === "tagoBus" && phase === "track") {
      const parsed = tagoTrackSchema.safeParse(params);
      if (!parsed.success) return badRequest();
      return NextResponse.json({ mode, ...(await trackTago({ ...parsed.data, lang })) });
    }
    if (mode === "subway" && phase === "track") {
      const parsed = subwaySchema.safeParse(params);
      if (!parsed.success) return badRequest();
      return NextResponse.json({
        mode,
        ...(await trackSubway({ station: parsed.data.station, lineName: parsed.data.line, lang })),
      });
    }
    return badRequest("mode·phase 조합이 유효하지 않습니다");
  } catch (e) {
    console.error("[api/transit/track] 추적 조회 실패:", e);
    return NextResponse.json({ error: "실시간 추적 조회에 실패했습니다." }, { status: 502 });
  }
}
