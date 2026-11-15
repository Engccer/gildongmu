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
}
