import Testing

@testable import GildongmuKit

/// 기기 음성 대기 한 칸의 수명 계약(E53 spec 2026-09-30 §4.2, 나들이 spec §7.3에서 올린 것 + 설계 리뷰 M1·M2·M5·m2·m3·m10,
/// 구현 리뷰 M-1·M-2·m-1·m-2·m-3, 접근성 감사 MAJOR 1·2·m2~m4).
///
/// 합성기는 하나(`SharedSynth`)이고 칸 여럿이 그것을 나눠 쓴다 — 복귀 인계가 다른 칸의 발화를 끊지 않는지(구현 리뷰 M-1)는
/// 칸 두 개로만 드러난다. sleeper는 시계를 전진시키고 즉시 반환한다(`DeferredAnnouncerTests` 동형).
@MainActor
struct DeviceSpeechQueueTests {
    /// 앱 전역 합성기 흉내. `speak`마다 새 토큰, `stop`·새 발화가 이전 토큰을 무효로 만든다(`TtsPlayer` 세대와 같다).
    @MainActor
    final class SharedSynth {
        var speaking = false
        /// 인터럽션 뒤 일시정지로 남은 발화 — "말하는 중"(칸을 막는가)은 아니지만 토큰의 문장은 아직 합성기에 있다.
        var paused = false
        private(set) var token = 0
        private(set) var spoken: [String] = []
        private(set) var stops = 0

        func speak(_ text: String) -> Int {
            token += 1
            speaking = true
            paused = false
            spoken.append(text)
            return token
        }

        func stop() {
            token += 1
            speaking = false
            paused = false
            stops += 1
        }

        func isSpeaking(token t: Int) -> Bool { (speaking || paused) && t == token }
    }

    @MainActor
    final class Harness {
        let synth: SharedSynth
        var now: Double = 0
        var suppressed = false
        var voiceOverRunning = true
        var toneEndsAt: () -> Double? = { nil }
        var channel: GuideSpeechChannel = .device
        private(set) var voiceOver: [(String, Bool)] = []
        private(set) var drops: [(String, DeviceSpeechDrop)] = []
        /// 드레인이 확인할 때마다 하나씩 소비해 `synth.speaking`에 대입하는 스크립트(비면 그대로 둔다).
        var speakingAfterPolls: [Bool] = []

        init(synth: SharedSynth = SharedSynth()) { self.synth = synth }

        lazy var queue = DeviceSpeechQueue(
            clock: { [weak self] in self?.now ?? 0 },
            sleeper: { @MainActor [weak self] seconds in
                guard let self else { return }
                self.now += seconds
                if !self.speakingAfterPolls.isEmpty { self.synth.speaking = self.speakingAfterPolls.removeFirst() }
            },
            isSpeaking: { [weak self] in self?.synth.speaking ?? false },
            isSpeakingToken: { [weak self] t in self?.synth.isSpeaking(token: t) ?? false },
            voiceOverRunning: { [weak self] in self?.voiceOverRunning ?? true },
            isSuppressed: { [weak self] in self?.suppressed ?? false },
            toneEndsAt: { [weak self] in self?.toneEndsAt() },
            route: { [weak self] _ in self?.channel ?? .drop },
            speak: { [weak self] text in self?.synth.speak(text) ?? 0 },
            stopSpeaking: { [weak self] in self?.synth.stop() },
            postVoiceOver: { [weak self] text, high in self?.voiceOver.append((text, high)) }
        )

        func submit(
            _ text: String, high: Bool = false, protected: Bool = false, bypass: Bool = false,
            cls: GuideSpeechClass = .actionable
        ) {
            queue.submit(
                text, highPriority: high, protected: protected, bypassSuppression: bypass,
                speechClass: cls, onDropped: { [weak self] reason in self?.drops.append((text, reason)) })
        }
    }

    private func drain() async {
        for _ in 0..<60 { await Task.yield() }
    }

    @Test func speaksImmediatelyWhenIdle() async {
        let h = Harness()
        h.submit("지금")
        #expect(h.synth.spoken == ["지금"])
        #expect(!h.queue.hasPending)
        #expect(h.drops.isEmpty)
    }

