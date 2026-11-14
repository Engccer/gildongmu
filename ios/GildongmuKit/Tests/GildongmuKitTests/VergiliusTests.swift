import Foundation
import Testing
@testable import GildongmuKit

@Suite("베르길리우스 말로 묻기 — 앱 쪽 계약과 판정")
struct VergiliusTests {
    private func rel(d: Double, zone: OutingZone, side: OutingSide, s: Double = 0, t: Double = 0, valid: Bool = true)
        -> OutingRelation
    {
        OutingRelation(s: s, t: t, d: d, zone: zone, side: side, validBearing: valid ? 90 : nil)
    }

    private func source(_ id: String, d: Double, zone: OutingZone = .ahead, side: OutingSide = .left)
        -> VergiliusPlaceSource
    {
        VergiliusPlaceSource(
            id: id, name: "가게 \(id)", category: "카페", lat: 37.5, lng: 127.0,
            relation: rel(d: d, zone: zone, side: side))
    }

    // MARK: 선택지

    @Test("선택지는 판정 순서(OpenAI → Sonnet → Opus → Haiku → Gemini)이고 모르는 이름은 건너뛴다")
    func providerOrder() {
        // 서버 목록 순서(OpenAI, Google, Opus, Sonnet, Haiku)와 상관없이 화면 순서로 선다.
        let server = ["google", "claude-opus", "mystery", "claude-sonnet", "claude-haiku", "openai"]
        #expect(VergiliusProvider.choices(server: server) == ["openai", "claude-sonnet", "claude-opus", "claude-haiku", "google"])
        #expect(VergiliusProvider.displayName("claude-haiku") == "Claude Haiku")
        #expect(VergiliusProvider.choices(server: ["google"]) == ["google"])
        #expect(VergiliusProvider.choices(server: []) == [])
        #expect(VergiliusProvider.displayOrder.allSatisfy { VergiliusProvider.displayName($0) != nil })
    }

    @Test("저장값이 닫혔으면 목록 맨 앞, 열린 것이 없으면 nil")
    func effectiveProvider() {
        #expect(VergiliusProvider.effective(stored: "google", choices: ["openai", "google"]) == "google")
        #expect(VergiliusProvider.effective(stored: "claude-opus", choices: ["openai", "google"]) == "openai")
        #expect(VergiliusProvider.effective(stored: nil, choices: ["claude-sonnet"]) == "claude-sonnet")
        #expect(VergiliusProvider.effective(stored: "openai", choices: []) == nil)
    }

    // MARK: 요청 인코딩

    @Test("모르는 값은 키를 빼지 않고 null로 싣는다(서버 nullable은 키 필수)")
    func encodesNulls() throws {
        let body = VergiliusAskBody(
            question: "  앞에 뭐 있어?  ", locale: "ko", provider: "openai", lat: 37.5, lng: 127.0, headingKnown: false,
            places: [], junctionAhead: nil, nextCrosswalkMeters: nil, roadName: nil, log: [])
        let json = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        #expect(json["question"] as? String == "앞에 뭐 있어?")
        #expect(json["junctionAhead"] is NSNull)
        #expect(json["nextCrosswalkMeters"] is NSNull)
        #expect(json["roadName"] is NSNull)
        let location = try #require(json["location"] as? [String: Double])
        #expect(location == ["lat": 37.5, "lng": 127.0])
    }

    @Test("값이 있으면 서버 모양 그대로 싣고, 도로명은 한 줄로 만든다")
    func encodesValues() throws {
        let body = VergiliusAskBody(
            question: "q", locale: "en", provider: "google", lat: 1, lng: 2, headingKnown: true,
            places: vergiliusPlaces([source("a", d: 12.4)], headingKnown: true),
            junctionAhead: VergiliusJunctionAhead(meters: 15, branches: 4), nextCrosswalkMeters: 22,
            roadName: "가로수길\n", log: [])
        let json = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        #expect(json["roadName"] as? String == "가로수길")
        #expect((json["junctionAhead"] as? [String: Any])?["branches"] as? Int == 4)
        let place = try #require((json["places"] as? [[String: Any]])?.first)
        #expect(place["zone"] as? String == "ahead")
        #expect(place["side"] as? String == "left")
        #expect(place["distance"] as? Double == 12)
    }

    @Test("질문 글은 500자(UTF-16)에서 자른다")
    func questionCapped() {
        let body = VergiliusAskBody(
            question: String(repeating: "가", count: 600), locale: "ko", provider: "openai", lat: 0, lng: 0,
            headingKnown: false, places: [], junctionAhead: nil, nextCrosswalkMeters: nil, roadName: nil, log: [])
        #expect(body.question.utf16.count == vergiliusQuestionMax)
    }

    // MARK: 재료

