/**
 * 통합 검색 결과의 섹션 순서·합산 통지 결정 (deterministic — React/Next 비의존).
 *
 * 장소(POI)와 juso 주소를 단일 검색창에서 병렬 검색한 뒤, 어떤 섹션을 어떤
 * 순서로 보일지와 스크린 리더에 무엇을 통지할지는 같은 입력에 같은 정답이
 * 보장되는 deterministic 작업이라 코드로 잠그고 테스트로 검증한다(I/O와 분리).
 */
export type SectionKind = "place" | "address";

/**
 * 결과 있는 섹션을 위로(적응형). 0건 섹션은 제외, 건수 내림차순, 동률 시 장소 우선.
 * 둘 다 0이면 빈 배열(호출부가 "결과 없음" 처리).
 */
export function orderResultSections(
  placeCount: number,
  addrCount: number,
): SectionKind[] {
  const sections: SectionKind[] = [];
  if (placeCount > 0) sections.push("place");
  if (addrCount > 0) sections.push("address");
  if (sections.length < 2) return sections;
  // 둘 다 있음 — 건수 내림차순, 동률(place≥addr)이면 place 우선 유지.
  return placeCount >= addrCount ? ["place", "address"] : ["address", "place"];
}

export type LiveSpec = { key: string; values?: Record<string, number> };

/**
 * 단일 polite 채널 통지 결정. loading이면 검색 중(음성이면 searchingFor),
 * 완료면 양쪽 카운트로 합산/단일 통지를 고른다. 검색 전 idle(둘 다 null·비로딩)은
 * null(통지 없음). count가 null인 검색은 0으로 간주(미실행/결과 없음).
 */
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  spokenQuery: string | null;
}): LiveSpec | null {
  const { loading, placeCount, addrCount, spokenQuery } = input;
  if (loading) {
    return { key: spokenQuery ? "search.searchingFor" : "search.searching" };
  }
  // 비로딩 + 둘 다 미실행 = idle
  if (placeCount === null && addrCount === null) return null;
  const place = placeCount ?? 0;
  const addr = addrCount ?? 0;
  if (place > 0 && addr > 0) {
    return { key: "search.combinedAnnouncement", values: { place, addr } };
  }
  if (addr > 0) {
    return { key: "search.addressResultsAnnouncement", values: { count: addr } };
  }
  // 주소 0 — 장소 통지(0건 포함)
  return { key: "search.resultsAnnouncement", values: { count: place } };
}
