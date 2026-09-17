import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 역 장소 상세 개편(E44, spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md)의 소스 가드.
 * 앱 타깃엔 뷰 테스트 레인이 없어 구조를 소스로 잠근다(저장소 관례 — transit-landing-guard.test.ts).
 */
const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SECTIONS = read("ios/Gildongmu/StationSections.swift");

const structBody = (src: string, name: string) => {
  const start = src.indexOf(`struct ${name}`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}\n", start));
};

describe("교통약자 시설 종류별 접기 (spec §4)", () => {
  const body = structBody(SECTIONS, "StationDetailSections");

  it("종류마다 DisclosureGroup이고 펼침 집합은 비어서 시작한다", () => {
    expect(body).toContain("@State private var expandedKinds: Set<String> = []");
    expect(body).toMatch(/DisclosureGroup\(isExpanded: expansion\(for: group\.kind\)\)/);
  });

  it("접힘 라벨은 운행 중지 수를 싣는다", () => {
    expect(body).toContain('appLocalized("ios.station.kindCountStopped"');
    expect(body).toContain('$0.operatingStatus == "stopped"');
    // 키가 본문에 있어도 라벨이 kindLabel을 안 거치면 중지 수는 화면에 오지 않는다.
    expect(body).toMatch(/label:\s*\{\s*Text\(kindLabel\(group\)\)/);
  });

  it("보강 실패 줄은 종류 행들 앞, 음성유도기 기준일 줄은 음성유도기 묶음 안", () => {
    const failed = body.indexOf('appLocalized("subway.supplementFailed")');
    const groups = body.indexOf("ForEach(facilities.groups");
    expect(failed).toBeGreaterThan(-1);
    expect(failed).toBeLessThan(groups);
    const source = body.indexOf('appLocalized("subway.voiceGuideSource")');
    expect(source).toBeGreaterThan(groups);
    expect(body.slice(groups, source)).toContain('group.kind == "voiceGuide"');
  });

  it("역 정보 섹션(제목 포함)은 StationDetailSections에 없다 — 레이아웃이 자리를 정한다", () => {
    expect(body).not.toContain("stationMeta.heading");
    expect(SECTIONS).not.toContain("struct StationSectionsView");
  });
});

describe("경유역 전화번호 저장소 (spec §5.3·§5.6)", () => {
  const STORE = read("ios/Gildongmu/StationPhoneStore.swift");
  const KIT = read("ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift");
  /** 4칸 들여쓴 메서드 본문(서명부터 닫는 `    }`까지). 안쪽 블록은 들여쓰기가 더 깊어 끝으로 잡히지 않는다. */
  const funcBody = (signature: string) => {
    const start = STORE.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const end = STORE.indexOf("\n    }\n", start);
    expect(end).toBeGreaterThan(start);
    return STORE.slice(start, end);
  };

  it("메모리만 쓴다 — 영속 API 0", () => {
    expect(STORE).not.toMatch(
      /UserDefaults|AppStorage|FileManager|\.write\(to:|NSCache|URLCache|Keychain|SwiftData/,
    );
  });

  it("싱글턴 하나만 — 인스턴스가 갈라지면 캐시·진행 중 공유가 갈라진다", () => {
    expect(STORE).toContain("static let shared = StationPhoneStore()");
    expect(STORE).toContain("private init() {}");
  });

  it("번호·없음은 5분 신선, 소비자 재확인 30초, 보관 한도는 재확인 간격 둘 뒤(갱신이 삭제를 앞서게)", () => {
    expect(STORE).toContain("static let freshSeconds: TimeInterval = 300");
    expect(STORE).toContain("static let recheckSeconds: TimeInterval = 30");
    expect(STORE).toContain(
      "static let evictAfterSeconds: TimeInterval = freshSeconds + 2 * recheckSeconds",
    );
  });

  it("표시는 마지막 값 — result는 시계·신선도를 보지 않는다(재렌더로 번호가 조용히 사라지지 않게)", () => {
    const body = funcBody("func result(");
    expect(body).toContain("return results[key]");
    expect(body).not.toMatch(/Date\(\)|freshSeconds|fetchedAt|evictAfterSeconds/);
  });

  it("resolve: 신선하면 반환 → 진행 중 공유 → 조회 Task 순서, 재시도 시작이 표시 값을 지우지 않는다", () => {
    const body = funcBody("func resolve(");
    const fresh = body.indexOf("Date().timeIntervalSince(at) < Self.freshSeconds");
    const join = body.indexOf("if let running = inflight[key] { return await running.value }");
    const task = body.indexOf("let task = Task {");
    expect(fresh).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(fresh);
    expect(task).toBeGreaterThan(join);
    // 실패 줄은 재시도 중에도 참이다 — 지우면 30초마다 실패 줄 ↔ 빈 줄로 바뀌어 VoiceOver 커서가 떨어진다.
    expect(body).not.toContain("results[key] = nil");
  });

  it("기록은 조회 Task 본문이 한다 — 첫 소비자의 재개 뒤가 아니다", () => {
    const body = funcBody("func resolve(");
    const taskStart = body.indexOf("let task = Task {");
    const taskEnd = body.indexOf("inflight[key] = task");
    expect(taskEnd).toBeGreaterThan(taskStart);
    const taskBody = body.slice(taskStart, taskEnd);
    expect(taskBody).toContain("self.inflight[key] = nil");
    expect(taskBody).toContain("self.record(value, for: key)");
    const tail = body.slice(body.indexOf("return await task.value"));
    expect(tail).not.toMatch(/record\(|inflight\[key\] = nil|results\[key\] =/);
  });

  it("실패 기록: 낡은 번호·없음은 덮지 않고 표식만, 그 밖엔 실패로 — 도장은 건드리지 않는다", () => {
    const body = funcBody("private func record(");
    const branch = body.indexOf("if value == .failed {");
    const current = body.indexOf("if let current = results[key], current != .failed {");
    const insert = body.indexOf("refreshFailed.insert(key)");
    const setFailed = body.indexOf("results[key] = .failed");
    const success = body.indexOf("\n        results[key] = value\n");
    expect(branch).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(branch);
    expect(insert).toBeGreaterThan(current);
    expect(setFailed).toBeGreaterThan(insert);
    expect(success).toBeGreaterThan(setFailed);
    // 도장을 지우거나 바꾸면 낡은 번호의 보관 한도 예약이 무효가 된다.
    expect(body.slice(branch, success)).not.toContain("fetchedAt");
  });

  it("성공 기록은 표식을 지우고 도장을 찍으며, 도장이 그대로일 때만 보관 한도에서 실패 또는 모름으로 바꾼다", () => {
    const body = funcBody("private func record(");
    const success = body.indexOf("\n        results[key] = value\n");
    const clearMark = body.indexOf("\n        refreshFailed.remove(key)\n");
    const stampDecl = body.indexOf("\n        let stamp = Date()\n");
    const stampSet = body.indexOf("\n        fetchedAt[key] = stamp\n");
    const sleep = body.indexOf("try? await Task.sleep(for: .seconds(Self.evictAfterSeconds))");
    const guardStamp = body.indexOf("guard self.fetchedAt[key] == stamp else { return }");
    const clearStamp = body.indexOf("self.fetchedAt[key] = nil");
    const evict = body.indexOf(
      "self.results[key] = self.refreshFailed.remove(key) != nil ? .failed : nil",
    );
    expect(success).toBeGreaterThan(-1);
    expect(clearMark).toBeGreaterThan(success);
    expect(stampDecl).toBeGreaterThan(clearMark);
    expect(stampSet).toBeGreaterThan(stampDecl);
    expect(sleep).toBeGreaterThan(stampSet);
    expect(guardStamp).toBeGreaterThan(sleep);
    expect(clearStamp).toBeGreaterThan(guardStamp);
    expect(evict).toBeGreaterThan(clearStamp);
  });

  it("조회 서비스는 장소 트랙만 부른다(주소·유료 웹검색 0) — 3초 상한", () => {
    expect(KIT).toContain('client.get("/api/places", query: query, timeout: 3)');
    expect(KIT).not.toMatch(/\/api\/address\/search|\/api\/search\/web/);
  });
});

describe("역 장소 상세 레이아웃 (spec §3)", () => {
  const VIEW = read("ios/Gildongmu/PlaceDetailView.swift");
  const bodyStart = VIEW.indexOf("var body: some View {");
  const stationStart = VIEW.indexOf("if let kind = layoutKind {", bodyStart);
  const elseStart = VIEW.indexOf("} else {", stationStart);
  const elseEnd = VIEW.indexOf("\n            }\n", elseStart);
  const station = VIEW.slice(stationStart, elseStart);
  const general = VIEW.slice(elseStart, elseEnd);
  const order = (src: string, marks: string[]) => marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, m).toBeGreaterThan(-1);
    return at;
  });

  it("역 분기 순서: 역 정보 → 상세 섹션(도착·시간표·시설) → 무장애 → 길찾기 → 이 장소 주변", () => {
    const at = order(station, [
      "stationInfoSection(kind)",
      "StationDetailSections(model: stationSections)",
      "BarrierFreeInfoSection(model: barrierFreeInfo)",
      "routeSection",
      "nearbySection(includesSubway: false)",
    ]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("현행 분기 순서는 개편 전 그대로: 기본 정보 → 길찾기 → 이 장소 주변(지하철 포함) → 역 섹션 → 무장애", () => {
    const at = order(general, [
      "generalInfoSection",
      "routeSection",
      "nearbySection(includesSubway: true)",
      "StationMetaSection(model: stationSections)",
      "StationDetailSections(model: stationSections)",
      "BarrierFreeInfoSection(model: barrierFreeInfo)",
    ]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("현행 분기 역 섹션은 isStation일 때만(출구 POI 등 드문 경우)", () => {
    const guardAt = general.indexOf("if isStation(place) {");
    const metaAt = general.indexOf("StationMetaSection(model: stationSections)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(metaAt).toBeGreaterThan(guardAt);
  });

  it("현행 분기 기본 정보 행은 개편 전 구성·순서 그대로이고 대표번호 표기를 쓰지 않는다(spec §5.5)", () => {
    const start = VIEW.indexOf("private var generalInfoSection");
    expect(start).toBeGreaterThan(-1);
    const info = VIEW.slice(start, VIEW.indexOf("\n    }\n", start));
    const at = order(info, [
      "categoryRow",
      "addressRows",
      "PlaceHoursLine(model: placeHours)",
      'Link(appLocalized("ios.place.callLine", phone)',
      "homepageRow",
      "chatRow",
    ]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(info).not.toContain("stationPhoneLink");
  });

  it("지하철 도착 링크는 includesSubway가 참일 때만", () => {
    const nearby = VIEW.slice(VIEW.indexOf("private func nearbySection("));
    expect(nearby.slice(0, nearby.indexOf("SubwayNearbyView"))).toContain("if includesSubway");
  });

  it("역 분기에는 지하철 도착 링크가 없다(spec §8 ③)", () => {
    expect(station).not.toContain("SubwayNearbyView");
    expect(station).not.toContain("includesSubway: true");
  });

  it("역 정보 섹션: 전화 줄이 첫 행, 메타 줄이 다음, 분류 줄은 .rail만, 제목은 항상", () => {
    const info = VIEW.slice(VIEW.indexOf("private func stationInfoSection("), VIEW.indexOf("private var stationPhoneRow"));
    const at = order(info, ["stationPhoneRow", "StationMetaLine(model: stationSections)", "if kind == .rail"]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(info).toContain('Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)');
  });

  it("전화 줄: 대표번호 표기·조회 실패 줄·조회는 경유역만", () => {
    expect(VIEW).toContain('appLocalized("ios.place.callRepresentativeLine", phone)');
    expect(VIEW).toContain('appLocalized("ios.station.phoneError")');
    const lookup = VIEW.slice(VIEW.indexOf("private func lookupStationPhoneIfNeeded("));
    const lookupBody = lookup.slice(0, lookup.indexOf("\n    }\n"));
    expect(lookupBody).toContain('place.id.hasPrefix("transit-stop:")');
    // 저장소는 마지막 값을 신선도 없이 돌려준다 — 화면에 떠 있는 동안 재확인하지 않으면 보관 한도에 지워진다.
    expect(lookupBody).toContain("while !Task.isCancelled");
    expect(lookupBody).toContain("StationPhoneStore.recheckSeconds");
  });

  it("길찾기 제목은 명시 heading이다(화면 아래로 내려가 제목 점프 의존이 커진다)", () => {
    const route = VIEW.slice(VIEW.indexOf("private var routeSection"));
    expect(route.slice(0, route.indexOf("\n    }\n"))).toContain(
      'Text(appLocalized("ios.route.section")).accessibilityAddTraits(.isHeader)',
    );
  });
});

describe("안내 시트 경유역 로터 (spec §5.2·§6)", () => {
  const SHEET = read("ios/Gildongmu/Directions/TransitTrackingSheet.swift");
  const row = structBody(SHEET, "ViaStopStationRow");

  it("경유역 행 하위 뷰만 저장소를 읽고, 로터는 직통·대표번호 라벨을 가른다", () => {
    expect(row).toContain("phoneStore.result(stationName: stop.name");
    expect(row).toContain('Button(appLocalized("ios.place.call"))');
    expect(row).toContain('Button(appLocalized("ios.place.callRepresentative"))');
    // 저장소는 마지막 값을 신선도 없이 돌려준다 — 행이 떠 있는 동안 재확인하지 않으면 보관 한도에 지워진다.
    expect(row).toContain("while !Task.isCancelled");
    expect(row).toContain("StationPhoneStore.recheckSeconds");
    const sheetBody = SHEET.slice(0, SHEET.indexOf("private struct ViaStopStationRow"));
    // 수신자 이름과 무관하게(`phoneStore`·`StationPhoneStore.shared`) 저장소 읽기 호출 모양으로 잡는다.
    expect(sheetBody).not.toMatch(/\.result\(stationName:/);
  });

  it("목록을 펼치는 순간 그 구간 역을 일괄 조회한다", () => {
    expect(SHEET).toMatch(/\.onChange\(of: viaExpanded\) \{ _, expanded in\s+if expanded \{ prefetchViaPhones\(\) \}/);
    const fn = SHEET.slice(SHEET.indexOf("private func prefetchViaPhones("));
    expect(fn.slice(0, fn.indexOf("\n    }\n"))).toContain(
      "StationPhoneStore.shared.prefetch(stops: leg.viaStops, lineName: leg.lineName)",
    );
  });

  it("노선 힌트는 누르는 순간 확정해 상세와 함께 나른다 — 목적지 상세는 nil", () => {
    const open = SHEET.slice(SHEET.indexOf("private func openStationDetail("));
    expect(open.slice(0, open.indexOf("\n    }\n"))).toContain("detailLineHint = lineName");
    expect(SHEET).toContain("detailLineHint = nil");
    expect(SHEET).toContain("PlaceDetailSheet(place: place, showsDirectionsEntry: false, stationLineHint: detailLineHint)");
  });
});