    @Test("가게는 가까운 순 30곳, 5km 넘는 곳과 이름 없는 곳은 뺀다")
    func placesCapped() {
        var sources = (0..<40).map { source("p\($0)", d: Double(100 - $0)) }
        sources.append(source("far", d: 5001))
        sources.append(VergiliusPlaceSource(
            id: "blank", name: " \n", category: "", lat: 0, lng: 0, relation: rel(d: 1, zone: .ahead, side: .left)))
        let places = vergiliusPlaces(sources, headingKnown: true)
        #expect(places.count == vergiliusPlacesMax)
        #expect(places.first?.id == "p39")
        #expect(places.map(\.distance) == places.map(\.distance).sorted())
        #expect(!places.contains { $0.id == "far" || $0.id == "blank" })
    }

    @Test("방향을 모르면 구획·좌우를 모름으로 보낸다(방향 없는 관계는 「옆」이라 그대로 보내면 단정이 된다)")
    func unknownHeading() {
        let places = vergiliusPlaces([source("a", d: 5, zone: .beside, side: .right)], headingKnown: false)
        #expect(places.first?.zone == .unknown)
        #expect(places.first?.side == .unknown)
        let known = vergiliusPlaces([source("a", d: 5, zone: .behind, side: .right)], headingKnown: true)
        #expect(known.first?.zone == .behind)
        #expect(known.first?.side == .right)
    }

    @Test("기록은 최신부터 20건, 지나온 가게는 싣지 않고 가게 줄은 id를 단다")
    func logEntries() {
        var history = OutingHistory()
        let place = OutingHistoryPlace(id: "k1", name: "카페", nameRoman: nil, lat: 0, lng: 0)
        history.record(.place(place, side: .left, passedBy: false), at: 100)
        history.record(
            .place(OutingHistoryPlace(id: "k2", name: "약국", nameRoman: nil, lat: 0, lng: 0), side: .left, passedBy: true),
            at: 110)
        for i in 0..<25 { history.record(.junction(.cross), at: 200 + Double(i)) }
        history.record(.answer(text: "왼쪽에 카페가 있습니다."), at: 300)
        let log = vergiliusLog(history.entries, now: 330) { content in
            if case .answer(let text) = content { return text }
            return "문장"
        }
        #expect(log.count == vergiliusLogMax)
        #expect(log.first == VergiliusLogInput(kind: .answer, text: "왼쪽에 카페가 있습니다.", agoSeconds: 30, placeId: nil))
        #expect(!log.contains { $0.placeId == "k2" })

        var short = OutingHistory()
        short.record(.place(place, side: .left, passedBy: false), at: 100)
        #expect(vergiliusLog(short.entries, now: 160) { _ in "카페, 왼쪽" }.first?.placeId == "k1")
        #expect(vergiliusLog(short.entries, now: 160) { _ in "  " }.isEmpty)
    }

    @Test("앞쪽 갈림길과 다음 횡단보도는 방향을 알 때 앞에 있는 가장 가까운 것이다")
    func aheadNodes() {
        func junction(_ n: Int) -> OutingJunction {
            OutingJunction(
                id: "j\(n)", lat: 0, lng: 0,
                branches: (0..<n).map { _ in OutingBranch(lat: 0, lng: 0, kind: .road) }, fromProbe: false)
        }
        let candidates = [
            (junction: junction(4), relation: rel(d: 18, zone: .ahead, side: .left, s: 18), branches: [OutingRelation]()),
            (junction: junction(3), relation: rel(d: 12, zone: .ahead, side: .left, s: 12), branches: []),
            (junction: junction(3), relation: rel(d: 5, zone: .ahead, side: .left, s: 5, valid: false), branches: []),
        ]
        #expect(vergiliusJunctionAhead(candidates) == VergiliusJunctionAhead(meters: 12, branches: 3))
        #expect(vergiliusJunctionAhead([]) == nil)

        let crosswalks = [
            rel(d: 40, zone: .ahead, side: .left, s: 40, t: 3),
            rel(d: 25, zone: .ahead, side: .left, s: 24.6, t: 2),
            rel(d: 20, zone: .ahead, side: .left, s: 10, t: 30),
            rel(d: 8, zone: .behind, side: .left, s: -8, t: 0),
        ]
        #expect(vergiliusNextCrosswalkMeters(crosswalks) == 25)
        #expect(vergiliusNextCrosswalkMeters([rel(d: 5, zone: .ahead, side: .left, s: 5, valid: false)]) == nil)
    }

    // MARK: 응답

