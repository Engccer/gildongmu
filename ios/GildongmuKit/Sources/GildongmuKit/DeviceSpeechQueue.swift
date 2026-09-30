import Foundation

/// 기기 음성 대기 칸이 문장을 끝내 내지 못한 이유(E53 spec 2026-09-30 §4.2, 설계 리뷰 M1).
public enum DeviceSpeechDrop: String, Sendable {
    /// 더 새 문장이 그 자리를 이었다(칸 교체·즉시 발화·`.high` 선점). 복귀 상환 표식은 세우지 않는다 — 마지막 상태는
    /// 그 새 문장이 전한다(`DeferredAnnouncer.invalidatePending`과 같은 뜻). 1회성 장부는 되살린다.
    case superseded
    /// 아무것도 잇지 않은 채 사라졌다(유효 시간·억제·채널 소실·보호 문장에 막힘). 복귀 상환 표식을 세운다.
    case undelivered
}

/// 기기 음성 대기 한 칸(spec 2026-09-30 background-speech §4.2 — 나들이 spec 2026-09-26 §7.3에서 올렸다).
/// 도보·자동차·대중교통·나들이 세 모델이 같은 타입을 하나씩 쓴다(복붙 금지).
///
/// 계약:
/// 1. 안내 발화가 없으면 즉시 말한다(칸에 옛 문장이 있으면 `superseded`로 버린 뒤 — 순서 역전 금지).
/// 2. `.high`는 선점한다: 칸을 비우고 말하는 중인 안내를 끊고 즉시 말한다(VoiceOver의 `.high`가 끼어드는 것과 같다).
/// 3. 그 밖은 한 칸에 기다린다(latest-wins, 옛 문장은 `superseded`). 단 칸의 문장이 보호 문장(나들이 시작·횡단보도)이면
///    보호 문장이 아닌 새 문장은 들이지 않는다(`undelivered`).
/// 4. 말이 끝나면(0.3초 확인) 톤이 울리는 중이면 그 뒤까지(상한 3초, 톤 뒤 발화 계약) 기다렸다가 꺼내고, 꺼내는 순간
///    억제 중(우회 문장 제외)·유효 시간 초과(보호 문장 제외)면 버리고, 채널을 다시 고른다.
/// 5. 세션 경계 `reset()`은 버림 통지 없이 비운다. 전경 복귀 `handOver()`는 말하는 중인 안내를 끊고 그 문장과 칸의
///    문장을 지금 채널로 다시 낸다(설계 리뷰 M5 — 겹침·유실 둘 다 막는다).
/// 버림 통지(`onDropped`)는 문장마다 **최대 한 번**이고 부르는 주체는 이 칸이다.
///
/// `isSpeaking`은 **안내** 발화만 본다 — 채팅 듣기는 안내를 막지 않는다(설계 리뷰 M3, 안내가 채팅을 끊는다. 운전자 채널과 같다).
///
/// `DeferredAnnouncer`처럼 Kit에 두는 이유: 위험 부위가 순수 함수가 아니라 이 수명 계약이고, 시계·sleeper를 주입해야
/// 테스트가 열린다(앱 타깃엔 테스트 레인이 없다).
@MainActor
public final class DeviceSpeechQueue {
    /// 대기 칸 문장의 유효 시간(초, 나들이 종전 값). 늦게 나온 명령은 이미 지난 자리를 말한다.
    public nonisolated static let pendingTTLSeconds = 6.0
    /// 말이 끝났는지 확인하는 간격(초, 나들이 종전 값).
    public nonisolated static let pollSeconds = 0.3

    private struct Item {
        let text: String
        let highPriority: Bool
        let protected: Bool
        let bypassSuppression: Bool
        let speechClass: GuideSpeechClass
        let onDropped: ((DeviceSpeechDrop) -> Void)?
        let at: Double
    }

