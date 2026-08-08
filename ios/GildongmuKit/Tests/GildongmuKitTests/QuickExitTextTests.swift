import Testing
import Foundation
@testable import GildongmuKit

/// 빠른하차 문장(E5) — 웹 `quick-exit-text.test.ts`와 같은 케이스를 본다.
/// 문구가 갈리면 같은 하차역이 웹·CLI·앱에서 다르게 낭독된다.
struct QuickExitTextTests {
    private let elevator = QuickExitDoor(kind: "door", doors: ["6-4"])
    private let stairs = QuickExitDoor(kind: "door", doors: ["5-4"])
    private let between = QuickExitDoor(kind: "between", doors: ["3-2", "3-3"])

    @Test func 둘_다() {
        let text = quickExitText(QuickExit(elevator: elevator, stairs: stairs), station: "여의도", lang: "ko")
        #expect(text == "여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문")
    }

    @Test func 엘리베이터만() {
        let text = quickExitText(QuickExit(elevator: elevator), station: "연신내", lang: "ko")
        #expect(text == "연신내 하차, 엘리베이터 6-4 문")
    }

    @Test func 계단만() {
        let text = quickExitText(QuickExit(stairs: stairs), station: "장암", lang: "ko")
        #expect(text == "장암 하차, 계단 5-4 문")
    }

    @Test func 문_사이는_별도_조각() {
        // 문 번호 자리에 원문을 넣으면 "엘리베이터 3-2,3-3 사이 문"이 된다.
        let text = quickExitText(QuickExit(elevator: between), station: "군자", lang: "ko")
        #expect(text == "군자 하차, 엘리베이터 3-2 문과 3-3 문 사이")
    }

    @Test func 값이_없으면_문구를_만들지_않는다() {
        #expect(quickExitText(nil, station: "여의도", lang: "ko") == nil)
        #expect(quickExitText(QuickExit(), station: "여의도", lang: "ko") == nil)
        #expect(quickExitText(QuickExit(elevator: elevator), station: "", lang: "ko") == nil)
    }

    @Test func 빈_doors는_그_시설을_없는_것으로_본다() {
        let empty = QuickExitDoor(kind: "door", doors: [])
        #expect(quickExitText(QuickExit(elevator: empty), station: "여의도", lang: "ko") == nil)
        let onlyStairs = quickExitText(QuickExit(elevator: empty, stairs: stairs), station: "여의도", lang: "ko")
        #expect(onlyStairs == "여의도 하차, 계단 5-4 문")
    }

    @Test func between인데_문이_하나면_단일_형태로_떨어진다() {
        let broken = QuickExitDoor(kind: "between", doors: ["6-4"])
        #expect(quickExitText(QuickExit(elevator: broken), station: "여의도", lang: "ko") == "여의도 하차, 엘리베이터 6-4 문")
    }

    /// 위치 인자가 뒤섞이면 컴파일은 통과하고 낭독만 깨진다 — 로케일별로 잠근다.
    @Test func 로케일별_실문장() {
        let value = QuickExit(elevator: elevator, stairs: QuickExitDoor(kind: "between", doors: ["5-3", "5-4"]))
        #expect(quickExitText(value, station: "Yeouido", lang: "en")
            == "Get off at Yeouido, elevator door 6-4, stairs between doors 5-3 and 5-4")
        #expect(quickExitText(value, station: "汝矣島", lang: "ja")
            == "汝矣島で下車、エレベーターは6-4のドア、階段は5-3と5-4のドアの間")
    }

    @Test func 미지원_로케일은_ko로_떨어진다() {
        let text = quickExitText(QuickExit(elevator: elevator), station: "여의도", lang: "de")
        #expect(text == "여의도 하차, 엘리베이터 6-4 문")
    }

    /// 서버가 실었는데 앱만 침묵하는 조용한 결함을 막는다 — 디코딩부터 문장까지 한 번에.
    @Test func 응답_디코딩부터_문장까지() throws {
        let json = """
        {"mode":"subway","lineName":"수도권 5호선","fromName":"천호","toName":"여의도",
         "stationCount":8,"minutes":24,
         "quickExit":{"elevator":{"kind":"door","doors":["6-4"]},
                      "stairs":{"kind":"door","doors":["5-4"]}}}
        """
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: Data(json.utf8))
        #expect(quickExitText(leg.quickExit, station: leg.toName ?? "", lang: "ko")
            == "여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문")
    }

    @Test func quickExit_없는_응답도_디코딩된다() throws {
        let json = """
        {"mode":"subway","lineName":"수도권 5호선","fromName":"천호","toName":"여의도",
         "stationCount":8,"minutes":24}
        """
        let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: Data(json.utf8))
        #expect(leg.quickExit == nil)
        #expect(quickExitText(leg.quickExit, station: leg.toName ?? "", lang: "ko") == nil)
    }
}

/// 안내 세션 leg로 옮겨 실리는지 — 여기서 끊기면 브리핑에만 나오고 세션 화면은 침묵한다.
struct QuickExitGuideRouteTests {
    @Test func 세션_leg로_옮겨진다() {
        let value = QuickExit(elevator: QuickExitDoor(kind: "door", doors: ["6-4"]))
        let route = TransitRoute(
            summary: TransitRouteSummary(
                totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6,
                departName: nil, arriveName: nil),
            legs: [
                TransitRouteLeg(
                    mode: "subway", lineName: "수도권 5호선", fromName: "천호", toName: "여의도",
                    stationCount: 8, minutes: 24, serviceStatus: nil,
                    firstServiceTime: nil, lastServiceTime: nil, quickExit: value)
            ],
            routeKey: "p0", highlight: nil, displayIndex: nil)
        let guideRoute = buildTransitGuideRoute(route)
        #expect(guideRoute?.legs.first?.quickExit == value)
    }

    @Test func 값이_없으면_세션_leg도_nil() {
        let route = TransitRoute(
            summary: TransitRouteSummary(
                totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6,
                departName: nil, arriveName: nil),
            legs: [
                TransitRouteLeg(
                    mode: "subway", lineName: "수도권 5호선", fromName: "천호", toName: "여의도",
                    stationCount: 8, minutes: 24, serviceStatus: nil,
                    firstServiceTime: nil, lastServiceTime: nil)
            ],
            routeKey: "p0", highlight: nil, displayIndex: nil)
        #expect(buildTransitGuideRoute(route)?.legs.first?.quickExit == nil)
    }
}