    @Test("NDJSON 줄을 이벤트로 읽고, route-start 밖의 렌더는 버린다")
    func decodesEvents() throws {
        if case .text(let delta, let final) = try decodeVergiliusEventLine(#"{"type":"text","delta":"안녕","final":true}"#) {
            #expect(delta == "안녕")
            #expect(final)
        } else {
            Issue.record("text가 아니다")
        }
        if case .reset = try decodeVergiliusEventLine(#"{"type":"reset"}"#) {} else { Issue.record("reset") }
        let done = try decodeVergiliusEventLine(
            #"{"type":"done","text":"","renders":[{"type":"places","places":[]}],"proposal":{"placeId":"k1"}}"#)
        if case .done(let text, let renders, let proposal) = done {
            #expect(text == "")
            #expect(renders.isEmpty)
            #expect(proposal == "k1")
        } else {
            Issue.record("done이 아니다")
        }
        if case .done(_, _, let proposal) = try decodeVergiliusEventLine(
            #"{"type":"done","text":"끝","renders":[],"proposal":null}"#) {
            #expect(proposal == nil)
        } else {
            Issue.record("done")
        }
        if case .error(let code) = try decodeVergiliusEventLine(#"{"type":"error","code":"empty_answer"}"#) {
            #expect(code == "empty_answer")
        } else {
            Issue.record("error")
        }
        if case .outOfCoverage = try decodeVergiliusEventLine(#"{"outOfCoverage":true}"#) {} else {
            Issue.record("outOfCoverage")
        }
        if case .unknown = try decodeVergiliusEventLine(#"{"type":"status"}"#) {} else { Issue.record("unknown") }
    }

    // MARK: 문장 나누기

    @Test("끝 부호 뒤에 공백이 와야 문장이 끝난다 — 3.5km의 점은 끝이 아니다")
    func splitsSentences() {
        var s = VergiliusSentenceSplitter()
        #expect(s.append("왼쪽 3.") == [])
        #expect(s.append("5km 앞에 카페가 있습니다.") == [])
        #expect(s.append(" 오른쪽에는") == ["왼쪽 3.5km 앞에 카페가 있습니다."])
        #expect(s.append(" 약국이 있어요! 그리고") == ["오른쪽에는 약국이 있어요!"])
        #expect(s.flush() == "그리고")
        #expect(s.flush() == nil)
    }

    @Test("닫는 따옴표·괄호는 문장에 딸리고, 줄바꿈도 끝이다")
    func closersAndNewlines() {
        var s = VergiliusSentenceSplitter()
        #expect(s.append("「여기」라고 했어요.\" 다음") == ["「여기」라고 했어요.\""])
        #expect(s.append(" 줄\n둘째 줄") == ["다음 줄"])
        #expect(s.flush() == "둘째 줄")
        var en = VergiliusSentenceSplitter()
        #expect(en.append("Turn left... Then go 1.2 km. ") == ["Turn left...", "Then go 1.2 km."])
    }

    // MARK: 읽기 진행

    @Test("final 글만 읽고, reset은 읽지 않은 문장을 버리고, done은 남은 글을 마저 읽는다")
    func readerFlow() {
        var r = VergiliusReader()
        #expect(r.receive(.text(delta: "도구 앞 군말. ", final: false)) == [])
        #expect(r.receive(.text(delta: "첫 문장. 둘", final: true)) == [.speak("첫 문장.")])
        #expect(r.receive(.reset) == [.discardUnread])
        #expect(r.receive(.text(delta: "새 답입니다. 끝", final: true)) == [.speak("새 답입니다.")])
        #expect(r.receive(.done(text: "새 답입니다. 끝", renders: [], proposalPlaceId: nil))
            == [.speak("끝"), .finish(text: "새 답입니다. 끝", renders: [], proposalPlaceId: nil)])
        #expect(r.receive(.error(code: "x")) == [])
        #expect(r.timedOut() == [])
    }

    @Test("제안이 오면 모델 글을 읽지 않고 틀 문장 차례다")
    func readerProposal() {
        var r = VergiliusReader()
        _ = r.receive(.text(delta: "안내할게요. 잠", final: true))
        #expect(r.receive(.done(text: "", renders: [], proposalPlaceId: "k1"))
            == [.discardUnread, .finish(text: "", renders: [], proposalPlaceId: "k1")])
    }

    @Test("실패 두 갈래: 읽을 문장 전이면 「받지 못함」, 뒤면 「끊김」")
    func readerFailures() {
        var a = VergiliusReader()
        #expect(a.timedOut() == [.fail(.noAnswer)])
        #expect(a.streamEnded() == [])

        var b = VergiliusReader()
        _ = b.receive(.text(delta: "군말", final: true))
        #expect(b.receive(.error(code: "vergilius_failed")) == [.fail(.noAnswer)])

        var c = VergiliusReader()
        _ = c.receive(.text(delta: "한 문장. ", final: true))
        #expect(c.timedOut() == [])
        #expect(c.streamEnded() == [.fail(.cutOff)])

        var d = VergiliusReader()
        #expect(d.receive(.outOfCoverage) == [.fail(.noAnswer)])

        // 군말이 읽을 줄에 섰다가 reset으로 버려지면 첫 문장 시한이 다시 산다(답 없이 도구가 늦으면 「받지 못함」).
        var e = VergiliusReader()
        _ = e.receive(.text(delta: "찾아볼게요. ", final: true))
        #expect(e.timedOut() == [])
        _ = e.receive(.reset)
        #expect(e.timedOut() == [.fail(.noAnswer)])
    }
}