    // 선점 금지(평범한 문장): 안내가 말하는 중이면 끊지 않고 칸에 두었다가 끝나면 낸다.
    @Test func waitsWhileSpeakingThenSpeaks() async {
        let h = Harness()
        h.submit("전문")
        h.submit("다음")
        #expect(h.synth.spoken == ["전문"])
        #expect(h.queue.hasPending)
        h.speakingAfterPolls = [true, false]
        await drain()
        #expect(h.synth.spoken == ["전문", "다음"])
        #expect(h.drops.isEmpty)
    }

    // 한 칸: 새 문장이 옛 대기 문장을 잇는다 — 옛 문장의 버림은 `superseded`(상환 표식을 세우지 않는다, 설계 리뷰 M1).
    @Test func replacementIsSuperseded() async {
        let h = Harness()
        h.submit("전문")
        h.submit("옛")
        h.submit("새")
        #expect(h.drops.map(\.0) == ["옛"])
        #expect(h.drops.map(\.1) == [.superseded])
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문", "새"])
    }

    // `.high`는 기다리지 않고 선점한다 — 칸의 옛 문장과 끊긴 이 칸의 발화는 superseded(끊긴 1회성 경고의 장부를 되살린다,
    // 접근성 m4). 뒤이은 평범한 문장은 막히지 않는다(설계 리뷰 M2).
    @Test func highPriorityPreempts() async {
        let h = Harness()
        h.submit("계단 경고")
        h.submit("칸의 전문")
        h.submit("도착", high: true)
        #expect(h.synth.spoken == ["계단 경고", "도착"])
        #expect(Set(h.drops.map(\.0)) == ["칸의 전문", "계단 경고"])
        #expect(h.drops.allSatisfy { $0.1 == .superseded })
        #expect(!h.queue.hasPending)
        h.submit("잠시 후 왼쪽 전 예고")
        #expect(h.queue.hasPending)
    }

    // 임박 명령(urgent)은 우선순위와 무관하게 선점한다 — 전문 뒤에 줄 서면 회전 지점을 지나서 나온다(접근성 MAJOR 2).
    @Test func urgentPreempts() async {
        let h = Harness()
        h.submit("묶음 전문")
        h.submit("잠시 후 우회전하세요", cls: .urgent)
        #expect(h.synth.spoken == ["묶음 전문", "잠시 후 우회전하세요"])
        #expect(!h.queue.hasPending)
        #expect(h.drops.map(\.0) == ["묶음 전문"])  // 끊긴 이 칸의 발화는 장부를 되살린다
        #expect(h.drops.map(\.1) == [.superseded])
    }

    // 다른 출처(다른 모델·채팅이 끝난 뒤 다른 발화)가 말하는 중이면 선점해도 이 칸의 옛 발화에 통지하지 않는다.
    @Test func preemptDoesNotNotifyForeignSpeech() async {
        let synth = SharedSynth()
        let a = Harness(synth: synth)
        let b = Harness(synth: synth)
        a.submit("a의 옛 문장")
        b.submit("b가 말하는 중", high: true)  // b가 합성기를 넘겨받아 말한다
        a.submit("a의 도착", high: true)
        #expect(a.drops.isEmpty)
    }

    // 즉시 발화 전에 칸의 옛 문장을 비운다 — 새 문장 뒤에 옛 문장이 나오는 순서 역전 금지(m3).
    @Test func immediateSpeakClearsStalePending() async {
        let h = Harness()
        h.submit("전문")
        h.submit("옛")
        h.synth.speaking = false  // 드레인이 깨기 전에 말이 끝났다
        h.submit("새")
        await drain()
        #expect(h.synth.spoken == ["전문", "새"])
        #expect(h.drops.map(\.1) == [.superseded])
    }

    // 보호 문장(나들이 시작·횡단보도)은 평범한 문장에 밀리지 않는다 — 막힌 쪽은 undelivered.
    @Test func protectedBlocksPlain() async {
        let h = Harness()
        h.submit("전문")
        h.submit("횡단보도", protected: true)
        h.submit("지나침")
        #expect(h.drops.map(\.0) == ["지나침"])
        #expect(h.drops.map(\.1) == [.undelivered])
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문", "횡단보도"])
    }

