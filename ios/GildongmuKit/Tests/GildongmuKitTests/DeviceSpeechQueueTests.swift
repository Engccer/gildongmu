import Testing

@testable import GildongmuKit

/// 기기 음성 대기 한 칸의 수명 계약(E53 spec 2026-09-30 §4.2, 나들이 spec §7.3에서 올린 것 + 설계 리뷰 M1·M2·M5·m2·m3·m10).
/// sleeper는 시계를 전진시키고 즉시 반환한다(`DeferredAnnouncerTests` 동형). "말하는 중"은 스크립트로 준다.
@MainActor
struct DeviceSpeechQueueTests {
    @MainActor
    final class Harness {
        var now: Double = 0
        /// isSpeaking이 불릴 때마다 하나씩 소비. 소진되면 마지막 값 반복. 재대입하면 처음부터.
        var speakingScript: [Bool] = [false] { didSet { speakingIndex = 0 } }
        private var speakingIndex = 0
        var suppressed = false
        var toneEndsAt: Double?
        var channel: GuideSpeechChannel = .device
        private(set) var spoken: [String] = []
        private(set) var stops = 0
        private(set) var voiceOver: [(String, Bool)] = []
        private(set) var drops: [(String, DeviceSpeechDrop)] = []

        func nextSpeaking() -> Bool {
            let value = speakingScript[min(speakingIndex, speakingScript.count - 1)]
            speakingIndex += 1
            return value
        }

        lazy var queue = DeviceSpeechQueue(
            clock: { [weak self] in self?.now ?? 0 },
            sleeper: { [weak self] seconds in self?.now += seconds },
            isSpeaking: { [weak self] in self?.nextSpeaking() ?? false },
            isSuppressed: { [weak self] in self?.suppressed ?? false },
            toneEndsAt: { [weak self] in self?.toneEndsAt },
            route: { [weak self] _ in self?.channel ?? .drop },
            speak: { [weak self] text in self?.spoken.append(text) },
            stopSpeaking: { [weak self] in self?.stops += 1 },
            postVoiceOver: { [weak self] text, high in self?.voiceOver.append((text, high)) }
        )

        /// 버림 통지를 이름과 함께 기록하는 제출.
        func submit(
            _ text: String, high: Bool = false, protected: Bool = false, bypass: Bool = false
        ) {
            queue.submit(
                text, highPriority: high, protected: protected, bypassSuppression: bypass,
                speechClass: .actionable, onDropped: { [weak self] reason in self?.drops.append((text, reason)) })
        }
    }

    private func drain() async {
        for _ in 0..<40 { await Task.yield() }
    }

    @Test func speaksImmediatelyWhenIdle() async {
        let h = Harness()
        h.speakingScript = [false]
        h.submit("지금")
        #expect(h.spoken == ["지금"])
        #expect(!h.queue.hasPending)
        #expect(h.drops.isEmpty)
    }

    // 선점 금지(평범한 문장): 안내가 말하는 중이면 끊지 않고 칸에 두었다가 끝나면 낸다.
    @Test func waitsWhileSpeakingThenSpeaks() async {
        let h = Harness()
        h.speakingScript = [true, true, true, false]
        h.submit("다음")
        #expect(h.spoken.isEmpty)
        #expect(h.queue.hasPending)
        await drain()
        #expect(h.spoken == ["다음"])
        #expect(h.drops.isEmpty)
    }

    // 한 칸: 새 문장이 옛 대기 문장을 잇는다 — 옛 문장의 버림은 `superseded`(상환 표식을 세우지 않는다, 설계 리뷰 M1).
    @Test func replacementIsSuperseded() async {
        let h = Harness()
        h.speakingScript = [true]
        h.submit("옛")
        h.submit("새")
        #expect(h.drops.map(\.0) == ["옛"])
        #expect(h.drops.map(\.1) == [.superseded])
        h.speakingScript = [false]
        await drain()
        #expect(h.spoken == ["새"])
    }

    // `.high`는 기다리지 않고 선점한다 — 칸의 옛 문장은 superseded, 즉시 말한다(설계 리뷰 M2: 도착·재조회 요약이
    // 칸에서 최신 명령을 막지 않는다).
    @Test func highPriorityPreempts() async {
        let h = Harness()
        h.speakingScript = [true]
        h.submit("전문")
        h.submit("도착", high: true)
        #expect(h.spoken == ["도착"])
        #expect(h.drops.map(\.1) == [.superseded])
        #expect(!h.queue.hasPending)
        // 뒤이은 평범한 문장은 칸에 들어간다(막히지 않는다).
        h.submit("잠시 후 왼쪽")
        #expect(h.queue.hasPending)
    }

    // 즉시 발화 전에 칸의 옛 문장을 비운다 — 새 문장 뒤에 옛 문장이 나오는 순서 역전 금지(m3).
    @Test func immediateSpeakClearsStalePending() async {
        let h = Harness()
        h.speakingScript = [true]
        h.submit("옛")
        h.speakingScript = [false]  // 드레인이 깨기 전에 말이 끝났다
        h.submit("새")
        await drain()
        #expect(h.spoken == ["새"])
        #expect(h.drops.map(\.1) == [.superseded])
    }

