import Testing

@testable import GildongmuKit

/// 발화 전달 계약(E82 V0a~V0d, spec 2026-11-14-e82-vergilius-v1-design §3.0): 「말했다」 신호·서열·채널 자리.
/// 종전 세 분류의 동작이 그대로인 것은 기존 스위트(`DeviceSpeechQueueTests`·`DeferredAnnouncerTests`·
/// `GuideSpeechChannelTests`)가 고치지 않은 채로 통과하는 것이 근거다.
@MainActor
struct GuideSpeechDeliveryTests {
    typealias Harness = DeviceSpeechQueueTests.Harness

    /// 문장별 전달 결과를 적는 장부.
    @MainActor
    final class Outcomes {
        var spoken: [String] = []
        var dropped: [(String, DeviceSpeechDrop)] = []
    }

    private func submit(
        _ h: Harness, _ out: Outcomes, _ text: String, cls: GuideSpeechClass, high: Bool = false,
        protected: Bool = false
    ) {
        h.queue.submit(
            text, highPriority: high, protected: protected, bypassSuppression: false, speechClass: cls,
            onDropped: { [out] reason in out.dropped.append((text, reason)) },
            onSpoken: { [out] in out.spoken.append(text) })
    }

    private func drain() async {
        for _ in 0..<60 { await Task.yield() }
    }

    /// 확인할 때마다 "말이 끝났다"로 답하는 스크립트. 테스트 sleeper는 즉시 돌아오므로, 말하는 중으로 남은 추적 문장이
    /// 있으면 확인 루프가 양보 없이 돈다 — 드레인을 기다리는 테스트는 마지막 문장까지 끝나게 넉넉히 준다.
    private static let allFinish = Array(repeating: false, count: 20)

    // MARK: 서열 (V0b)

    @Test func ranksAreSafetyAboveAnswerAboveAmbient() {
        #expect(GuideSpeechClass.ambient.interruptRank < GuideSpeechClass.answer.interruptRank)
        #expect(GuideSpeechClass.answer.interruptRank < GuideSpeechClass.actionable.interruptRank)
        // 종전 세 분류는 서열이 같다 — 서로의 선점 규칙이 바뀌지 않는다.
        #expect(Set([GuideSpeechClass.actionable, .urgent, .deferrable].map(\.interruptRank)).count == 1)
    }