    // 유효 시간(6초)을 넘긴 평범한 문장은 undelivered, 보호 문장은 기다린 시간과 무관하게 낸다.
    @Test func ttlDropsPlainButNotProtected() async {
        let h = Harness()
        h.submit("전문")
        h.submit("낡을 문장")
        h.speakingAfterPolls = Array(repeating: true, count: 29) + [false]  // 약 9초 동안 말하는 중
        await drain()
        #expect(h.synth.spoken == ["전문"])
        #expect(h.drops.map(\.1) == [.undelivered])

        let k = Harness()
        k.submit("전문")
        k.submit("횡단보도", protected: true)
        k.speakingAfterPolls = Array(repeating: true, count: 29) + [false]
        await drain()
        #expect(k.synth.spoken == ["전문", "횡단보도"])
    }

    // 꺼내는 순간 받아쓰기 억제 중이면 버린다(녹음 중 발화 0) — 단 사용자 활성화의 직접 응답은 면제(m2).
    @Test func suppressedAtDrainDropsUnlessBypass() async {
        let h = Harness()
        h.submit("전문")
        h.submit("억제 중 대기")
        h.suppressed = true
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문"])
        #expect(h.drops.map(\.1) == [.undelivered])

        let b = Harness()
        b.submit("전문")
        b.submit("목적지 전환 확인", bypass: true)
        b.suppressed = true
        b.speakingAfterPolls = [false]
        await drain()
        #expect(b.synth.spoken == ["전문", "목적지 전환 확인"])
    }

    // 꺼내기 전 톤이 울리는 중이면 그 뒤까지 기다린다(톤 뒤 발화, m10).
    @Test func waitsForToneBeforeDelivering() async {
        let h = Harness()
        h.submit("전문")
        h.submit("임박 전 예고")
        h.toneEndsAt = { 2.0 }
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문", "임박 전 예고"])
        #expect(h.now >= 2.0 + SpeechDeferConstants.speechDeferGapSeconds)
    }

    // 톤이 끝없이 이어져도 한 번의 대기당 3초 상한에서 낸다(구현 리뷰 m-3 — 상한 분기를 지우면 이 테스트가 끝나지 않는다).
    @Test func toneWaitIsCapped() async {
        let h = Harness()
        h.submit("전문")
        h.submit("상한 문장", protected: true)
        // 항상 잔여 2초 — 단 50번째 조회부터는 톤이 없다. 상한 분기가 없으면 스위트가 멈추는 대신 이 늦은 탈출로 끝나
        // 아래 시간 단언이 실패한다(검증 리뷰 N8).
        var toneCalls = 0
        h.toneEndsAt = { [weak h] in
            toneCalls += 1
            return toneCalls < 50 ? (h?.now ?? 0) + 2 : nil
        }
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문", "상한 문장"])
        // 톤 대기 3초 + 사이사이 확인 간격 몇 번 — 상한이 없으면 끝나지 않는다.
        #expect(h.now < SpeechDeferConstants.speechDeferMaxSeconds + 4 * DeviceSpeechQueue.pollSeconds)
    }

    // 톤 대기 상한은 한 번의 대기당이다 — 톤 대기 도중 다시 말하기 시작했다가 끝나면 3초를 새로 잰다(구현 리뷰 m-3,
    // 검증 리뷰 N8: 재설정을 지우면 첫 대기의 시작 시각으로 판정해 약 3.6초에 일찍 낸다).
    @Test func toneWaitCapRestartsAfterSpeechResumes() async {
        let h = Harness()
        h.submit("전문")
        h.submit("보호 문장", protected: true)
        // 항상 잔여 2초(50번째 조회부터 톤 없음 — 상한 분기를 지우는 변이가 스위트를 멈추지 않게, 그 변이는 toneWaitIsCapped가 잡는다).
        var toneCalls = 0
        h.toneEndsAt = { [weak h] in
            toneCalls += 1
            return toneCalls < 50 ? (h?.now ?? 0) + 2 : nil
        }
        // 확인 → 톤 대기 → (말하기 재개) 확인 → 말 끝남: 이후 두 번째 톤 대기가 3초를 온전히 쓴다.
        h.speakingAfterPolls = [false, true, true, false]
        await drain()
        #expect(h.synth.spoken == ["전문", "보호 문장"])
        #expect(h.now > 5)
    }

