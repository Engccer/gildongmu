import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/manual-location-scenarios.json`)를
/// 소비해 두 판정이 갈리지 않게 한다(드리프트 가드).
private struct Scenarios: Decodable {
    struct FixJSON: Decodable { let lat: Double; let lng: Double; let accuracy: Double; let at: Double }
    struct ManualJSON: Decodable {
        let revision: Int; let label: String; let lat: Double; let lng: Double
        let origin: FixJSON?; let setAt: Double
    }
    struct Case: Decodable {
        let name: String; let manual: ManualJSON; let fix: FixJSON?
        let now: Double; let expect: String
    }
    let cases: [Case]
}

private func loadScenarios() throws -> Scenarios {
    // Kit 테스트는 repo 루트 기준 상대 경로로 웹 fixture를 읽는다(기존 관례).
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/manual-location-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Test func 공유_fixture로_웹과_같은_판정을_낸다() throws {
    let scenarios = try loadScenarios()
    #expect(scenarios.cases.count >= 10)
    for c in scenarios.cases {
        let manual = ManualLocation(
            revision: c.manual.revision, label: c.manual.label,
            lat: c.manual.lat, lng: c.manual.lng,
            origin: c.manual.origin.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) },
            setAt: c.manual.setAt
        )
        let fix = c.fix.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) }
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: c.now)
        #expect(verdict.rawValue == c.expect, "\(c.name): got \(verdict.rawValue), want \(c.expect)")
    }
}

@Test func 상수가_웹과_같고_두_축이_분리돼_있다() {
    #expect(ManualLocationPolicy.movedMeters == 100)
    #expect(ManualLocationPolicy.judgeCeilingMeters == 100)
    #expect(ManualLocationPolicy.fixMaxAgeSeconds == 10)
}

/// 주석·문자열 리터럴을 뺀 구현 본문. **소스 가드는 주석을 보면 안 된다** — 금지
/// 대상을 설명하는 주석이 스스로 위반으로 잡히고(그래서 종전 가드는 주석에도 반응했다),
/// 반대로 코드에서 사라진 참조가 주석에 남아 통과를 막는다.
private func strippingComments(_ source: String) -> String {
    var out = ""
    var rest = Substring(source)
    while let start = rest.range(of: "/*") {
        out += rest[..<start.lowerBound]
        guard let end = rest[start.upperBound...].range(of: "*/") else { rest = ""; break }
        rest = rest[end.upperBound...]
    }
    out += rest
    return out
        .split(separator: "\n", omittingEmptySubsequences: false)
        .map { line -> String in
            // `https://`처럼 콜론 뒤의 `//`는 주석이 아니다.
            var scan = line.startIndex
            while let hit = line[scan...].range(of: "//") {
                let before = hit.lowerBound == line.startIndex ? nil : line[line.index(before: hit.lowerBound)]
                if before == ":" { scan = hit.upperBound; continue }
                return String(line[..<hit.lowerBound])
            }
            return String(line)
        }
        .joined(separator: "\n")
}

/// 소스 가드(Task 13 · 백로그 D23): 안내(BeaconModel)는 수동 위치를 참조하지 않는다 —
/// 실좌표만 쓴다.
///
/// ⚠ **정본은 구조다**: `toggle()`이 좌표 인자를 받지 않아 수동 좌표가 주입될 자리가
/// 없다. 이 가드는 그 구조가 흔들릴 때를 위한 2선이고, 웹 `useRouteGuide.realfix.test.ts`의
/// 정규식 3축(부정·긍정·스토어 부정)과 **대칭**이어야 한다 — 부정 1축만 두면 파일이
/// 통째로 비어도 통과하고, 스토어를 직접 읽는 우회를 못 잡는다.
@Test func 안내_모델이_수동_위치를_참조하지_않는다() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("ios/Gildongmu/Directions/BeaconModel.swift")
    let src = strippingComments(try String(contentsOf: url, encoding: .utf8))
    #expect(!src.contains("effectiveCoordinate"), "안내는 유효 좌표(수동 우선)를 쓰지 않는다")
    #expect(!src.contains("ManualLocationStore"), "수동 위치 스토어를 직접 읽지 않는다")
    #expect(!src.contains("manualLocationLabel"), "수동 위치 라벨을 읽지 않는다")
    // 긍정 축이 없으면 참조가 통째로 사라져도 통과한다(가드가 자기 대상을 잃는다).
    #expect(src.contains("currentCoordinate") || src.contains("currentFix"), "실좌표 경로를 실제로 쓴다")
}

/// 라벨 판정선(I1): `origin` 유무만 보면 **지금** 판정 불가한 상태가 검증 가능형으로
/// 낭독된다 — 더 나쁜 상태가 더 안심시키는 라벨을 내는 역전. 웹
/// `isManualLocationVerified`와 같은 표를 만족해야 한다.
@Test func 검증_가능형_라벨은_origin과_마지막_판정을_모두_본다() {
    let withOrigin = ManualLocation(
        revision: 1, label: "길동 카페", lat: 37.5384, lng: 127.1432,
        origin: ManualFix(lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1), setAt: 1)
    let withoutOrigin = ManualLocation(
        revision: 1, label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: nil, setAt: 1)

    // origin 있음 × 판정 전(nil)·keep → 검증 가능형
    #expect(isManualLocationVerified(withOrigin, verdict: nil))
    #expect(isManualLocationVerified(withOrigin, verdict: .keep))
    // origin 있음 × undecidable(권한 철회·측위 실패) → 검증 불가형
    #expect(!isManualLocationVerified(withOrigin, verdict: .undecidable))
    // origin 없음 → 어떤 판정에서도 검증 불가형
    #expect(!isManualLocationVerified(withoutOrigin, verdict: nil))
    #expect(!isManualLocationVerified(withoutOrigin, verdict: .keep))
    #expect(!isManualLocationVerified(withoutOrigin, verdict: .undecidable))
}
