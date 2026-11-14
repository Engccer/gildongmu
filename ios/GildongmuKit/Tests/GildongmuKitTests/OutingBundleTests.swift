import Foundation
import Testing

@testable import GildongmuKit

/// 나들이 묶어 말하기(E82 V1~V7, spec 2026-11-14-e82-vergilius-v1-design §3.1·§6).
///
/// 재생 테스트의 길과 가게는 **손으로 설계한 합성 자료**다(`synthetic()`): 실제 보행 궤적이나 실제 장소에서 유도하지
/// 않았다. 실보행 기록은 걸은 길의 모양과 가게 배치가 남으므로 저장소에 두지 않는다 — 실세션 수치는 저장소 밖 자료로만
/// 잰다(`replayPrivateSession`, 경로를 환경 변수로 준 때만 돈다).
@Suite("나들이 묶어 말하기")
struct OutingBundleTests {
    private let baseLat = 36.2
    private let baseLng = 127.9
    private let north = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)

    private func rel(east: Double, north n: Double, heading: OutingHeading? = nil) -> OutingRelation {
        outingProject(
            fixLat: baseLat, fixLng: baseLng, accuracy: 5, heading: heading ?? north,
            placeLat: baseLat + n / 110_540, placeLng: baseLng + east / (111_320 * cos(baseLat * .pi / 180)))
    }

    private func passing(_ id: String, east: Double) -> OutingPassByCandidate {
        OutingPassByCandidate(id: id, previous: rel(east: east, north: 12), current: rel(east: east, north: 0))
    }

    // MARK: 묶음 (V4·V5·V0d)

    @Test("새로 지나친 가게는 덮어쓰지 않고 더해지고, 같은 가게는 한 번만 든다")
    func addsWithoutOverwriting() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12)], stopped: false)
        bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        bundle.observe(candidates: [passing("b", east: 14), passing("c", east: -20)], stopped: false)
        #expect(bundle.pending == ["a", "b", "c"])
    }

    @Test("한 위치 갱신에서 지나친 가게는 전부 든다")
    func allAtOnce() {
        var bundle = OutingBundle()
        let added = bundle.observe(
            candidates: [passing("far", east: 30), passing("near", east: -12), passing("mid", east: 16)], stopped: false)
        #expect(added.map(\.id) == ["near", "mid", "far"])
        #expect(bundle.pending == ["near", "mid", "far"])
    }

    @Test("문장이 되어도 끝까지 말해지기 전에는 말한 것이 아니다")
    func spokenOnlyAfterFinish() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        let out = bundle.compose(relations: ["a": rel(east: -12, north: -3), "b": rel(east: 14, north: -3)])
        #expect(out.line == OutingBundleLine(left: ["a"], right: ["b"], beside: []))
        #expect(bundle.spoken.isEmpty)
        #expect(bundle.inFlight == ["a", "b"])
        #expect(bundle.finishSpoken() == ["a", "b"])
        #expect(bundle.spoken == ["a", "b"])
        #expect(bundle.inFlight.isEmpty)
    }

    @Test("끊기거나 버려진 묶음은 되돌아오고, 그 사이 지나친 가게 앞에 선다")
    func droppedComesBack() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12)], stopped: false)
        _ = bundle.compose(relations: ["a": rel(east: -12, north: -3)])
        bundle.observe(candidates: [passing("b", east: 14)], stopped: false)
        bundle.finishDropped()
        #expect(bundle.pending == ["a", "b"])
        #expect(bundle.spoken.isEmpty)
        // 되돌아온 가게는 다음 문장에 다시 실린다.
        let again = bundle.compose(relations: ["a": rel(east: -12, north: -9), "b": rel(east: 14, north: -3)])
        #expect(again.line?.ids.sorted() == ["a", "b"])
    }

    @Test("끊길수록 길게 쉬고(3·6·12초), 세 번 끊긴 가게는 말하기를 그만두고 지나옴으로 넘긴다")
    func dropsAreCapped() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12)], stopped: false)
        let near = ["a": rel(east: -12, north: -3), "b": rel(east: 14, north: -3)]
        var holds: [Double] = []
        for round in 1...2 {
            #expect(bundle.compose(relations: near).line?.ids == ["a"], "\(round)")
            let drop = bundle.finishDropped()
            holds.append(drop.holdSeconds)
            #expect(drop.givenUp.isEmpty)
            #expect(bundle.pending == ["a"])
        }
        // 두 번 끊긴 가게와 처음 실리는 가게가 한 문장에 실려 끊겼다 — 세 번째인 가게만 넘어가고 처음인 가게는 남는다.
        bundle.observe(candidates: [passing("b", east: 14)], stopped: false)
        #expect(bundle.compose(relations: near).line?.ids.sorted() == ["a", "b"])
        let last = bundle.finishDropped()
        holds.append(last.holdSeconds)
        #expect(holds == [3, 6, 12])
        #expect(last.givenUp == ["a"])
        #expect(bundle.passedBy == ["a"])
        #expect(bundle.pending == ["b"])
        #expect(!bundle.spoken.contains("a"))
        // 넘긴 가게는 다시 문장이 되지 않는다.
        #expect(bundle.compose(relations: near).line?.ids == ["b"])
        bundle.finishSpoken()
        #expect(bundle.compose(relations: near).line == nil)
        #expect(outingBundleMaxDrops == 3)
    }

    @Test("끝까지 말한 뒤에는 끊긴 횟수를 잊는다")
    func spokenClearsDropCount() {
        #expect((1...4).map { outingBundleRetryHoldSeconds(drops: $0) } == [3, 6, 12, 12])
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12)], stopped: false)
        let near = ["a": rel(east: -12, north: -3)]
        _ = bundle.compose(relations: near)
        #expect(bundle.finishDropped().holdSeconds == 3)
        _ = bundle.compose(relations: near)
        #expect(bundle.finishSpoken() == ["a"])
        #expect(bundle.passedBy.isEmpty)
    }

    @Test("앞 문장의 끝을 기다리는 동안에는 다음 문장을 만들지 않는다")
    func oneSentenceAtATime() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12)], stopped: false)
        _ = bundle.compose(relations: ["a": rel(east: -12, north: -3)])
        bundle.observe(candidates: [passing("b", east: 14)], stopped: false)
        let second = bundle.compose(relations: ["b": rel(east: 14, north: -3)])
        #expect(second.line == nil)
        #expect(bundle.pending == ["b"])
    }

    @Test("말했거나 지나옴으로 넘긴 가게는 다시 들지 않는다")
    func heldNeverReturns() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        _ = bundle.compose(relations: ["a": rel(east: -12, north: -3), "b": rel(east: 14, north: -60)])
        bundle.finishSpoken()
        #expect(bundle.spoken == ["a"])
        #expect(bundle.passedBy == ["b"])
        let added = bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        #expect(added.isEmpty)
        #expect(bundle.pending.isEmpty)
    }

    // MARK: 문장화 (V2·V6)

    @Test("좌우는 문장이 되는 순간의 위치와 방향으로 다시 읽고, 한 쪽 안은 가까운 순이다")
    func sidesAtComposeTime() {
        var bundle = OutingBundle()
        bundle.observe(
            candidates: [passing("l-far", east: -25), passing("l-near", east: -12), passing("r", east: 14)], stopped: false)
        // 그 사이 되돌아섰다(진행 방향 남쪽) — 지나칠 때 왼쪽이던 가게가 지금은 오른쪽이다.
        let south = OutingHeading.valid(bearing: 180, uncertaintyDeg: 10)
        let out = bundle.compose(relations: [
            "l-far": rel(east: -25, north: -3, heading: south), "l-near": rel(east: -12, north: -3, heading: south),
            "r": rel(east: 14, north: -3, heading: south),
        ])
        #expect(out.line == OutingBundleLine(left: ["r"], right: ["l-near", "l-far"], beside: []))
    }

    @Test("방향을 모르면 좌우를 말하지 않는다")
    func unknownHeadingIsBeside() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        for heading in [OutingHeading.none, .stale(bearing: 0)] {
            var copy = bundle
            let out = copy.compose(relations: [
                "a": rel(east: -12, north: -3, heading: heading), "b": rel(east: 14, north: -3, heading: heading),
            ])
            #expect(out.line == OutingBundleLine(left: [], right: [], beside: ["a", "b"]))
        }
    }

    @Test("40m 넘게 지나온 가게는 말하지 않고 지나옴으로 넘긴다")
    func staleGoesToPassedBy() {
        var bundle = OutingBundle()
        bundle.observe(candidates: [passing("a", east: -12), passing("b", east: 14)], stopped: false)
        let out = bundle.compose(relations: ["a": rel(east: -12, north: -45), "b": rel(east: 14, north: -30)])
        #expect(out.passedBy == ["a"])
        #expect(out.line == OutingBundleLine(left: [], right: ["b"], beside: []))
        // 전부 지나왔으면 문장이 없고 끝 신호를 기다리지도 않는다.
        var all = OutingBundle()
        all.observe(candidates: [passing("a", east: -12)], stopped: false)
        let none = all.compose(relations: ["a": rel(east: -12, north: -80)])
        #expect(none.line == nil)
        #expect(none.passedBy == ["a"])
        #expect(all.inFlight.isEmpty)
    }

    // MARK: 방향 없는 지나침 (V3)

    private func approach(_ bundle: inout OutingBundle, _ id: String, d: Double, stopped: Bool = false) -> [OutingBundleAddition] {
        // 방향을 모르는 fix의 관계(구획·좌우 없음, 거리만).
        let relation = OutingRelation(s: 0, t: 0, d: d, zone: .beside, side: .unknown, validBearing: nil)
        return bundle.observe(candidates: [OutingPassByCandidate(id: id, previous: nil, current: relation)], stopped: stopped)
    }

    @Test("방향을 몰라도 길가 20m 안 가게와의 거리가 줄다가 8m 늘면 지나친 것이다")
    func approachWithoutHeading() {
        var bundle = OutingBundle()
        for d in [40.0, 28, 18, 12, 14, 19] { #expect(approach(&bundle, "a", d: d).isEmpty) }
        let added = approach(&bundle, "a", d: 20)
        #expect(added == [OutingBundleAddition(id: "a", byApproach: true)])
        #expect(approach(&bundle, "a", d: 30).isEmpty)  // 한 번만
    }

    @Test("길가 20m 안으로 들어온 적이 없는 가게는 세지 않는다")
    func approachNeedsRoadside() {
        var bundle = OutingBundle()
        for d in [60.0, 40, 25, 21, 30, 45, 70] { #expect(approach(&bundle, "a", d: d).isEmpty) }
    }

    @Test("처음 본 뒤로 멀어지기만 한 가게는 세지 않는다 — 다가간 적이 없으면 지나친 것이 아니다")
    func recedingOnlyIsNotPassed() {
        var bundle = OutingBundle()
        // 이미 지나온 자리에서 목록에 든 가게: 처음 6m, 그 뒤로 멀어지기만 한다.
        for d in [6.0, 9, 15, 22, 30, 41] { #expect(approach(&bundle, "a", d: d).isEmpty) }
        #expect(!bundle.held.contains("a"))
        // 같은 거리 열이라도 앞에 더 먼 관측이 한 번 있었으면(다가왔다) 센다.
        #expect(approach(&bundle, "b", d: 9).isEmpty)
        #expect(approach(&bundle, "b", d: 6).isEmpty)
        #expect(approach(&bundle, "b", d: 9).isEmpty)
        #expect(approach(&bundle, "b", d: 15).map(\.id) == ["b"])
    }

    @Test("정지 중의 흔들림은 다가옴으로 치지 않는다")
    func stoppedJitterIsNotApproach() {
        var bundle = OutingBundle()
        _ = approach(&bundle, "a", d: 12)
        for d in [25.0, 9, 31, 4, 28] { #expect(approach(&bundle, "a", d: d, stopped: true).isEmpty) }
        // 걷는 동안에는 멀어지기만 했다 — 정지 중에 가까워 보인 값(9m, 4m)은 다가옴이 아니다.
        for d in [18.0, 22, 30] { #expect(approach(&bundle, "a", d: d).isEmpty) }
    }

    @Test("정지 판정 중에는 세지 않고 거리도 갱신하지 않는다")
    func stoppedCountsNothing() {
        var bundle = OutingBundle()
        _ = approach(&bundle, "a", d: 30)
        _ = approach(&bundle, "a", d: 12)
        // 서 있는 동안 GPS가 흔들려 거리가 크게 늘었다 줄었다.
        for d in [25.0, 9, 31, 4, 28] { #expect(approach(&bundle, "a", d: d, stopped: true).isEmpty) }
        // 다시 걷는다 — 정지 중의 가까운 값(4m)은 기준이 아니다: 12m에서 8m 늘어야 한다.
        #expect(approach(&bundle, "a", d: 18).isEmpty)
        #expect(approach(&bundle, "a", d: 20).map(\.id) == ["a"])
    }

    // MARK: 재생 (§6) — 손으로 설계한 합성 길

    struct Replay: Decodable {
        struct Heading: Decodable {
            let kind: String
            let bearing: Double?
            let u: Double?
        }
        struct Fix: Decodable {
            let t: Double
            let lat: Double
            let lng: Double
            let acc: Double
            let motion: String
            let heading: Heading
        }
        struct Place: Decodable {
            let id: String
            let lat: Double
            let lng: Double
            let knownAtFix: Int
            let roadside: Bool
        }
        struct Safety: Decodable {
            let t: Double
        }
        let fixes: [Fix]
        let places: [Place]
        let safety: [Safety]
    }

    /// 합성 길을 그리는 붓. 좌표는 임의 원점에서 동·북으로 잰 미터이고, 1초에 1.2m씩 걷는다.
    private struct Track {
        enum HeadingKind { case valid, stale, none }

        static let stepMeters = 1.2
        let baseLat = 36.2
        let baseLng = 127.9
        var east = 0.0
        var north = 0.0
        /// 진행 방위(도, 북 0·시계 방향).
        var bearing = 0.0
        var t = 0.0
        var fixes: [Replay.Fix] = []
        var places: [Replay.Place] = []
        /// 설계할 때 정한 가게의 쪽(길을 걷는 사람 기준) — 문장의 좌우를 이 값과 견준다.
        var truthSide: [String: OutingSide] = [:]

        private func latLng(_ e: Double, _ n: Double) -> (lat: Double, lng: Double) {
            (baseLat + n / 110_540, baseLng + e / (111_320 * cos(baseLat * .pi / 180)))
        }

        mutating func fix(_ kind: HeadingKind, stopped: Bool = false, jitter: (e: Double, n: Double) = (0, 0)) {
            let at = latLng(east + jitter.e, north + jitter.n)
            let heading: Replay.Heading =
                switch kind {
                case .valid: .init(kind: "valid", bearing: bearing, u: 10)
                case .stale: .init(kind: "stale", bearing: bearing, u: nil)
                case .none: .init(kind: "none", bearing: nil, u: nil)
                }
            fixes.append(
                .init(t: t, lat: at.lat, lng: at.lng, acc: 5, motion: stopped ? "stopped" : "moving", heading: heading))
            t += 1
        }

        /// `meters`를 걷는다. `turn`(도)을 주면 걷는 동안 그만큼 고르게 꺾는다(양수 = 오른쪽).
        mutating func walk(_ meters: Double, turn: Double = 0, heading kind: HeadingKind = .valid) {
            let steps = Int((meters / Self.stepMeters).rounded())
            for _ in 0..<steps {
                bearing += turn / Double(steps)
                east += Self.stepMeters * sin(bearing * .pi / 180)
                north += Self.stepMeters * cos(bearing * .pi / 180)
                fix(kind)
            }
        }

        /// 서 있는다: 정지 판정, 방향 없음, 위치는 GPS 흔들림만큼 튄다.
        mutating func stand(_ seconds: Int) {
            let jitters: [(e: Double, n: Double)] = [(5, -4), (-6, 3), (4, 6), (-3, -5), (6, 1), (-5, -2)]
            for i in 0..<seconds { fix(.none, stopped: true, jitter: jitters[i % jitters.count]) }
        }

        /// 지금 서 있는 자리 옆(`back`을 주면 그만큼 지나온 자리 옆)에 가게를 둔다. `lateral`은 길에서 떨어진 거리(m).
        mutating func place(
            _ id: String, _ side: OutingSide, _ lateral: Double, back: Double = 0, roadside: Bool = true,
            knownAtFix: Int = 0
        ) {
            let along = bearing * .pi / 180
            let across = (bearing + (side == .left ? -90 : 90)) * .pi / 180
            let e = east - back * sin(along) + lateral * sin(across)
            let n = north - back * cos(along) + lateral * cos(across)
            let at = latLng(e, n)
            places.append(.init(id: id, lat: at.lat, lng: at.lng, knownAtFix: knownAtFix, roadside: roadside))
            truthSide[id] = side
        }
    }

    struct Scenario {
        let data: Replay
        let truthSide: [String: OutingSide]
        /// 다가간 적이 없는 가게(등 뒤에서 시작, 지나온 뒤에 목록에 듦) — 어떤 판정으로도 「지나쳤다」가 되면 안 된다.
        let recedingOnly: [String]
        /// 방향을 잃은 구간에서 지나치는 가게 — 진행 방향 판정으로는 잡히지 않는다.
        let headingLost: [String]
    }

    /// 손으로 설계한 길(1초에 한 번 위치, 걸음 1.2m): 직선 → 오른쪽으로 굽은 길 → 직선(가운데 12초 정지) → 방향을 잃은 구간 → 가게가 몰린 구간 → 꼬리.
    /// 실제 보행 기록에서 유도한 값은 없다.
    private func synthetic() -> Scenario {
        var track = Track()
        track.fix(.valid)
        track.place("behind", .left, 6, back: 12, roadside: false)  // 출발점 등 뒤
        // 직선(북쪽으로 120m): 좌우에 띄엄띄엄.
        track.walk(20)
        track.place("a1", .left, 8)
        track.walk(25)
        track.place("a2", .right, 10)
        track.walk(15)
        track.place("far", .left, 35, roadside: false)  // 길가 20m 밖
        track.place("late", .right, 9, back: 30, roadside: false, knownAtFix: track.fixes.count)  // 지나온 뒤에 목록에 듦
        track.walk(10)
        track.place("a3", .left, 12)
        track.walk(25)
        track.place("a4", .right, 6)
        track.walk(25)
        // 굽은 길(오른쪽으로 90도, 48m): 바깥쪽에 한 곳.
        track.walk(24, turn: 45)
        track.place("b1", .left, 10)
        track.walk(24, turn: 45)
        // 직선(동쪽으로 80m), 가운데서 12초 선다. 선 자리 바로 옆에 한 곳.
        track.walk(20)
        track.place("c1", .right, 9)
        track.walk(20)
        track.place("c2", .left, 7)
        track.stand(12)
        track.walk(40)
        // 방향을 잃은 구간(70m): 앞 절반은 방향 없음, 뒤 절반은 낡은 방향.
        track.walk(15, heading: .none)
        track.place("d1", .left, 9)
        track.walk(15, heading: .none)
        track.place("d2", .right, 11)
        track.walk(5, heading: .none)
        track.walk(15, heading: .stale)
        track.place("d3", .left, 7)
        track.walk(20, heading: .stale)
        // 가게가 몰린 구간(60m): 한 걸음(1.2m)마다 좌우로 일곱 곳 — 한 문장이 끝나기 전에 다음 가게를 지나친다.
        track.walk(10)
        for (i, lateral) in [6.0, 8, 10, 6, 12, 9, 7].enumerated() {
            track.place("e\(i + 1)", i % 2 == 0 ? .left : .right, lateral)
            track.walk(1.2)
        }
        track.walk(40)
        // 꼬리(70m): 마지막 가게들이 말해질 시간.
        track.walk(70)
        return Scenario(
            data: Replay(
                fixes: track.fixes, places: track.places,
                safety: [30, 118, 190, 262, 300].map { Replay.Safety(t: $0) }),
            truthSide: track.truthSide, recedingOnly: ["behind", "late"], headingLost: ["d1", "d2", "d3"])
    }

    struct ReplayResult {
        var bundle = OutingBundle()
        /// 끝까지 말해진 문장에 실린 횟수(가게별).
        var delivered: [String: Int] = [:]
        /// 문장에 실려 나간 횟수(가게별, 끊긴 것 포함).
        var emitted: [String: Int] = [:]
        var sentences: [OutingBundleLine] = []
        var dropped = 0
        var givenUp: [String] = []
        var approachAdds = 0
        var approachAddsWhileStopped = 0
        /// 문장을 만든 순간 방향을 모르는데 좌우를 말한 가게 수.
        var sidedWithoutHeading = 0
        /// 문장이 **끝나는** 시각의 위치와 방향으로 다시 투영했을 때 말한 좌우와 어긋난 가게 수(방향이 유효한 끝만 센다).
        var wrongSidesAtEnd = 0
        /// 설계한 쪽과 어긋난 좌우(합성 길에서만).
        var wrongSidesVsTruth = 0
        var spokenBeforeDelivery = 0
    }

    /// 모델이 하는 배선을 흉내 낸다: 매 fix 지나침을 묶음에 더하고, 채널이 비었을 때만(말하는 문장 없음 ∧ 보호 창 밖 ∧
    /// 끊긴 뒤 쉬는 시간 밖) 문장으로 낸다. 안전 문장(`safety` 시각 + `extraSafetyEvery`)은 말하는 중인 주변 문장을 끊는다.
    /// `cutEverySentence`는 화면 탐색 낭독이 통지를 매번 끊는 전경 VoiceOver를 흉내 낸다(모든 주변 문장이 1초 뒤 끊긴다).
    private func replay(
        _ data: Replay, truthSide: [String: OutingSide] = [:], extraSafetyEvery: Double? = nil,
        cutEverySentence: Bool = false
    ) -> ReplayResult {
        var result = ReplayResult()
        var safety = data.safety.map(\.t)
        if let every = extraSafetyEvery, let end = data.fixes.last?.t {
            safety += stride(from: every, to: end, by: every)
        }
        safety.sort()
        var safetyIndex = 0
        var relations: [String: OutingRelation] = [:]
        var speaking: (line: OutingBundleLine, until: Double, cutAt: Double?)?
        var busyUntil = 3.0  // 시작 문장
        var protectedUntil = 3.0
        var holdUntil = 0.0
        func drop(at t: Double) {
            let dropped = result.bundle.finishDropped()
            result.dropped += 1
            result.givenUp += dropped.givenUp
            holdUntil = t + dropped.holdSeconds
            speaking = nil
        }
        for (index, fix) in data.fixes.enumerated() {
            let heading: OutingHeading =
                switch fix.heading.kind {
                case "valid": .valid(bearing: fix.heading.bearing ?? 0, uncertaintyDeg: fix.heading.u ?? 0)
                case "stale": .stale(bearing: fix.heading.bearing ?? 0)
                default: .none
                }
            var next: [String: OutingRelation] = [:]
            for place in data.places where place.knownAtFix <= index {
                next[place.id] = outingProject(
                    fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.acc, heading: heading,
                    placeLat: place.lat, placeLng: place.lng)
            }
            while safetyIndex < safety.count, safety[safetyIndex] <= fix.t {
                if let now = speaking, now.until > fix.t { drop(at: fix.t) }
                busyUntil = max(busyUntil, fix.t + 2.5)
                protectedUntil = fix.t + 3
                safetyIndex += 1
            }
            if let now = speaking, let cutAt = now.cutAt, cutAt <= fix.t { drop(at: fix.t) }
            if let now = speaking, now.until <= fix.t {
                // 문장이 끝나는 시각의 기하로 다시 투영한다 — 말한 좌우가 다 들은 순간에도 참이어야 한다.
                if case .valid = heading {
                    result.wrongSidesAtEnd += now.line.left.filter { (next[$0]?.t ?? -1) >= 0 }.count
                    result.wrongSidesAtEnd += now.line.right.filter { (next[$0]?.t ?? 1) <= 0 }.count
                }
                for id in result.bundle.finishSpoken() { result.delivered[id, default: 0] += 1 }
                speaking = nil
            }
            let stopped = fix.motion == "stopped"
            let added = result.bundle.observe(
                candidates: next.map { OutingPassByCandidate(id: $0.key, previous: relations[$0.key], current: $0.value) },
                stopped: stopped)
            result.approachAdds += added.filter(\.byApproach).count
            if stopped { result.approachAddsWhileStopped += added.filter(\.byApproach).count }
            relations = next
            result.spokenBeforeDelivery += result.bundle.spoken.filter { result.delivered[$0] == nil }.count
            guard speaking == nil, fix.t >= busyUntil, fix.t >= protectedUntil else { continue }
            guard fix.t >= holdUntil else { continue }
            guard let line = result.bundle.compose(relations: next).line else { continue }
            result.sentences.append(line)
            for id in line.ids { result.emitted[id, default: 0] += 1 }
            if case .valid = heading {} else { result.sidedWithoutHeading += line.left.count + line.right.count }
            result.wrongSidesVsTruth += line.left.filter { truthSide[$0] == .right }.count
            result.wrongSidesVsTruth += line.right.filter { truthSide[$0] == .left }.count
            let seconds = 1.0 + 0.9 * Double(line.ids.count)
            speaking = (line, fix.t + seconds, cutEverySentence ? fix.t + 1 : nil)
            busyUntil = fix.t + seconds
        }
        if speaking != nil {
            for id in result.bundle.finishSpoken() { result.delivered[id, default: 0] += 1 }
        }
        return result
    }

    @Test("합성 길: 길가에서 지나친 가게는 전부 말해지고, 다가간 적이 없는 가게는 말해지지 않는다")
    func syntheticCoversRoadside() {
        let scenario = synthetic()
        let roadside = scenario.data.places.filter(\.roadside).map(\.id)
        #expect(roadside.count == 17)
        let result = replay(scenario.data, truthSide: scenario.truthSide)
        #expect(roadside.filter { !result.bundle.spoken.contains($0) } == [])
        #expect(result.bundle.passedBy.isDisjoint(with: roadside))
        #expect(result.bundle.pending.isEmpty)
        // 등 뒤에서 시작한 가게와 지나온 뒤에 목록에 든 가게는 처음부터 멀어지기만 했다 — 묶음에 들지 않는다.
        for id in scenario.recedingOnly { #expect(!result.bundle.held.contains(id), "\(id)") }
        // 가게가 몰린 구간에서는 여러 곳이 한 문장에 실린다.
        #expect(result.sentences.contains { $0.ids.count >= 2 })
    }

    @Test("합성 길: 같은 가게가 두 번 말해지지 않고, 말했다는 표시는 문장이 끝난 뒤에만 선다")
    func syntheticNoRepeatNoEarlyMark() {
        let scenario = synthetic()
        let result = replay(scenario.data, truthSide: scenario.truthSide)
        #expect(result.delivered.values.allSatisfy { $0 == 1 })
        #expect(Set(result.delivered.keys) == result.bundle.spoken)
        #expect(result.spokenBeforeDelivery == 0)
    }

    @Test("합성 길: 방향을 잃은 구간의 가게는 방향 없는 판정이 받고, 정지 중에는 세지 않으며, 좌우 오답이 없다")
    func syntheticHeadingLostStoppedAndSides() {
        let scenario = synthetic()
        #expect(scenario.data.fixes.filter { $0.motion == "stopped" }.count == 12)
        let result = replay(scenario.data, truthSide: scenario.truthSide)
        #expect(result.approachAdds >= scenario.headingLost.count)
        for id in scenario.headingLost { #expect(result.bundle.spoken.contains(id), "\(id)") }
        #expect(result.approachAddsWhileStopped == 0)
        #expect(result.sidedWithoutHeading == 0)
        #expect(result.wrongSidesVsTruth == 0)
        #expect(result.wrongSidesAtEnd == 0)
        // 좌우를 말한 문장과 좌우를 말하지 못한 문장이 둘 다 실제로 났다.
        #expect(result.sentences.contains { !$0.left.isEmpty || !$0.right.isEmpty })
        #expect(result.sentences.contains { !$0.beside.isEmpty })
    }

    @Test("합성 길: 안전 문장이 주변 문장을 자주 끊어도 길가 가게는 말해지거나 지나옴으로 남고 두 번 말해지지 않는다")
    func syntheticSurvivesInterruptions() {
        let scenario = synthetic()
        let roadside = scenario.data.places.filter(\.roadside).map(\.id)
        let result = replay(scenario.data, truthSide: scenario.truthSide, extraSafetyEvery: 7)
        #expect(result.dropped > 0)  // 끊김이 실제로 났다
        #expect(result.bundle.spoken.count >= 10)  // 그래도 대부분은 끝까지 말해졌다
        #expect(roadside.allSatisfy { result.bundle.spoken.contains($0) || result.bundle.passedBy.contains($0) })
        #expect(result.delivered.values.allSatisfy { $0 == 1 })
        #expect(result.spokenBeforeDelivery == 0)
        #expect(result.wrongSidesVsTruth == 0)
        #expect(result.wrongSidesAtEnd == 0)
        #expect(result.emitted.values.allSatisfy { $0 <= outingBundleMaxDrops })
    }

    @Test("합성 길: 모든 주변 문장이 끊기는 채널에서도 한 가게는 세 번까지만 나가고 그 뒤로는 지나옴이다")
    func syntheticCutEverySentenceIsBounded() {
        let scenario = synthetic()
        let roadside = scenario.data.places.filter(\.roadside).map(\.id)
        let result = replay(scenario.data, truthSide: scenario.truthSide, cutEverySentence: true)
        #expect(result.bundle.spoken.isEmpty)
        #expect(result.delivered.isEmpty)
        #expect(roadside.filter { !result.bundle.passedBy.contains($0) } == [])
        #expect(result.bundle.pending.isEmpty)
        #expect(result.emitted.values.max() == outingBundleMaxDrops)
        #expect(result.emitted.values.allSatisfy { $0 <= outingBundleMaxDrops })
        // 문장 수도 가게 수의 세 배를 넘지 못한다(끝없이 다시 나가지 않는다).
        #expect(result.sentences.count <= outingBundleMaxDrops * scenario.data.places.count)
        #expect(result.dropped == result.sentences.count)
    }

    /// 실보행 세션 재생. 자료는 저장소 밖에 있고(걸은 길의 모양이 남는 자료는 저장소에 두지 않는다) 그 경로를
    /// `GILDONGMU_OUTING_REPLAY`로 준 때만 돈다. 수치를 출력하고, 자료와 무관하게 성립해야 하는 것만 단언한다.
    @Test(
        "실보행 세션 재생(저장소 밖 자료, 경로를 준 때만)",
        .enabled(if: ProcessInfo.processInfo.environment["GILDONGMU_OUTING_REPLAY"] != nil))
    func replayPrivateSession() throws {
        let path = try #require(ProcessInfo.processInfo.environment["GILDONGMU_OUTING_REPLAY"])
        let data = try JSONDecoder().decode(Replay.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let roadside = data.places.filter(\.roadside).map(\.id)
        for (label, every) in [("as-logged", nil), ("safety-every-9s", 9.0)] as [(String, Double?)] {
            let result = replay(data, extraSafetyEvery: every)
            let sizes = Dictionary(grouping: result.sentences, by: { $0.ids.count }).mapValues(\.count)
            print(
                "[outing-replay \(label)] roadside=\(roadside.count) "
                    + "spoken=\(roadside.filter { result.bundle.spoken.contains($0) }.count) "
                    + "passedBy=\(roadside.filter { result.bundle.passedBy.contains($0) }.count) "
                    + "pending=\(result.bundle.pending.count) totalSpoken=\(result.bundle.spoken.count) "
                    + "approachAdds=\(result.approachAdds) approachAddsWhileStopped=\(result.approachAddsWhileStopped) "
                    + "sentences=\(result.sentences.count) sizes=\(sizes.sorted { $0.key < $1.key }) "
                    + "beside=\(result.sentences.map(\.beside.count).reduce(0, +)) "
                    + "sided=\(result.sentences.map { $0.left.count + $0.right.count }.reduce(0, +)) "
                    + "dropped=\(result.dropped) givenUp=\(result.givenUp.count) "
                    + "wrongSidesAtEnd=\(result.wrongSidesAtEnd) sidedWithoutHeading=\(result.sidedWithoutHeading) "
                    + "stoppedFixes=\(data.fixes.filter { $0.motion == "stopped" }.count)")
            #expect(result.delivered.values.allSatisfy { $0 == 1 })
            #expect(result.spokenBeforeDelivery == 0)
            #expect(result.approachAddsWhileStopped == 0)
            #expect(result.sidedWithoutHeading == 0)
        }
    }
}
