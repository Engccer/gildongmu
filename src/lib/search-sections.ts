/**
 * 통합 검색 결과의 섹션 순서·합산 통지 결정 (deterministic — React/Next 비의존).
 *
 * 장소(POI)와 juso 주소를 단일 검색창에서 병렬 검색한 뒤, 어떤 섹션을 어떤
 * 순서로 보일지와 스크린 리더에 무엇을 통지할지는 같은 입력에 같은 정답이
 * 보장되는 deterministic 작업이라 코드로 잠그고 테스트로 검증한다(I/O와 분리).
 */
export type SectionKind = "place" | "address" | "web";

/**
 * 결과 있는 섹션을 위로(적응형). 0건 섹션은 제외, 건수 내림차순, 동률 시 우선순위
 * place>web>address. 모두 0이면 빈 배열(호출부가 "결과 없음" 처리).
 * place와 web은 라우터가 하나만 선택하므로 상호배타(동시 >0 안 됨).
 */
export function orderResultSections(
  placeCount: number,
  addrCount: number,
  webCount = 0,
): SectionKind[] {
  const present: { kind: SectionKind; count: number; rank: number }[] = [];
  if (placeCount > 0) present.push({ kind: "place", count: placeCount, rank: 0 });
  if (webCount > 0) present.push({ kind: "web", count: webCount, rank: 1 });
  if (addrCount > 0) present.push({ kind: "address", count: addrCount, rank: 2 });
  // 건수 내림차순, 동률이면 rank(place>web>address) 우선.
  present.sort((a, b) => b.count - a.count || a.rank - b.rank);
  return present.map((s) => s.kind);
}

export type LiveSpec = { key: string; values?: Record<string, number> };

/**
 * 단일 polite 채널 통지 결정. loading이면 검색 중(음성이면 searchingFor),
 * 완료면 카운트로 합산/단일 통지를 고른다. 검색 전 idle(모두 null·비로딩)은
 * null(통지 없음). count가 null인 검색은 0으로 간주(미실행/결과 없음).
 *
 * placeErrored: 장소 검색이 error 상태인지 — 무음 회귀 방지.
 * status.kind==="error"면 placeCount가 null이라 기존엔 idle(null)을 반환해
 * 스크린 리더에 아무것도 안 들렸다. placeErrored를 받아 에러 통지를 보장한다.
 *
 * webCount/webFallback: 자연어 라우터가 웹으로 라우팅한 경우(place와 상호배타).
 * webFallback=true면 장소 0건 폴백(길 B), false면 웹 직접 라우팅(길 A). 선택 필드라
 * 미전달(기존 호출부)은 웹 없음으로 동작(회귀 0).
 */
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  spokenQuery: string | null;
  placeErrored: boolean;
  webCount?: number | null;
  webFallback?: boolean;
}): LiveSpec | null {
  const { loading, placeCount, addrCount, spokenQuery, placeErrored } = input;
  const webCount = input.webCount ?? null;
  const webFallback = input.webFallback ?? false;
  // 1. 로딩 중이면 searching/searchingFor 우선(에러보다 우선 — 로딩 중엔 실패 단정 금지).
  if (loading) {
    return { key: spokenQuery ? "search.searchingFor" : "search.searching" };
  }
  // 2. 비로딩 + 모두 미실행 + 에러 아님 = idle
  if (placeCount === null && addrCount === null && webCount === null && !placeErrored) {
    return null;
  }
  const place = placeCount ?? 0;
  const addr = addrCount ?? 0;
  const web = webCount ?? 0;
  // 3. 웹 결과(길 A/B) — place와 상호배타이므로 먼저 처리.
  if (web > 0) {
    if (addr > 0) {
      return { key: "search.webAndAddressAnnouncement", values: { web, addr } };
    }
    return webFallback
      ? { key: "search.webFallbackAnnouncement", values: { count: web } }
      : { key: "search.webResultsAnnouncement", values: { count: web } };
  }
  // 4. 장소·주소 모두 결과 있음.
  if (place > 0 && addr > 0) {
    return { key: "search.combinedAnnouncement", values: { place, addr } };
  }
  // 5. 주소 결과 있음(장소가 에러/0이어도 주소 결과 우선 — 한쪽 에러가 다른 쪽 죽이지 않음).
  if (addr > 0) {
    return { key: "search.addressResultsAnnouncement", values: { count: addr } };
  }
  // 6. 장소 에러 + 보여줄 결과 없음 → 실패 통지(무음 방지).
  if (placeErrored) {
    return { key: "search.error" };
  }
  // 7. 그 외 — 장소 통지(0건 포함).
  return { key: "search.resultsAnnouncement", values: { count: place } };
}
