import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E90 「안내 시트의 목적지에 전화 걸기」 배선 가드(iOS 뷰 계층은 테스트 레인이 없어 소스로 잠근다).
 * 번호는 세션 통로를 타지 않고 목적지 전화번호부(Kit `PlacePhoneBook`)를 거친다: 고르는 자리가 적고 안내 시트가 찾는다.
 * 적는 자리가 하나 빠지면 오류 없이 그 진입 경로에서만 전화 동작이 사라진다.
 */
const ios = join(__dirname, "../../../ios/Gildongmu");
const read = (rel: string) => readFileSync(join(ios, rel), "utf8");

describe("E90 안내 시트의 목적지에 전화 걸기", () => {
  it("제목 행의 오른쪽 밀기 묶음에서 전화 걸기가 첫 선언이다(VoiceOver 동작 목록의 첫 항목)", () => {
    const row = read("Directions/GuideTitleActionsRow.swift");
    const leading = /\.swipeActions\(edge: \.leading, allowsFullSwipe: false\) \{([\s\S]*?)\n        \}/.exec(row);
    expect(leading).not.toBeNull();
    const firstButton = /Button\(([^,]+),/.exec(leading![1]);
    expect(firstButton?.[1]).toBe('appLocalized("ios.place.call")');
    expect(leading![1].trimStart().startsWith("if let onCall {")).toBe(true);
  });

  it("두 안내 시트가 제목 행 동작과 장소 상세에 같은 번호를 쓴다", () => {
    for (const file of ["Directions/BeaconTrackingSheet.swift", "Directions/TransitTrackingSheet.swift"]) {
      const src = read(file);
      expect(src, file).toMatch(/onCall: \w+\.map \{ url in \{[^\n]*openURL\(url\) \} \}/);
      expect(src, file).toMatch(/placeTelURL\(guideDestinationPhone\(dest: [\w.]+, label: model\.destinationLabel\)\)/);
      expect(src, file).toMatch(
        /guideDestinationPlace\(\s*dest: dest, label: model\.destinationLabel,\s*phone: guideDestinationPhone\(dest: dest, label: model\.destinationLabel\)\)/,
      );
    }
  });

  it("안내 시작 입구 둘이 목적지 번호를 적는다", () => {
    const coordinator = read("Directions/GuideSessionCoordinator.swift");
    expect(coordinator).toMatch(/func startGuide\(to destination: GuideDestination, mode: GuideStartMode\) \{\n\s+destination\.notePhone\(\)/);
    expect(coordinator).toMatch(
      /func handOverOuting\(to destination: GuideDestination, start: OutingHandoverStart\) \{\n[^\n]*\n\s+destination\.notePhone\(\)/,
    );
  });

  it("장소를 길찾기 끝점으로 넘기는 자리가 번호를 적는다", () => {
    // 파일별 적는 자리 수. 장소(`Place`)를 도착지로 넘기는 새 자리를 더하면 여기도 더한다.
    const sites: Record<string, number> = {
      "SearchView.swift": 1, // 장소 줄 「여기까지 길찾기」
      "PlaceDetailView.swift": 2, // 「여기까지 길찾기」·「목적지를 여기로 바꾸기」
      "Directions/DirectionsEndpointSearchView.swift": 2, // 길찾기 검색 결과 선택(일반·갈아탈 곳 아닌 장소)
    };
    for (const [file, count] of Object.entries(sites)) {
      expect(read(file).match(/noteDestinationPhone\(place\)/g)?.length ?? 0, file).toBe(count);
    }
    // 정문 승격(A11): 안내 제목이 정문 이름·좌표가 되므로 고른 장소의 번호를 그 열쇠로도 적는다.
    expect(read("Directions/DirectionsTabView.swift")).toMatch(
      /if let promoted, case \.place\(let label, _, _, _\) = to \{\s+noteDestinationPhone\(\s+label: promoted\.label, lat: promoted\.lat, lng: promoted\.lng,/,
    );
    expect(read("Chat/RouteStartChatCardView.swift").match(/destination\.notePhone\(\)/g)?.length).toBe(2);
    expect(read("Chat/JourneyChatCardView.swift").match(/^\s+notePhone\(\)$/gm)?.length).toBe(2);
  });
});