    // 안전 문장은 말하는 중인 주변 문장을 끊고 즉시 나간다. 끊긴 주변 문장은 버림이다(묶음으로 되돌아간다, V0d).
    @Test func safetyCutsSpeakingAmbient() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "왼쪽에 가게 하나, 가게 둘", cls: .ambient)
        h.now = 2
        submit(h, out, "앞에 횡단보도", cls: .actionable, protected: true)
        #expect(h.synth.spoken == ["왼쪽에 가게 하나, 가게 둘", "앞에 횡단보도"])
        #expect(out.dropped.map(\.0) == ["왼쪽에 가게 하나, 가게 둘"])
        #expect(out.spoken.isEmpty)
        #expect(!h.queue.hasPending)
    }

    // 안전 문장은 답도 끊고, 답은 주변을 끊는다.
    @Test func safetyCutsAnswerAndAnswerCutsAmbient() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.now = 1
        submit(h, out, "가장 가까운 곳은 왼쪽 가게 둘입니다", cls: .answer)
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나"])
        h.now = 2
        submit(h, out, "앞에 갈림길", cls: .actionable)
        #expect(h.synth.spoken == ["옆에 가게 하나", "가장 가까운 곳은 왼쪽 가게 둘입니다", "앞에 갈림길"])
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나", "가장 가까운 곳은 왼쪽 가게 둘입니다"])
    }

    // 주변 문장은 아무것도 끊지 않는다 — 안전 문장도, 답도, 다른 주변 문장도. 대기 칸에서 기다린다.
    @Test func ambientCutsNothing() async {
        for speaking in [GuideSpeechClass.actionable, .answer, .ambient] {
            let h = Harness()
            let out = Outcomes()
            submit(h, out, "말하는 중", cls: speaking)
            h.now = 1
            submit(h, out, "옆에 가게 하나", cls: .ambient)
            #expect(h.synth.spoken == ["말하는 중"], "\(speaking)")
            #expect(out.dropped.isEmpty, "\(speaking)")
            #expect(h.queue.hasPending, "\(speaking)")
        }
    }

    // 답은 말하는 중인 안전 문장을 끊지 않는다.
    @Test func answerDoesNotCutSafety() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "앞에 횡단보도", cls: .actionable)
        h.now = 1
        submit(h, out, "답", cls: .answer)
        #expect(h.synth.spoken == ["앞에 횡단보도"])
        #expect(out.dropped.isEmpty)
    }

    // 대기 칸에서도 서열이 선다: 기다리는 답을 주변 문장이 밀어내지 못하고(버림은 새 주변 문장), 기다리는 주변 문장은
    // 안전 문장이 끊으러 올 때 밀려난다.
    @Test func pendingSlotKeepsHigherRank() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "안전 전문", cls: .actionable)
        submit(h, out, "답", cls: .answer)
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나"])
        #expect(out.dropped.map(\.1) == [.undelivered])
        #expect(h.queue.hasPending)
        h.speakingAfterPolls = Self.allFinish
        await drain()
        #expect(h.synth.spoken == ["안전 전문", "답"])
        #expect(out.spoken == ["안전 전문", "답"])
    }

    // 종전 세 분류끼리는 서열로 끊지 않는다(나들이 밖의 선점 규칙 불변): 평범한 행동 문장은 말하는 중인 미룸 문장도,
    // 그 반대도 끊지 않고 기다린다. 선점은 종전대로 `urgent`·`.high`뿐이다.
    @Test func legacyClassesNeverPreemptByRank() async {
        let legacy: [GuideSpeechClass] = [.actionable, .deferrable]
        for first in legacy + [.urgent] {
            for second in legacy {
                let h = Harness()
                h.submit("앞", cls: first)
                h.submit("뒤", cls: second)
                #expect(h.synth.spoken == ["앞"], "\(first) → \(second)")
                #expect(h.queue.hasPending, "\(first) → \(second)")
                #expect(h.drops.isEmpty, "\(first) → \(second)")
            }
        }
    }

    // MARK: 「말했다」 (V0a, 기기 음성)

    // 합성기가 끝까지 말했다고 알리면 「말했다」가 한 번 선다. 다음 문장을 넣지 않아도 선다.
    @Test func spokenFiresWhenSpeechEndsUninterrupted() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        #expect(out.spoken.isEmpty)  // 넘긴 순간은 아직 「말했다」가 아니다
        h.speakingAfterPolls = [true, true, false]
        await drain()
        #expect(out.spoken == ["옆에 가게 하나"])
        #expect(out.dropped.isEmpty)
        await drain()
        #expect(out.spoken.count == 1)
    }

    // 말하다 끊긴 문장은 「말했다」가 아니다 — 선점·칸 밖의 정지 어느 쪽이든 버림 한 번뿐이다.
    @Test func cutSpeechIsNeverSpoken() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.now = 1
        h.queue.speechInterrupted(token: h.synth.token, reason: .undelivered)  // 받아쓰기 시작
        h.synth.stop()
        await drain()
        #expect(out.spoken.isEmpty)
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나"])

        let h2 = Harness()
        let out2 = Outcomes()
        submit(h2, out2, "옆에 가게 둘", cls: .ambient)
        h2.now = 1
        submit(h2, out2, "나들이를 종료했습니다", cls: .actionable, high: true)
        h2.speakingAfterPolls = Self.allFinish
        await drain()
        #expect(out2.spoken == ["나들이를 종료했습니다"])
        #expect(out2.dropped.map(\.0) == ["옆에 가게 둘"])
    }

    // 대기 칸에서 밀려난 문장은 버림이고, 그 자리를 이은 문장만 말한 뒤 「말했다」가 선다.
    @Test func supersededPendingIsDroppedNotSpoken() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "전문", cls: .actionable)
        submit(h, out, "옛 예고", cls: .actionable)
        submit(h, out, "새 예고", cls: .actionable)
        #expect(out.dropped.map(\.0) == ["옛 예고"])
        h.speakingAfterPolls = Self.allFinish
        await drain()
        #expect(h.synth.spoken == ["전문", "새 예고"])
        #expect(out.spoken == ["전문", "새 예고"])
        #expect(out.dropped.count == 1)
    }

    // 끝 신호 없이 합성기에서 사라진 문장은 말한 것으로 치지 않는다(의심스러우면 「말하지 않았다」) — 다음 문장이 들어올 때.
    @Test func vanishedWithoutEndSignalIsNotSpoken() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.now = 10  // 넘긴 지 오래됐어도 끝 신호가 없으면 말한 것이 아니다
        h.synth.vanish()
        submit(h, out, "옆에 가게 둘", cls: .ambient)
        #expect(out.spoken.isEmpty)
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나"])
        #expect(out.dropped.map(\.1) == [.undelivered])
    }

    // 확인 루프 길: 다음 문장이 오지 않아도, 끝 신호 없이 사라진 문장은 확인 두 번 뒤 버림으로 닫힌다. 「말했다」는 서지 않는다.
    @Test func watchLoopClosesVanishedSpeechAsDropped() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.synth.vanish()
        await drain()
        #expect(out.spoken.isEmpty)
        #expect(out.dropped.map(\.0) == ["옆에 가게 하나"])
        #expect(out.dropped.map(\.1) == [.undelivered])
        #expect(h.now >= 2 * DeviceSpeechQueue.pollSeconds - 0.001)  // 처음 본 확인은 넘긴다(늦게 닿는 끝 신호)
        await drain()
        #expect(out.dropped.count == 1)
    }

    // 사라진 것을 확인 루프가 한 번 본 뒤에 닿은 끝 신호는 그대로 「말했다」다(신호가 한 박자 늦는 경우).
    @Test func lateEndSignalStillCountsAsSpoken() async {
        let synth = DeviceSpeechQueueTests.SharedSynth()
        var polls = 0
        var queue: DeviceSpeechQueue?
        let token = { synth.token }
        let q = DeviceSpeechQueue(
            clock: { 0 },
            sleeper: { _ in
                polls += 1
                if polls == 2 { queue?.speechEnded(token: token(), completed: true) }
            },
            isSpeaking: { synth.speaking },
            isSpeakingToken: { synth.isSpeaking(token: $0) },
            voiceOverRunning: { true },
            isSuppressed: { false },
            toneEndsAt: { nil },
            route: { _ in .device },
            speak: { synth.speak($0) },
            stopSpeaking: { synth.stop() },
            postVoiceOver: { _, _ in },
            postVoiceOverTracked: { _, _, _ in })
        queue = q
        let out = Outcomes()
        q.submit(
            "옆에 가게 하나", highPriority: false, protected: false, bypassSuppression: false, speechClass: .ambient,
            onDropped: { [out] in out.dropped.append(("옆에 가게 하나", $0)) },
            onSpoken: { [out] in out.spoken.append("옆에 가게 하나") })
        synth.vanish()
        await drain()
        #expect(out.spoken == ["옆에 가게 하나"])
        #expect(out.dropped.isEmpty)
    }

    // 합성기가 스스로 취소한 발화는 버림이다(끝 신호가 「끝까지 말하지 못했다」로 왔다).
    @Test func selfCancelledSpeechIsDropped() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.now = 3
        h.synth.cancelByItself()
        #expect(out.spoken.isEmpty)
        #expect(out.dropped.map(\.1) == [.undelivered])
        await drain()
        #expect(out.dropped.count == 1)
    }

    // 추적하지 않는 문장(종전 세 모델)은 끝 신호가 와도 달라지는 것이 없다 — 버림 통지도 생기지 않는다.
    @Test func endSignalLeavesUntrackedSpeechAlone() async {
        let h = Harness()
        h.submit("앞에 횡단보도", protected: true)
        h.synth.cancelByItself()
        await drain()
        #expect(h.drops.isEmpty)
    }

    // 세션 경계는 어느 쪽도 부르지 않는다(끝난 세션의 표시를 되살리지 않는다).
    @Test func resetFiresNeither() async {
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "옆에 가게 하나", cls: .ambient)
        h.queue.reset()
        h.synth.speaking = false  // 끝 신호가 와도 끝난 세션의 문장은 통지하지 않는다
        await drain()
        #expect(out.spoken.isEmpty)
        #expect(out.dropped.isEmpty)
    }

    // 복귀 인계: 주변·답 문장은 VoiceOver로 넘기지 않고 버림으로 돌려준다(V0c — 자리에 묶인 문장은 다시 계산해 말한다).
    // 안전 문장은 종전대로 넘어가고, 합본이 끝까지 말해지면 그 문장의 「말했다」가 선다.
    @Test func handOverExcludesAmbientAndAnswer() async {
        for cls in [GuideSpeechClass.ambient, .answer] {
            let h = Harness()
            let out = Outcomes()
            submit(h, out, "넘기지 않는 문장", cls: cls)
            h.now = 1
            h.channel = .voiceOver
            let handed = h.queue.handOver()
            #expect(handed.isEmpty, "\(cls)")
            #expect(h.synth.stops == 1, "\(cls)")
            #expect(out.dropped.map(\.0) == ["넘기지 않는 문장"], "\(cls)")
        }
        let h = Harness()
        let out = Outcomes()
        submit(h, out, "앞에 횡단보도", cls: .actionable, protected: true)
        h.now = 1
        h.channel = .voiceOver
        let handed = h.queue.handOver()
        #expect(handed.texts == ["앞에 횡단보도"])
        #expect(out.spoken.isEmpty)
        handed.spoken()
        handed.spoken()
        handed.undelivered()
        #expect(out.spoken == ["앞에 횡단보도"])
        #expect(out.dropped.isEmpty)
    }

    // MARK: 「말했다」 (V0a, 지연 슬롯)

    @MainActor
    final class AnnouncerHarness {
        var now: Double = 0
        var toneEndsAt: Double?
        var postResult = true
        var claimed: [(() -> Void)?] = []
        var posts: [String] = []
        lazy var announcer: DeferredAnnouncer = DeferredAnnouncer(
            clock: { [weak self] in self?.now ?? 0 },
            sleeper: { [weak self] seconds in self?.now += seconds },
            toneEndsAt: { [weak self] in self?.toneEndsAt },
            post: { [weak self] text, _, _, _, _ in
                guard let self else { return false }
                self.posts.append(text)
                self.claimed.append(self.announcer.claimSpokenHandler())
                return self.postResult
            })
    }

    // `post`가 그 호출 안에서 「말했다」 통지를 가져간다 — 즉시 게시와 톤 뒤 게시 둘 다. 다음 문장에 새지 않는다.
    @Test func announcerHandsSpokenHandlerToPost() async {
        let h = AnnouncerHarness()
        var spoken = 0
        h.announcer.announce("가게", speechClass: .ambient, onSpoken: { spoken += 1 })
        h.announcer.announce("경고", speechClass: .actionable)
        #expect(h.posts == ["가게", "경고"])
        #expect(h.claimed[0] != nil)
        #expect(h.claimed[1] == nil)
        h.claimed[0]?()
        #expect(spoken == 1)
        #expect(h.announcer.claimSpokenHandler() == nil)  // `post` 밖에서는 가져갈 것이 없다

        h.toneEndsAt = 2
        h.announcer.announce("톤 뒤 가게", speechClass: .ambient, onSpoken: { spoken += 10 })
        #expect(h.posts.count == 2)
        h.toneEndsAt = nil
        await drain()
        #expect(h.posts.last == "톤 뒤 가게")
        h.claimed.last??()
        #expect(spoken == 11)
    }

    // 지연 슬롯에서 밀려난 문장과 채널에 실리지 못한 문장은 버림이고 「말했다」는 서지 않는다.
    @Test func announcerDropsAreNeverSpoken() async {
        let h = AnnouncerHarness()
        var spoken = 0
        var dropped = 0
        h.toneEndsAt = 2
        h.announcer.announce("톤 뒤 가게", speechClass: .ambient, onDropped: { dropped += 1 }, onSpoken: { spoken += 1 })
        h.toneEndsAt = nil
        h.announcer.announce("경고", speechClass: .actionable)
        await drain()
        #expect(h.posts == ["경고"])
        #expect((spoken, dropped) == (0, 1))

        h.postResult = false
        h.announcer.announce("억제 중 가게", speechClass: .ambient, onDropped: { dropped += 1 }, onSpoken: { spoken += 1 })
        #expect((spoken, dropped) == (0, 2))
    }

    // MARK: 「말했다」 (V0a, VoiceOver 통지 장부)

    @Test func voiceOverLedgerSpokenOnlyOnSuccessfulFinish() {
        var ledger = VoiceOverDeliveryLedger()
        let a = ledger.posted("왼쪽에 가게 하나", at: 0)
        let b = ledger.posted("앞에 횡단보도", at: 1)
        // 새 통지에 끊긴 문장의 끝 신호는 「끝까지 말하지 못했다」다.
        let cut = ledger.finished("왼쪽에 가게 하나", successful: false)
        #expect(cut?.id == a)
        #expect(cut?.outcome == .dropped)
        let done = ledger.finished("앞에 횡단보도", successful: true)
        #expect(done?.id == b)
        #expect(done?.outcome == .spoken)
        #expect(ledger.isEmpty)
        // 성공 여부를 싣지 않은 끝 신호는 말하지 않은 것으로 친다.
        _ = ledger.posted("옆에 가게 둘", at: 2)
        #expect(ledger.finished("옆에 가게 둘", successful: nil)?.outcome == .dropped)
        // 우리가 추적하지 않는 문장의 끝은 아무 일도 없다.
        #expect(ledger.finished("검색 결과 3건", successful: true) == nil)
    }

    // 같은 문장이 둘이면 오래된 것부터 닫고, 끝 신호가 오지 않은 통지는 만료 때 버림으로 닫는다.
    @Test func voiceOverLedgerPairsOldestAndExpires() {
        var ledger = VoiceOverDeliveryLedger()
        let first = ledger.posted("옆에 가게 하나", at: 0)
        let second = ledger.posted("옆에 가게 하나", at: 5)
        #expect(ledger.finished("옆에 가게 하나", successful: true)?.id == first)
        let expiry = VoiceOverDeliveryLedger.expirySeconds(for: "옆에 가게 하나")
        #expect(ledger.expire(at: 5 + expiry - 0.1).isEmpty)
        #expect(ledger.expire(at: 5 + expiry) == [second])
        #expect(ledger.isEmpty)
    }

    // 만료는 문장 길이에 비례한다(글자 수 × 0.15초 + 5초, 상한 30초) — 짧은 문장 하나가 30초를 붙들지 않는다.
    @Test func voiceOverLedgerExpiryFollowsSentenceLength() {
        #expect(abs(VoiceOverDeliveryLedger.expirySeconds(for: String(repeating: "가", count: 8)) - 6.2) < 1e-9)
        #expect(abs(VoiceOverDeliveryLedger.expirySeconds(for: String(repeating: "가", count: 60)) - 14) < 1e-9)
        #expect(VoiceOverDeliveryLedger.expirySeconds(for: String(repeating: "가", count: 400)) == 30)
        var ledger = VoiceOverDeliveryLedger()
        let short = ledger.posted(String(repeating: "가", count: 8), at: 0)
        let long = ledger.posted(String(repeating: "나", count: 60), at: 0)
        #expect(ledger.expire(at: 6.1).isEmpty)
        #expect(ledger.expire(at: 6.3) == [short])
        #expect(ledger.expire(at: 13.9).isEmpty)
        #expect(ledger.expire(at: 14.1) == [long])
    }

    // 세션 경계에서 비운 통지는 만료로도 끝 신호로도 다시 나오지 않는다.
    @Test func voiceOverLedgerResetForgetsOpenEntries() {
        var ledger = VoiceOverDeliveryLedger()
        _ = ledger.posted("옆에 가게 하나", at: 0)
        ledger.reset()
        #expect(ledger.isEmpty)
        #expect(ledger.finished("옆에 가게 하나", successful: true) == nil)
        #expect(ledger.expire(at: 100).isEmpty)
    }

    // 드레인이 꺼낸 문장의 채널이 VoiceOver로 바뀌었으면 추적 게시로 내고 그 결과를 그대로 잇는다.
    @Test func drainToVoiceOverKeepsTracking() async {
        let synth = DeviceSpeechQueueTests.SharedSynth()
        var now = 0.0
        var channel = GuideSpeechChannel.device
        var tracked: [(String, (GuideSpeechOutcome) -> Void)] = []
        var plain: [String] = []
        let queue = DeviceSpeechQueue(
            clock: { now },
            sleeper: { seconds in now += seconds; synth.speaking = false },
            isSpeaking: { synth.speaking },
            isSpeakingToken: { synth.isSpeaking(token: $0) },
            voiceOverRunning: { true },
            isSuppressed: { false },
            toneEndsAt: { nil },
            route: { _ in channel },
            speak: { synth.speak($0) },
            stopSpeaking: { synth.stop() },
            postVoiceOver: { text, _ in plain.append(text) },
            postVoiceOverTracked: { text, _, outcome in tracked.append((text, outcome)) })
        let out = Outcomes()
        queue.submit(
            "전문", highPriority: false, protected: false, bypassSuppression: false, speechClass: .actionable,
            onDropped: nil)
        queue.submit(
            "앞에 횡단보도", highPriority: false, protected: true, bypassSuppression: false, speechClass: .actionable,
            onDropped: { [out] in out.dropped.append(("앞에 횡단보도", $0)) },
            onSpoken: { [out] in out.spoken.append("앞에 횡단보도") })
        channel = .voiceOver
        await drain()
        #expect(plain.isEmpty)
        #expect(tracked.map(\.0) == ["앞에 횡단보도"])
        tracked[0].1(.spoken)
        #expect(out.spoken == ["앞에 횡단보도"])
        #expect(out.dropped.isEmpty)
    }

    // MARK: 채널 자리 (V0b·V0c)

    private func channel(
        foreground: Bool, voiceOver: Bool, cls: GuideSpeechClass, enabled: Bool, audible: Bool, ask: Bool
    ) -> GuideSpeechChannel {
        guideSpeechChannel(
            foreground: foreground, voiceOverRunning: voiceOver, speechClass: cls,
            backgroundSpeechEnabled: enabled, backgroundAudible: audible, foregroundDeviceSpeech: true,
            askWindowActive: ask)
    }

    // 백그라운드: 주변 문장은 행동 문장(종전 가게 문장의 분류)과 모든 조합에서 같고, 답은 토글과 무관하게 들릴 때 말한다.
    @Test func backgroundAmbientMatchesActionableAndAnswerIgnoresToggle() {
        for enabled in [true, false] {
            for audible in [true, false] {
                for voiceOver in [true, false] {
                    let ambient = channel(
                        foreground: false, voiceOver: voiceOver, cls: .ambient, enabled: enabled, audible: audible, ask: false)
                    let actionable = channel(
                        foreground: false, voiceOver: voiceOver, cls: .actionable, enabled: enabled, audible: audible, ask: false)
                    #expect(ambient == actionable)
                    let answer = channel(
                        foreground: false, voiceOver: voiceOver, cls: .answer, enabled: enabled, audible: audible, ask: false)
                    #expect(answer == (audible ? .device : .drop))
                }
            }
        }
    }

    // 묻고 답하는 구간: 전경에서는 VoiceOver가 켜져 있어도 전부 기기 음성이다. 구간 밖(모든 지금의 호출부)은 인자가 없던
    // 때와 같고, 백그라운드 판정은 구간과 무관하다.
    @Test func askWindowForcesDeviceOnlyInForeground() {
        for cls in GuideSpeechClass.allCases {
            for voiceOver in [true, false] {
                #expect(channel(foreground: true, voiceOver: voiceOver, cls: cls, enabled: true, audible: true, ask: true) == .device)
                for enabled in [true, false] {
                    for audible in [true, false] {
                        let inside = channel(
                            foreground: false, voiceOver: voiceOver, cls: cls, enabled: enabled, audible: audible, ask: true)
                        let outside = channel(
                            foreground: false, voiceOver: voiceOver, cls: cls, enabled: enabled, audible: audible, ask: false)
                        #expect(inside == outside)
                    }
                }
            }
        }
    }
}
