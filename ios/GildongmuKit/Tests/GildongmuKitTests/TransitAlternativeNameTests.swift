import Testing
@testable import GildongmuKit

// 대안 경로 표시 이름 키 매핑(spec §4.1, 웹 `transit-alternative-name.ts` 미러).
// 판정은 전부 서버가 끝냈고 이 계층은 축·표시 번호를 키로 옮기기만 한다.
// 그래서 이 스위트가 고정하는 것은 "어떤 필드 조합이 어떤 키가 되는가"뿐이다.

@Suite("대안 경로 표시 이름")
struct TransitAlternativeNameTests {
    @Test("두 축이면 조합 키")
    func bothAxes() {
        #expect(TransitAlternativeName.key(highlight: ["fewestTransfers", "fastest"], displayIndex: nil).key
                == "route.transit.alternativeFastestFewestTransfers")
    }

    @Test("축 배열 순서는 결과를 바꾸지 않는다")
    func axisOrderIndependent() {
        #expect(TransitAlternativeName.key(highlight: ["fastest", "fewestTransfers"], displayIndex: nil).key
                == "route.transit.alternativeFastestFewestTransfers")
    }

    @Test("환승 축만")
    func fewest() {
        #expect(TransitAlternativeName.key(highlight: ["fewestTransfers"], displayIndex: nil).key
                == "route.transit.alternativeFewestTransfers")
    }

    @Test("시간 축만")
    func fastest() {
        #expect(TransitAlternativeName.key(highlight: ["fastest"], displayIndex: nil).key
                == "route.transit.alternativeFastest")
    }

    @Test("축 있으면 표시 번호를 쓰지 않는다")
    func axisHasNoIndex() {
        #expect(TransitAlternativeName.key(highlight: ["fastest"], displayIndex: 3).index == nil)
    }

    @Test("축 없으면 번호 키와 displayIndex")
    func numbered() {
        let r = TransitAlternativeName.key(highlight: nil, displayIndex: 2)
        #expect(r.key == "route.transit.alternativeHeading")
        #expect(r.index == 2)
    }

    @Test("빈 축 배열은 축 없음과 같다")
    func emptyHighlight() {
        #expect(TransitAlternativeName.key(highlight: [], displayIndex: 1).key
                == "route.transit.alternativeHeading")
    }

    @Test("번호가 없으면 1")
    func missingIndexFallsBackToOne() {
        // 서버가 축도 번호도 안 준 응답(계약 위반)에서도 번호 없는 문구가 낭독되지
        // 않도록 1로 떨어진다. 웹 `route.displayIndex ?? 1`과 같은 폴백이다.
        #expect(TransitAlternativeName.key(highlight: nil, displayIndex: nil).index == 1)
    }

    @Test("모르는 축 문자열은 무시한다")
    func unknownAxisIgnored() {
        // 서버가 축을 늘려도 구버전 앱이 그 값을 이름으로 쓰지 않고 번호로 떨어진다
        // (mode를 String으로 둔 기존 원칙과 같은 방향의 전방 호환).
        let r = TransitAlternativeName.key(highlight: ["leastWalk"], displayIndex: 2)
        #expect(r.key == "route.transit.alternativeHeading")
        #expect(r.index == 2)
    }
}