    private let clock: () -> Double
    private let sleeper: (Double) async -> Void
    private let isSpeaking: () -> Bool
    private let isSuppressed: () -> Bool
    private let toneEndsAt: () -> Double?
    private let route: (GuideSpeechClass) -> GuideSpeechChannel
    private let speak: (String) -> Void
    private let stopSpeaking: () -> Void
    private let postVoiceOver: (String, Bool) -> Void

    private var pending: Item?
    /// 마지막으로 기기 음성에 넘긴 문장 — 복귀 인계가 말하는 중인 그것을 처음부터 다시 낸다.
    private var lastSpoken: Item?
    private var drain: Task<Void, Never>?
    /// 경계 세대 — `reset`·`handOver` 뒤에 깨어난 옛 드레인이 새 칸을 건드리지 않게.
    private var generation = 0

    /// - `isSpeaking`: **안내** 기기 음성이 말하는 중인가(`TtsPlayer.isSpeakingGuidance`, 채팅 듣기 제외).
    /// - `isSuppressed`: 받아쓰기 억제 중인가 — 꺼내는 순간 참이면 버린다(녹음 중 발화 0, 헌장 §6).
    /// - `toneEndsAt`: 그 모델 재생기의 톤 종료 시각 — 꺼내기 전 톤 뒤 발화(`speechDeferStep`)를 지킨다.
    /// - `route`: 지금 채널(채널 술어를 그 시점 상태로 다시 부른다).
    /// - `speak`: 안내 발화(`TtsPlayer.speakGuidance` — 직전 발화를 끊고 말한다). `stopSpeaking`: 안내 발화 중단.
    /// - `postVoiceOver`: VoiceOver 통지(텍스트, 고우선).
    public init(
        clock: @escaping () -> Double,
        sleeper: @escaping (Double) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        },
        isSpeaking: @escaping () -> Bool,
        isSuppressed: @escaping () -> Bool,
        toneEndsAt: @escaping () -> Double?,
        route: @escaping (GuideSpeechClass) -> GuideSpeechChannel,
        speak: @escaping (String) -> Void,
        stopSpeaking: @escaping () -> Void,
        postVoiceOver: @escaping (String, Bool) -> Void
    ) {
        self.clock = clock
        self.sleeper = sleeper
        self.isSpeaking = isSpeaking
        self.isSuppressed = isSuppressed
        self.toneEndsAt = toneEndsAt
        self.route = route
        self.speak = speak
        self.stopSpeaking = stopSpeaking
        self.postVoiceOver = postVoiceOver
    }

    /// 대기 칸에 문장이 있는가 — 세션 종료 원복이 이 동안 기다린다(`BeaconTonePlayer.endSession`).
    public var hasPending: Bool { pending != nil }

    /// 기기 음성 채널로 고른 문장을 낸다(계약 1~3).
    /// - `protected`: 보호 문장(나들이 시작·횡단보도) — 유효 시간으로 버리지 않고 보호 문장이 아닌 새 문장에 밀리지 않는다.
    /// - `bypassSuppression`: 사용자 활성화의 직접 응답 — 꺼낼 때 억제 검사를 면제한다(`DeferredAnnouncer.announceNow` 동형).
    /// - `onDropped`: 끝내 나가지 못하면 이유와 함께 한 번 불린다. 즉시 말했거나 나중에 게시했으면 부르지 않는다.
    public func submit(
        _ text: String, highPriority: Bool, protected: Bool, bypassSuppression: Bool,
        speechClass: GuideSpeechClass, onDropped: ((DeviceSpeechDrop) -> Void)?
    ) {
        let item = Item(
            text: text, highPriority: highPriority, protected: protected,
            bypassSuppression: bypassSuppression, speechClass: speechClass, onDropped: onDropped, at: clock())
        if highPriority || !isSpeaking() {
            clearPending(.superseded)
            say(item)
            return
        }
        if let current = pending, current.protected, !protected {
            onDropped?(.undelivered)
            return
        }
        let replaced = pending
        pending = item
        replaced?.onDropped?(.superseded)
        startDrainIfNeeded()
    }

    /// 세션 경계(시작·stop) — 칸을 **버림 통지 없이** 비운다. `stop()`은 상환 장부를 먼저 비우므로 여기서 통지하면
    /// 끝난 세션의 경고가 되살아난다(`DeferredAnnouncer.advanceGeneration`과 같은 이유). 말하는 중인 종료 문장은 두고
    /// 다음 세션의 첫 문장이 끊는다.
    public func reset() {
        generation += 1
        drain?.cancel()
        drain = nil
        pending = nil
        lastSpoken = nil
    }

    /// 전경 복귀(설계 리뷰 M5): 말하는 중인 안내를 끊고 그 문장을 처음부터, 이어서 칸의 문장을 **지금 채널로** 다시 낸다
    /// (VoiceOver가 켜져 있으면 VoiceOver 통지 — 두 목소리가 겹치지 않고, 복귀 순간 문장이 사라지지도 않는다).
    /// 반환 = 다시 낸 문장이 있는가.
    @discardableResult
    public func handOver() -> Bool {
        generation += 1
        drain?.cancel()
        drain = nil
        var delivered = false
        if isSpeaking(), let speaking = lastSpoken {
            stopSpeaking()
            delivered = redeliver(speaking, notifyDrop: false) || delivered
        }
        lastSpoken = nil
        if let waiting = pending {
            pending = nil
            delivered = redeliver(waiting, notifyDrop: true) || delivered
        }
        return delivered
    }

    private func clearPending(_ reason: DeviceSpeechDrop) {
        guard let dropped = pending else { return }
        pending = nil
        generation += 1
        drain?.cancel()
        drain = nil
        dropped.onDropped?(reason)
    }

    private func say(_ item: Item) {
        lastSpoken = item
        speak(item.text)
    }

    /// 지금 채널로 다시 낸다. 기기 음성이면 발화, VoiceOver면 통지, 버림이면(원래 칸의 문장만) 버림 통지.
    private func redeliver(_ item: Item, notifyDrop: Bool) -> Bool {
        switch route(item.speechClass) {
        case .device:
            say(item)
            return true
        case .voiceOver:
            postVoiceOver(item.text, item.highPriority)
            return true
        case .drop:
            if notifyDrop { item.onDropped?(.undelivered) }
            return false
        }
    }

    private func startDrainIfNeeded() {
        guard drain == nil else { return }
        let gen = generation
        drain = Task { [weak self] in
            var toneWaitStart: Double?
            while true {
                guard let self else { return }
                await self.sleeper(Self.pollSeconds)
                guard !Task.isCancelled, self.generation == gen else { return }
                if self.isSpeaking() { continue }
                // 톤 뒤 발화(spec 2026-08-14): 꺼내는 순간 톤이 울리는 중이면 그 뒤까지 — 상한은 같은 3초.
                let now = self.clock()
                let more = speechDeferStep(now: now, toneEndsAt: self.toneEndsAt())
                if more > 0 {
                    let started = toneWaitStart ?? now
                    toneWaitStart = started
                    if now - started < SpeechDeferConstants.speechDeferMaxSeconds {
                        await self.sleeper(min(more, SpeechDeferConstants.speechDeferMaxSeconds - (now - started)))
                        guard !Task.isCancelled, self.generation == gen else { return }
                        continue
                    }
                }
                self.drain = nil
                guard let next = self.pending else { return }
                self.pending = nil
                self.deliver(next)
                return
            }
        }
    }

    private func deliver(_ item: Item) {
        guard item.bypassSuppression || !isSuppressed() else {
            item.onDropped?(.undelivered)
            return
        }
        guard item.protected || clock() - item.at <= Self.pendingTTLSeconds else {
            item.onDropped?(.undelivered)
            return
        }
        _ = redeliver(item, notifyDrop: true)
    }
}
