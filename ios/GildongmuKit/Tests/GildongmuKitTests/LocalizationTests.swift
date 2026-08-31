import Foundation
import Testing
@testable import GildongmuKit

/// 복수형 해석기(A29, spec 2026-08-31-plural-forms-design.md §5·§6). 웹 `i18n-plurals.test.ts`와
/// 같은 fixture로 분기 선택 규칙이 한 벌임을 강제하고, 실카탈로그로 세 경로(JSON·lproj·앱)의
/// 공통 함수 `formatLocalized`가 실제 문장을 내는지 본다.
private struct PluralCase: Decodable {
    let lang: String
    let n: Int
    let category: String
}

private func loadPluralCases() throws -> [PluralCase] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/plural-category-cases.json")
    return try JSONDecoder().decode([PluralCase].self, from: Data(contentsOf: url))
}

@Suite("Localization — 복수형 해석기")
struct LocalizationTests {
    @Test func categoryRulesMatchSharedFixture() throws {
        let cases = try loadPluralCases()
        #expect(cases.count >= 20)
        for c in cases {
            #expect(pluralCategory(count: c.n, lang: c.lang) == c.category, "\(c.lang) \(c.n)")
        }
    }

    @Test func unknownLanguageIsOther() {
        #expect(pluralCategory(count: 1, lang: "de") == "other")
    }

    private let placeFormat = "{1, plural, one {%1$@ place} other {%1$@ places}}"

    @Test func resolvesOneAndOther() {
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: [1]) == "%1$@ place")
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: [2]) == "%1$@ places")
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: [0]) == "%1$@ places")
        #expect(resolvePluralBlocks(placeFormat, lang: "fr", args: [0]) == "%1$@ place")
        #expect(resolvePluralBlocks(placeFormat, lang: "ko", args: [1]) == "%1$@ places")
    }

    @Test func stringArgumentsStillSelectByParsedInteger() {
        // 종전 `String(count)` 호출부가 남아도 분기는 맞는다(spec §9). 천 단위 구분자는 other.
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: ["1"]) == "%1$@ place")
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: ["1,234"]) == "%1$@ places")
        #expect(resolvePluralBlocks(placeFormat, lang: "en", args: ["x"]) == "%1$@ places")
    }

    @Test func missingPluralArgumentTrapsInDebug() async {
        // 수량 인자 누락은 호출부 결함이라 DEBUG에서 즉시 멈춘다(설계 리뷰 #5) — 조용히
        // other로 떨어뜨리면 `%2$@`가 인자 없이 String(format:)에 닿는다.
        await #expect(processExitsWith: .failure) {
            _ = resolvePluralBlocks("{2, plural, one {a} other {b}}", lang: "en", args: [1])
        }
        await #expect(processExitsWith: .failure) {
            _ = formatLocalized("{1, plural, one {%1$@ a} other {%1$@ b}}", lang: "en", args: [])
        }
    }

    @Test func blockIndexIsIndependentOfPosition() {
        // walkInfra.audioSite 모양: 셋째 인자가 수량, 앞의 둘은 문자열.
        let format = "%1$@, %2$@ ({3, plural, one {%3$@ device} other {%3$@ devices}})"
        #expect(resolvePluralBlocks(format, lang: "en", args: ["north", "120m", 1]) == "%1$@, %2$@ (%3$@ device)")
        #expect(formatLocalized(format, lang: "en", args: ["north", "120m", 1]) == "north, 120m (1 device)")
    }

    @Test func twoBlocksInOneString() {
        let format = "{1, plural, one {%1$@ disponible} other {%1$@ disponibles}} · {2, plural, one {%2$@ borne} other {%2$@ bornes}}"
        #expect(formatLocalized(format, lang: "fr", args: [1, 12]) == "1 disponible · 12 bornes")
        #expect(formatLocalized(format, lang: "fr", args: [0, 1]) == "0 disponible · 1 borne")
    }

    @Test func literalBracesAndPercentSurvive() {
        // 블록이 아닌 `{`는 리터럴, `%%`는 String(format:)이 `%`로.
        #expect(formatLocalized("{x} %1$@ 100%%", lang: "en", args: [3]) == "{x} 3 100%")
        #expect(resolvePluralBlocks("{1, select, a {b}}", lang: "en", args: [1]) == "{1, select, a {b}}")
        #expect(resolvePluralBlocks("{1, plural, one {a}}", lang: "en", args: [1]) == "{1, plural, one {a}}")
    }

    @Test func intArgumentsRenderLikeStringCount() {
        #expect(formatLocalized("장소 %1$@건", lang: "ko", args: [3]) == "장소 3건")
        #expect(formatLocalized("장소 %1$@건", lang: "ko", args: ["3"]) == "장소 3건")
        #expect(formatLocalized("plain", lang: "ko", args: []) == "plain")
    }

    @Test func realCatalogTransitBusSentence() {
        // Kit 카탈로그(JSON 경로)의 whereAmI.overview.transitBus — ko 불변, en/fr 분기.
        #expect(kitLocalized("whereAmI.overview.transitBus", lang: "ko", 1, "X") == "버스 정류소가 1곳 있습니다. X")
        #expect(kitLocalized("whereAmI.overview.transitBus", lang: "en", 1, "X") == "There is 1 bus stop. X")
        #expect(kitLocalized("whereAmI.overview.transitBus", lang: "en", 3, "X") == "There are 3 bus stops. X")
        #expect(kitLocalized("whereAmI.overview.transitBus", lang: "fr", 0, "X") == "Il y a 0 arrêt de bus. X")
        #expect(kitLocalized("whereAmI.overview.transitBus", lang: "it", 1, "X") == "C'è 1 fermata dell'autobus. X")
    }
}
