import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchStationTimetable } from "@/lib/providers/tago-subway";
import { withTimetableLinesEn } from "@/lib/subway-line-names";
import { langParam } from "@/lib/lang-param";
import { checkTimetableRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * 역 첫차·막차 프록시(TAGO SubwayInfo). 미커버 역·키 없음은 { timetable: null } 200,
 * upstream 장애는 502(스펙 §2-A 판정 표 — 컴포넌트가 실패 문장을 노출한다).
 * 임의 역명 폭주로 인한 쿼터 소진 방어(60초 10회 — 키워드 1+노선×2 증폭 고려).
 */
// `lang=en`은 노선마다 `lineNameEn`(노선명 영문 표)을 additive로 싣는다(E27). 미지정·ko는 byte-identical.
const schema = z.object({ station: z.string().trim().min(1).max(50), lang: langParam() });

export async function GET(request: NextRequest) {
  if (!checkTimetableRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json({ error: "요청이 너무 잦습니다" }, { status: 429 });
  }
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
    lang: request.nextUrl.searchParams.get("lang"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const fetched = await fetchStationTimetable(parsed.data.station);
    const timetable = parsed.data.lang === "en" ? withTimetableLinesEn(fetched) : fetched;
    return NextResponse.json({ timetable });
  } catch (e) {
    console.error("[api/station/timetable] 조회 실패:", e);
    return NextResponse.json({ error: "첫차·막차 조회 실패" }, { status: 502 });
  }
}
