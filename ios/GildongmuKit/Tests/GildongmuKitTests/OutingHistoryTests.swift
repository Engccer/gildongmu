import Testing
@testable import GildongmuKit

@Suite("나들이 방금 말한 것 기록")
struct OutingHistoryTests {
    private func place(_ id: String) -> OutingHistoryPlace {
        OutingHistoryPlace(id: id, name: "가게 \(id)", nameRoman: nil, lat: 37.5, lng: 127.0)
    }

    @Test("최신이 맨 앞이고 순번은 줄마다 다르다")
    func newestFirst() {
        var history = OutingHistory()
        history.record(.crosswalk(audioSignal: false), at: 10)
        history.record(.place(place("a"), side: .left, passedBy: false), at: 20)
        history.record(.road(name: "가로수길"), at: 30)
        #expect(history.entries.map(\.at) == [30, 20, 10])
        #expect(Set(history.entries.map(\.id)).count == 3)
        #expect(history.entries.map(\.content.kindLabel) == ["road", "place", "crosswalk"])
    }

    @Test("최근 50건까지만 둔다 — 넘으면 가장 오래된 줄부터 버린다")
    func capped() {
        var history = OutingHistory()
        for i in 1...(OutingHistory.capacity + 7) {
            history.record(.junction(.cross), at: Double(i))
        }
        #expect(history.entries.count == OutingHistory.capacity)
        #expect(history.entries.first?.at == Double(OutingHistory.capacity + 7))
        #expect(history.entries.last?.at == 8)
    }

    @Test("이미 있는 줄의 순번은 새 줄이 들어와도 바뀌지 않는다")
    func stableIdentity() {
        var history = OutingHistory()
        let first = history.record(.place(place("a"), side: .right, passedBy: false), at: 1)
        history.record(.place(place("b"), side: .left, passedBy: false), at: 2)
        #expect(history.entries.last == first)
    }

    @Test("같은 가게는 한 줄만 남는다 — 지나옴으로 적힌 뒤 말하면 말한 줄로 바뀐다")
    func samePlaceKeepsOneLine() {
        var history = OutingHistory()
        history.record(.place(place("a"), side: .unknown, passedBy: true), at: 1)
        history.record(.place(place("b"), side: .left, passedBy: false), at: 2)
        history.record(.place(place("a"), side: .right, passedBy: false), at: 3)
        #expect(history.entries.count == 2)
        #expect(history.entries.first?.content == .place(place("a"), side: .right, passedBy: false))
        // 가게가 아닌 줄은 같은 내용이어도 따로 남는다.
        history.record(.crosswalk(audioSignal: true), at: 4)
        history.record(.crosswalk(audioSignal: true), at: 5)
        #expect(history.entries.count == 4)
    }

    @Test("세션이 끝나면 전부 지운다")
    func clearForgetsEverything() {
        var history = OutingHistory()
        history.record(.answer(text: "편의점은 길 건너에 있습니다"), at: 1)
        history.clear()
        #expect(history.entries.isEmpty)
        #expect(history.record(.crosswalk(audioSignal: false), at: 2).id == 1)
    }

    @Test("로그 요약과 종류 이름에는 글·이름·좌표가 없다")
    func logCarriesNoText() {
        var history = OutingHistory()
        history.record(.place(place("a"), side: .left, passedBy: true), at: 1)
        history.record(.answer(text: "비밀 답"), at: 2)
        history.record(.road(name: "비밀로"), at: 3)
        #expect(history.logSummary == "n=3")
        let labels = history.entries.map(\.content.kindLabel).joined(separator: " ")
        #expect(labels == "road answer placePassed")
        for secret in ["가게", "비밀", "37.5", "127"] {
            #expect(!labels.contains(secret))
            #expect(!history.logSummary.contains(secret))
        }
    }

    @Test("지난 시간은 분으로 내린다 — 1분 안은 0, 시계가 거꾸로 가도 0")
    func ageMinutes() {
        #expect(outingHistoryAgeMinutes(at: 100, now: 100) == 0)
        #expect(outingHistoryAgeMinutes(at: 100, now: 159.9) == 0)
        #expect(outingHistoryAgeMinutes(at: 100, now: 160) == 1)
        #expect(outingHistoryAgeMinutes(at: 100, now: 100 + 125) == 2)
        #expect(outingHistoryAgeMinutes(at: 100, now: 40) == 0)
    }

    @Test("두 묶음: 「지나온 곳」은 답이 아닌 줄, 「물어본 것」은 답만, 둘 다 최신이 아래(판정 2026-11-17)")
    func splitsPassedAndAnswers() {
        var history = OutingHistory()
        history.record(.place(place("a"), side: .left, passedBy: false), at: 1)
        let firstAnswer = history.record(.answer(text: "첫 답"), at: 2)
        history.record(.junction(.tee), at: 3)
        let secondAnswer = history.record(.answer(text: "둘째 답"), at: 4)
        history.record(.road(name: "가로수길"), at: 5)
        #expect(history.passedEntries.map(\.at) == [1, 3, 5])
        #expect(history.answerEntries == [firstAnswer, secondAnswer])
        // 질문 재료가 읽는 전체 기록은 시간 순서 그대로 섞여 있다.
        #expect(history.entries.map(\.at) == [5, 4, 3, 2, 1])
    }

