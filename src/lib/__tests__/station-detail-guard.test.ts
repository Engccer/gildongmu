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

  it("번호·없음은 5분 신선, 보관 한도는 그 뒤 30초", () => {
    expect(STORE).toContain("static let freshSeconds: TimeInterval = 300");
    expect(STORE).toContain("static let evictAfterSeconds: TimeInterval = freshSeconds + 30");
  });

  it("표시는 마지막 값 — result는 시계·신선도를 보지 않는다(재렌더로 번호가 조용히 사라지지 않게)", () => {
    const body = funcBody("func result(");
    expect(body).toContain("return results[key]");
    expect(body).not.toMatch(/Date\(\)|freshSeconds|fetchedAt|evictAfterSeconds/);
  });

  it("resolve: 신선하면 반환 → 진행 중 공유 → 지난 실패 지우기 → 조회 Task 순서", () => {
    const body = funcBody("func resolve(");
    const fresh = body.indexOf("Date().timeIntervalSince(at) < Self.freshSeconds");
    const join = body.indexOf("if let running = inflight[key] { return await running.value }");
    const clear = body.indexOf("if results[key] == .failed { results[key] = nil }");
    const task = body.indexOf("let task = Task {");
    expect(fresh).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(fresh);
    expect(clear).toBeGreaterThan(join);
    expect(task).toBeGreaterThan(clear);
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

  it("실패는 도장 없이 두고, 번호·없음은 도장이 그대로일 때만 보관 한도 뒤 지운다", () => {
    const body = funcBody("private func record(");
    const failed = body.indexOf("guard value != .failed else {");
    const stamp = body.indexOf("fetchedAt[key] = stamp");
    expect(failed).toBeGreaterThan(-1);
    expect(body.slice(failed, stamp)).toContain("fetchedAt[key] = nil");
    expect(body).toContain("try? await Task.sleep(for: .seconds(Self.evictAfterSeconds))");
    expect(body).toContain("if self.fetchedAt[key] == stamp {");
  });

  it("조회 서비스는 장소 트랙만 부른다(주소·유료 웹검색 0) — 3초 상한", () => {
    expect(KIT).toContain('client.get("/api/places", query: query, timeout: 3)');
    expect(KIT).not.toMatch(/\/api\/address\/search|\/api\/search\/web/);
  });
});
