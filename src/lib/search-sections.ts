/**
 * 통합 검색 결과의 섹션 순서·합산 통지 결정 (deterministic — React/Next 비의존).
 *
 * 장소(POI)·웹·juso 주소를 단일 검색창에서 항상 병렬 검색한 뒤, 어떤 섹션을 어떤
 * 순서로 보일지와 스크린 리더에 무엇을 통지할지는 같은 입력에 같은 정답이
 * 보장되는 deterministic 작업이라 코드로 잠그고 테스트로 검증한다(I/O와 분리).
 */
export type SectionKind = "place" | "address" | "web";

/**
 * 결과 있는 섹션을 위로(적응형). 0건 섹션은 제외, 건수 내림차순, 동률 시 우선순위
 * place>web>address. 모두 0이면 빈 배열(호출부가 "결과 없음" 처리).
 * place·web·address는 항상 병렬이라 공존 가능. 건수 내림차순으로 가장 많은 섹션을 위로.
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

export type LivePart = { key: string; values?: Record<string, number> };

/**
 * 0건 웹 폴백 트리거 — 장소(카카오)·주소(juso)가 **둘 다 0건**일 때만 웹 검색을 한다.
 *
 * 카카오가 장소를 찾았거나 juso가 주소를 찾았다는 건 "구조화된 국내 데이터로 답을
 * 찾음"이라 의도가 장소/주소였을 가능성이 압도적 — 이때 웹은 노이즈다. 둘 다 0건이어야
 * 비로소 "국내 구조화 데이터 밖(신생 가게·시의성·장소 아닌 질문)" = 웹 신호다.
 * 결과를 본 뒤(posterior) deterministic하게 판정하므로, 검색 전 추측하던 LLM 라우터의
 * 실패 모드(멀쩡한 쿼리 재해석 악화)가 구조적으로 불가능하다. 장소 "에러"(조회 실패)는
 * "0건"과 다른 신호라 호출부가 폴백에서 제외한다(여기 인자엔 성공 건수만 들어온다).
 */
export function shouldFallbackToWeb(
  placeCount: number,
  addrCount: number,
): boolean {
  return placeCount === 0 && addrCount === 0;
}

/**
 * 단일 polite 채널 통지(부분 배열). loading이면 검색 중(음성이면 searchingFor),
 * 완료면 0이 아닌 섹션(장소·웹·주소)을 차례로 part로 쌓아 호출부가 ", "로 잇는다.
 * 모두 0이면 장소 에러는 error, 아니면 noResults. 검색 전 idle은 null(통지 없음).
 * place·web·address는 항상 병렬이라 공존한다(라우터 시절 place⊕web 상호배타 폐기).
 */
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  webCount?: number | null;
  spokenQuery: string | null;
  placeErrored: boolean;
}): LivePart[] | null {
  const { loading, placeCount, addrCount, spokenQuery, placeErrored } = input;
  const webCount = input.webCount ?? null;
  // 1. 로딩 우선(실패 단정 금지).
  if (loading) {
    return [{ key: spokenQuery ? "search.searchingFor" : "search.searching" }];
  }
  // 2. 비로딩 + 모두 미실행 + 에러 아님 = idle(통지 없음).
  if (placeCount === null && addrCount === null && webCount === null && !placeErrored) {
    return null;
  }
  const place = placeCount ?? 0;
  const web = webCount ?? 0;
  const addr = addrCount ?? 0;
  const parts: LivePart[] = [];
  if (place > 0) parts.push({ key: "search.placeCount", values: { count: place } });
  if (web > 0) parts.push({ key: "search.webCount", values: { count: web } });
  if (addr > 0) parts.push({ key: "search.addressCount", values: { count: addr } });
  if (parts.length > 0) return parts;
  // 3. 보여줄 결과 0 — 장소 에러면 실패 통지(무음 방지), 아니면 결과 없음.
  if (placeErrored) return [{ key: "search.error" }];
  return [{ key: "search.noResults" }];
}