    @Test("한 번도 묻지 않았으면 「물어본 것」은 비어 있다")
    func noAnswersNoGroup() {
        var history = OutingHistory()
        history.record(.crosswalk(audioSignal: false), at: 1)
        #expect(history.answerEntries.isEmpty)
    }

    @Test("상한은 묶음마다 센다 — 지나온 줄이 아무리 쌓여도 답은 남는다")
    func capacityPerGroup() {
        var history = OutingHistory()
        let answer = history.record(.answer(text: "답"), at: 0)
        for i in 1...(OutingHistory.capacity + 5) {
            history.record(.junction(.cross), at: Double(i))
        }
        #expect(history.answerEntries == [answer])
        #expect(history.passedEntries.count == OutingHistory.capacity)
        #expect(history.passedEntries.first?.at == 6)
        for i in 1...(OutingHistory.capacity + 2) {
            history.record(.answer(text: "답 \(i)"), at: Double(100 + i))
        }
        #expect(history.answerEntries.count == OutingHistory.capacity)
        #expect(history.answerEntries.first?.at == 103)
        #expect(history.passedEntries.count == OutingHistory.capacity)
    }

    @Test("지나온 곳의 보일 줄 수(최신에서 센다): 창 수가 기본이고, 커서가 머문 더 오래된 줄까지는 남긴다")
    func passedShownCount() {
        #expect(outingPassedShownCount(windowCount: 20, total: 29, focusedIndex: nil) == 20)
        #expect(outingPassedShownCount(windowCount: 20, total: 12, focusedIndex: nil) == 12)
        #expect(outingPassedShownCount(windowCount: 20, total: 29, focusedIndex: 5) == 20)
        // 새 줄 두 개가 아래에 들어와 커서가 머문 줄(창의 가장 오래된 줄)이 최신에서 22번째로 밀렸다.
        #expect(outingPassedShownCount(windowCount: 20, total: 31, focusedIndex: 21) == 22)
        #expect(outingPassedShownCount(windowCount: 20, total: 3, focusedIndex: 9) == 3)
    }

    @Test("지나온 곳의 더 보기: 최신 20줄, 누를 때마다 더 오래된 20줄, 첫 새 줄의 최신에서 센 순번을 돌려준다")
    func passedRevealMore() {
        var window = RevealWindow(initialVisible: OutingHistory.passedRevealStep, revealStep: OutingHistory.passedRevealStep)
        #expect(window.visibleCount == 20)
        #expect(outingPassedRevealMore(&window, shown: 20, total: 45) == 20)
        #expect(window.visibleCount == 40)
        #expect(outingPassedRevealMore(&window, shown: 40, total: 45) == 40)
        #expect(window.visibleCount == 45)
        #expect(outingPassedRevealMore(&window, shown: 45, total: 45) == nil)
        #expect(window.visibleCount == 45)
    }

    @Test("커서가 붙든 줄 때문에 창보다 많이 보일 때 더 보기는 보이는 줄 다음부터 연다")
    func passedRevealMorePastKeptRow() {
        var window = RevealWindow(initialVisible: OutingHistory.passedRevealStep, revealStep: OutingHistory.passedRevealStep)
        #expect(outingPassedRevealMore(&window, shown: 22, total: 50) == 22)
        #expect(window.visibleCount == 40)
    }

    @Test("화면 순서(최신이 끝)와 최신에서 센 순번을 잇는다: 커서 줄의 순번, 더 보기가 착지할 줄")
    func passedNewestIndexMapping() {
        let ids = Array(100..<121)   // 21줄, 화면 맨 위가 100(가장 오래됨), 맨 아래가 120(최신)
        #expect(outingPassedFromNewest(ids: ids, focusedID: 120) == 0)
        #expect(outingPassedFromNewest(ids: ids, focusedID: 100) == 20)
        #expect(outingPassedFromNewest(ids: ids, focusedID: nil) == nil)
        #expect(outingPassedFromNewest(ids: ids, focusedID: 7) == nil)
        // 21줄에서 더 보기: 보이던 최신 20줄(101~120)의 맨 윗줄 바로 위 줄(100)에 선다.
        var window = RevealWindow(initialVisible: OutingHistory.passedRevealStep, revealStep: OutingHistory.passedRevealStep)
        let first = outingPassedRevealMore(&window, shown: 20, total: ids.count)
        #expect(first.flatMap { outingPassedRowID(ids: ids, fromNewest: $0) } == 100)
        // 45줄 연속 더 보기: 첫 착지는 종전 맨 윗줄(25번째 자리)의 바로 위, 둘째는 그 위 20줄을 건너뛴 자리.
        let long = Array(0..<45)
        var w2 = RevealWindow(initialVisible: OutingHistory.passedRevealStep, revealStep: OutingHistory.passedRevealStep)
        #expect(outingPassedRevealMore(&w2, shown: 20, total: 45).flatMap { outingPassedRowID(ids: long, fromNewest: $0) } == 24)
        #expect(outingPassedRevealMore(&w2, shown: 40, total: 45).flatMap { outingPassedRowID(ids: long, fromNewest: $0) } == 4)
        #expect(outingPassedRowID(ids: long, fromNewest: 45) == nil)
        #expect(outingPassedRowID(ids: [], fromNewest: 0) == nil)
    }
}
