import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const tab = read("ios/Gildongmu/Directions/DirectionsTabView.swift");
const picker = read("ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift");
const app = read("ios/Gildongmu/GildongmuApp.swift");

// Kit의 실제 비동기 역순·취소 테스트와 앱 배선을 함께 잠근다.
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n    }", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("iOS 길찾기 주소 요청 소유권", () => {
  it("조회 완료 표식은 수락된 주소 커밋에서만 세우므로 취소 뒤 재진입이 가능하다", () => {
    const state = read("ios/GildongmuKit/Sources/GildongmuKit/DirectionsAddressState.swift");
    const commit = body(state, "func commit(");
    expect(commit.indexOf("hasLoaded = true")).toBeGreaterThan(commit.indexOf("guard accepts(request"));
    expect(state.match(/hasLoaded\s*=\s*true/g)).toHaveLength(1);
    expect(tab).not.toMatch(/hasLoadedCurrentAddress\s*=\s*true|addressState\.hasLoaded\s*=/);
    const load = body(tab, "func loadCurrentAddressIfAuthorized(");
    expect(load).toContain("!addressState.hasLoaded, !addressState.isLoading");
    expect(load).toContain("defer { addressState.finish(request) }");
  });

  it.each(["loadCurrentAddressIfAuthorized", "refreshCurrentLocation"])(
    "%s는 측위 전에 세대를 확보하고 완료 뒤 검사한다", (name) => {
      const code = body(tab, `func ${name}(`);
      const start = code.indexOf("let request = beginCurrentAddress()");
      const locate = code.indexOf("await ");
      const check = code.indexOf("guard acceptsCurrentAddress(request)", locate);
      const sync = code.indexOf("await syncCurrentAddress(");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(locate).toBeGreaterThan(start);
      expect(check).toBeGreaterThan(locate);
      expect(sync).toBeGreaterThan(check);
      expect(code.slice(sync)).toContain("request: request");
      expect(code).toContain("addressState.finish(request)");
    },
  );

  it("경로 조회의 늦은 측위는 새 주소 세대를 만들지 않는다", () => {
    const code = body(tab, "func performQuery(");
    const start = code.indexOf("let addressRequest = beginCurrentAddress()");
    const locate = code.indexOf("current = try await ManualLocationJudge.effectiveCoordinate");
    const cancel = code.indexOf("guard !Task.isCancelled", locate);
    const coverage = code.indexOf("!isInKorea", locate);
    const check = code.indexOf("acceptsCurrentAddress(addressRequest)", locate);
    const task = code.indexOf("currentAddressTask = Task", locate);
    expect(code.indexOf("guard !Task.isCancelled")).toBeLessThan(start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(locate).toBeGreaterThan(start);
    expect(cancel).toBeGreaterThan(locate);
    expect(coverage).toBeGreaterThan(cancel);
    expect(check).toBeGreaterThan(locate);
    expect(task).toBeGreaterThan(check);
    expect(code.slice(task)).toContain("request: addressRequest");
    expect(code.slice(locate)).not.toContain("beginCurrentAddress()");
  });

  it.each(["cancel", "clearResults"])("%s는 주소와 재측위를 함께 무효화한다", (name) => {
    expect(body(tab, `func ${name}(`)).toContain("cancelCurrentAddress()");
    const cancel = body(tab, "func cancelCurrentAddress(");
    expect(cancel).toContain("addressState.cancel()");
    expect(cancel).toContain("currentAddressTask?.cancel()");
    expect(cancel).toContain("refreshCurrentTask?.cancel()");
    expect(cancel).toContain("isRefreshingCurrent = false");
  });

  it("주소 조회는 기존 요청 언어를 쓰고 단일 스냅샷으로 커밋한다", () => {
    const code = body(tab, "func syncCurrentAddress(");
    expect(code.indexOf("guard acceptsCurrentAddress(request)")).toBeLessThan(code.indexOf("await searchService.reverseGeocode"));
    expect(code).toContain("lang: request.language");
    expect(code).toContain("addressState.commit(resolved, for: request,");
    expect(code).toContain("language: AppLanguage.dataLocale, isCancelled: Task.isCancelled");
    expect(code).not.toContain("beginCurrentAddress");
    expect(tab).toContain("var currentAddress: String? { addressState.address.original }");
    expect(tab).toContain("var currentAddressEnglish: String? { addressState.address.english }");
  });
});

describe("최근 위치의 저장 표기 왕복", () => {
  it("필드·경로·프리필 기록은 이미 가진 표기만 복사한다", () => {
    for (const code of [body(tab, "func recordRecent("), body(tab, "func recentSide("), body(app, "func consumeDirectionsPrefill(")]) {
      expect(code).toContain("let roman)");
      expect(code).toContain("labelRoman: roman");
      expect(code).not.toMatch(/await|reverseGeocode|romanize/);
    }
  });

  it("최근 선택·경유지 복원·고정 토글에서 표기가 유실되지 않는다", () => {
    expect(picker).toContain("select(.place(label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng, labelRoman: endpoint.labelRoman))");
    expect(body(picker, "func togglePinRecent(")).toContain("labelRoman: endpoint.labelRoman");
    expect(body(tab, "func directionsEndpoint(")).toContain("labelRoman: $0.labelRoman");
    expect(body(tab, "func activateRecentRoute(")).toContain("labelRoman: via.labelRoman");
  });

  it("목록은 기존 병기 함수를 쓰고 좌표 기반 행 정체성을 유지한다", () => {
    expect(picker).toContain("bilingual(endpoint.label, roman: endpoint.labelRoman)");
    expect(body(tab, "func recentRouteLabel(")).toContain("bilingual(side.label, roman: side.labelRoman)");
    expect(picker).toContain("ForEach(recentEndpoints) { endpoint in");
    expect(tab).toContain("ForEach(model.recentRoutes) { route in");
  });
});