    // 보호 문장(나들이 시작·횡단보도)은 평범한 문장에 밀리지 않는다 — 막힌 쪽은 undelivered.
    @Test func protectedBlocksPlain() async {
        let h = Harness()
        h.speakingScript = [true]
        h.submit("횡단보도", protected: true)
        h.submit("지나침")
        #expect(h.drops.map(\.0) == ["지나침"])
        #expect(h.drops.map(\.1) == [.undelivered])
        h.speakingScript = [false]
        await drain()
        #expect(h.spoken == ["횡단보도"])
    }

    // 유효 시간(6초)을 넘긴 평범한 문장은 undelivered, 보호 문장은 기다린 시간과 무관하게 낸다.
    @Test func ttlDropsPlainButNotProtected() async {
        let h = Harness()
        h.speakingScript = Array(repeating: true, count: 30) + [false]  // 약 9초 동안 말하는 중
        h.submit("낡을 문장")
        await drain()
        #expect(h.spoken.isEmpty)
        #expect(h.drops.map(\.1) == [.undelivered])

        let k = Harness()
        k.speakingScript = Array(repeating: true, count: 30) + [false]
        k.submit("횡단보도", protected: true)
        await drain()
        #expect(k.spoken == ["횡단보도"])
    }

    // 꺼내는 순간 받아쓰기 억제 중이면 버린다(녹음 중 발화 0) — 단 사용자 활성화의 직접 응답은 면제(m2).
    @Test func suppressedAtDrainDropsUnlessBypass() async {
        let h = Harness()
        h.speakingScript = [true, false]
        h.submit("억제 중 대기")
        h.suppressed = true
        await drain()
        #expect(h.spoken.isEmpty)
        #expect(h.drops.map(\.1) == [.undelivered])

        let b = Harness()
        b.speakingScript = [true, false]
        b.submit("목적지 전환 확인", bypass: true)
        b.suppressed = true
        await drain()
        #expect(b.spoken == ["목적지 전환 확인"])
    }

    // 꺼내기 전 톤이 울리는 중이면 그 뒤까지 기다린다(톤 뒤 발화, m10).
    @Test func waitsForToneBeforeDelivering() async {
        let h = Harness()
        h.speakingScript = [true, false]
        h.toneEndsAt = 2.0
        h.submit("임박")
        await drain()
        #expect(h.spoken == ["임박"])
        #expect(h.now >= 2.0 + SpeechDeferConstants.speechDeferGapSeconds)
    }

    // 꺼내는 순간 채널을 다시 고른다: 전경 VoiceOver면 통지(우선순위 전달), 채널 소실(토글 끔·가청 상실)이면 undelivered.
    @Test func reroutesAtDrain() async {
        let h = Harness()
        h.speakingScript = [true, false]
        h.submit("복귀 뒤")
        h.channel = .voiceOver
        await drain()
        #expect(h.spoken.isEmpty)
        #expect(h.voiceOver.map(\.0) == ["복귀 뒤"])

        let d = Harness()
        d.speakingScript = [true, false]
        d.submit("토글 끔")
        d.channel = .drop
        await drain()
        #expect(d.spoken.isEmpty)
        #expect(d.drops.map(\.1) == [.undelivered])
    }

    // 세션 경계: 버림 통지 없이 비운다 — stop()이 비운 상환 장부를 되살리지 않는다.
    @Test func resetDropsSilently() async {
        let h = Harness()
        h.speakingScript = [true]
        h.submit("끝난 세션")
        h.queue.reset()
        h.speakingScript = [false]
        await drain()
        #expect(h.spoken.isEmpty)
        #expect(h.drops.isEmpty)
        #expect(!h.queue.hasPending)
        h.submit("새 세션")
        #expect(h.spoken == ["새 세션"])
    }

    // 전경 복귀 인계(M5): 말하는 중인 안내를 끊고 그 문장을 처음부터, 이어서 칸의 문장을 지금 채널(VoiceOver)로 낸다.
    // 겹침도 유실도 없다. 인계한 문장은 버림이 아니다.
    @Test func handOverRedeliversSpeakingAndPendingInOrder() async {
        let h = Harness()
        h.speakingScript = [false]
        h.submit("40m 전문")  // 즉시 말함
        h.speakingScript = [true]
        h.submit("잠시 후 왼쪽")  // 칸
        h.channel = .voiceOver
        h.speakingScript = [true]  // 복귀 순간 아직 말하는 중
        let delivered = h.queue.handOver()
        #expect(delivered)
        #expect(h.stops == 1)
        #expect(h.voiceOver.map(\.0) == ["40m 전문", "잠시 후 왼쪽"])
        #expect(h.drops.isEmpty)
        #expect(!h.queue.hasPending)
        await drain()
        #expect(h.spoken == ["40m 전문"])  // 인계 뒤 옛 드레인이 다시 내지 않는다
    }

    // 말이 이미 끝났으면 끊지도 다시 내지도 않는다(들은 문장을 되풀이하지 않는다).
    @Test func handOverSkipsFinishedSpeech() async {
        let h = Harness()
        h.speakingScript = [false]
        h.submit("다 들은 문장")
        h.channel = .voiceOver
        let delivered = h.queue.handOver()
        #expect(!delivered)
        #expect(h.stops == 0)
        #expect(h.voiceOver.isEmpty)
    }
}
