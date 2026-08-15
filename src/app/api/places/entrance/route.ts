import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { isInKorea } from "@/lib/coverage";
import { chooseEntrance } from "@/lib/entrance";
import { hasKakaoKey } from "@/lib/env";
import { searchEntranceCandidatesKakao } from "@/lib/providers/kakao-local";

/**
 * 목적지 출입구 승격 조회(A11).
 * 설계 정본: `docs/superpowers/specs/2026-08-16-destination-entrance-promotion-design.md`.
 *
 * 넓은 부지(학교·아파트단지·병원·공원)는 검색이 주는 대표 좌표가 본관이고 도보 경로는
 * 정문에서 끝난다. 그 차이가 `finalApproach` 오프셋이 되어 도착 판정이 성립하지 않는다.
 * 이 라우트는 "그 목적지의 출입구 POI가 있는가, 있다면 어느 것인가"만 답한다.
 *
 * 3-state: 파라미터 오류 400 · 한국 밖 200 마커 · 키 없음 404(게이트) · upstream 실패 502.
 * **`entrance: null`은 "출입구 없음"이고 오류가 아니다** — 실측상 대부분의 목적지가
 * 여기 해당한다(승격은 예외 경로다).
 */

const querySchema = z.object({
  name: z.string().trim().min(1, "목적지 이름이 필요합니다").max(60),
  lat: latParam(),
  lng: lngParam(),
  // 출발지는 선택이다 — "좌표 없음"이 정답인 자리라 400이 아니라 undefined로 떨어진다
  // (`Number("")===0`이 (0,0)으로 위장하는 함정의 반대편, coord-param 계약).
  fromLat: latParam().optional().catch(undefined),
  fromLng: lngParam().optional().catch(undefined),
});

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    name: q.get("name") ?? "",
    lat: q.get("lat") ?? "",
    lng: q.get("lng") ?? "",
    fromLat: q.get("fromLat") ?? undefined,
    fromLng: q.get("fromLng") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  const { name, lat, lng, fromLat, fromLng } = parsed.data;

  // 파싱 → 커버리지 마커 → 키 게이트 → upstream(횡단 함정 계약 순서).
  if (!isInKorea(lat, lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }

  if (!hasKakaoKey()) {
    return NextResponse.json(
      { error: "출입구 조회는 카카오 API 키 등록 후 사용할 수 있습니다." },
      { status: 404 },
    );
  }

  try {
    const documents = await searchEntranceCandidatesKakao(name, { lat, lng }, request.signal);
    const entrance = chooseEntrance({
      placeName: name,
      dest: { lat, lng },
      from: fromLat != null && fromLng != null ? { lat: fromLat, lng: fromLng } : null,
      candidates: documents.map((d) => ({
        name: d.place_name,
        category: d.category_name,
        lat: Number(d.y),
        lng: Number(d.x),
      })),
    });
    return NextResponse.json({ entrance });
  } catch (e) {
    console.error("[api/places/entrance] 출입구 조회 실패:", e);
    return NextResponse.json({ error: "출입구 조회에 실패했습니다." }, { status: 502 });
  }
}
