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

  it("메모리만 쓴다 — 영속 API 0", () => {
    expect(STORE).not.toMatch(/UserDefaults|AppStorage|FileManager|\.write\(to:|NSCache/);
  });

  it("번호·없음은 5분 보관, 실패는 신선도 기록을 남기지 않는다", () => {
    expect(STORE).toContain("static let freshSeconds: TimeInterval = 300");
    expect(STORE).toContain("fetchedAt[key] = value == .failed ? nil : Date()");
  });

  it("조회 서비스는 장소 트랙만 부른다(주소·유료 웹검색 0) — 3초 상한", () => {
    expect(KIT).toContain('client.get("/api/places", query: query, timeout: 3)');
    expect(KIT).not.toMatch(/\/api\/address\/search|\/api\/search\/web/);
  });
});