    // 꺼내는 순간 채널을 다시 고른다: 전경 VoiceOver면 통지(우선순위 전달), 채널 소실(토글 끔·가청 상실)이면 undelivered.
    @Test func reroutesAtDrain() async {
        let h = Harness()
        h.submit("전문")
        h.submit("복귀 뒤", high: false)
        h.channel = .voiceOver
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.voiceOver.map(\.0) == ["복귀 뒤"])

        let d = Harness()
        d.submit("전문")
        d.submit("토글 끔")
        d.channel = .drop
        d.speakingAfterPolls = [false]
        await drain()
        #expect(d.drops.map(\.1) == [.undelivered])
    }

    // 세션 경계: 버림 통지 없이 비운다 — stop()이 비운 상환 장부를 되살리지 않는다.
    @Test func resetDropsSilently() async {
        let h = Harness()
        h.submit("전문")
        h.submit("끝난 세션")
        h.queue.reset()
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["전문"])
        #expect(h.drops.isEmpty)
        #expect(!h.queue.hasPending)
    }

    // 복귀 인계(M5 + 구현 리뷰 M-2): 말하는 중인 이 칸의 발화를 끊고, 그 문장과 칸의 문장을 옛 → 새 순서로 **돌려준다**
    // (게시하지 않는다 — 호출부가 상환과 한 통지로 낸다).
    @Test func handOverReturnsSpeakingAndPendingInOrder() async {
        let h = Harness()
        h.submit("40m 전문")
        h.submit("다음 예고")
        h.channel = .voiceOver
        let handed = h.queue.handOver()
        #expect(handed.texts == ["40m 전문", "다음 예고"])
        #expect(h.synth.stops == 1)
        #expect(h.voiceOver.isEmpty)
        #expect(h.drops.isEmpty)
        #expect(!h.queue.hasPending)
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["40m 전문"])  // 인계 뒤 옛 드레인이 다시 내지 않는다
    }

    // 다른 칸(다른 모델)의 발화는 끊지 않고 넘기지도 않는다 — 낡은 lastSpoken을 되살리지 않는다(구현 리뷰 M-1).
    @Test func handOverIgnoresForeignSpeech() async {
        let synth = SharedSynth()
        let beacon = Harness(synth: synth)
        let transit = Harness(synth: synth)
        beacon.channel = .voiceOver
        transit.channel = .voiceOver
        beacon.submit("승차역 도착")      // 도보가 말했고
        transit.submit("대중교통 시작", high: true)  // 대중교통이 합성기를 넘겨받아 말하는 중
        #expect(beacon.queue.handOver().isEmpty)
        #expect(synth.stops == 0)
        #expect(transit.queue.handOver().texts == ["대중교통 시작"])
        #expect(synth.stops == 1)
    }

    // 말이 이미 끝났으면 끊지도 넘기지도 않는다(들은 문장을 되풀이하지 않는다).
    @Test func handOverSkipsFinishedSpeech() async {
        let h = Harness()
        h.submit("다 들은 문장")
        h.synth.speaking = false
        h.channel = .voiceOver
        #expect(h.queue.handOver().isEmpty)
        #expect(h.synth.stops == 0)
    }

    // 채널이 그대로 기기 음성이면(VoiceOver 꺼진 나들이) 끊지도 다시 내지도 않고, 칸은 드레인에 맡긴다(접근성 m2).
    @Test func handOverKeepsDeviceChannel() async {
        let h = Harness()
        h.submit("말하는 중")
        h.submit("대기")
        h.channel = .device
        #expect(h.queue.handOver().isEmpty)
        #expect(h.synth.stops == 0)
        #expect(h.queue.hasPending)
        h.speakingAfterPolls = [false]
        await drain()
        #expect(h.synth.spoken == ["말하는 중", "대기"])
    }

    // VoiceOver가 꺼진 전경(도보·대중교통은 채널이 VoiceOver 게시라 듣는 사람이 없다)이면 끊지도 넘기지도 않는다(검증 리뷰 N3).
    @Test func handOverKeepsSpeechWhenVoiceOverOff() async {
        let h = Harness()
        h.submit("말하는 중")
        h.submit("대기")
        h.channel = .voiceOver
        h.voiceOverRunning = false
        #expect(h.queue.handOver().isEmpty)
        #expect(h.synth.stops == 0)
        #expect(h.queue.hasPending)
    }

    // 인계도 억제·유효 시간을 지난다(접근성 m3, 구현 리뷰 m-1): 억제 중이면 끊기만 하고 undelivered, 낡은 칸 문장도 undelivered.
    @Test func handOverRespectsSuppressionAndTTL() async {
        let h = Harness()
        h.submit("말하는 중")
        h.submit("대기")
        h.channel = .voiceOver
        h.suppressed = true
        #expect(h.queue.handOver().isEmpty)
        #expect(h.synth.stops == 1)
        #expect(h.drops.map(\.1) == [.undelivered, .undelivered])

        let t = Harness()
        t.submit("말하는 중")
        t.submit("낡은 명령")
        t.now = DeviceSpeechQueue.pendingTTLSeconds + 1
        t.channel = .voiceOver
        #expect(t.queue.handOver().texts == ["말하는 중"])
        #expect(t.drops.map(\.0) == ["낡은 명령"])
    }

    // 인계한 문장이 합본 통지째 억제로 버려지면 되돌림이 각 문장의 버림을 `undelivered`로 한 번 통지한다(횡단 리뷰 F6).
    // 되돌리지 않으면(합본이 나갔으면) 인계는 전달이라 버림이 없다.
    @Test func handOverRollbackReportsUndeliveredOnce() async {
        let h = Harness()
        h.submit("계단 경고")
        h.submit("다음 예고")
        h.channel = .voiceOver
        let handed = h.queue.handOver()
        #expect(h.drops.isEmpty)
        handed.undelivered()
        handed.undelivered()
        #expect(h.drops.map(\.0) == ["계단 경고", "다음 예고"])
        #expect(h.drops.allSatisfy { $0.1 == .undelivered })
        #expect(DeviceSpeechHandover.empty.isEmpty)
    }

    // 칸 밖의 정지(받아쓰기·채팅 — `TtsPlayer.stop()`)가 이 칸의 발화를 끊으면 undelivered(횡단 리뷰 F4). 다른 칸의 발화
    // 토큰·이미 끝난 옛 토큰에는 반응하지 않는다.
    @Test func externalStopOfOwnSpeechIsUndelivered() async {
        let synth = SharedSynth()
        let outing = Harness(synth: synth)
        let beacon = Harness(synth: synth)
        outing.submit("횡단보도 예고")
        let token = synth.token
        synth.stop()
        beacon.queue.speechInterrupted(token: token)
        #expect(beacon.drops.isEmpty)
        outing.queue.speechInterrupted(token: token - 1)
        #expect(outing.drops.isEmpty)
        outing.queue.speechInterrupted(token: token)
        outing.queue.speechInterrupted(token: token)
        #expect(outing.drops.map(\.0) == ["횡단보도 예고"])
        #expect(outing.drops.map(\.1) == [.undelivered])
    }

    // 일시정지로 남은 이 칸의 문장은 칸을 막지 않지만(즉시 발화), 끊기는 순간 버림을 통지한다 — 말하는 중이 아니라는 이유로
    // 건너뛰면 인터럽션에 멈춘 1회성 경고가 갚아지지 않는다(코드 품질 리뷰 M1).
    @Test func pausedOwnSpeechIsReportedWhenReplaced() async {
        let h = Harness()
        h.submit("계단 경고")
        h.synth.speaking = false
        h.synth.paused = true
        h.submit("다음 예고")
        #expect(h.synth.spoken == ["계단 경고", "다음 예고"])
        #expect(h.drops.map(\.0) == ["계단 경고"])
        #expect(h.drops.map(\.1) == [.superseded])
        #expect(!h.queue.hasPending)
    }

    // 복귀 인계는 일시정지로 남은 이 칸의 문장도 끊고 처음부터 넘긴다(들리지 않은 문장이다).
    @Test func handOverTakesPausedOwnSpeech() async {
        let h = Harness()
        h.submit("횡단보도 예고")
        h.synth.speaking = false
        h.synth.paused = true
        h.channel = .voiceOver
        #expect(h.queue.handOver().texts == ["횡단보도 예고"])
        #expect(h.synth.stops == 1)
    }
}
