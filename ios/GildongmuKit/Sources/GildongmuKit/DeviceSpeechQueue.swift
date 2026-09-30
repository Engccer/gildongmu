import Foundation

/// 기기 음성 대기 칸이 문장을 끝내 내지 못한 이유(E53 spec 2026-09-30 §4.2, 설계 리뷰 M1).
public enum DeviceSpeechDrop: String, Sendable {
    /// 더 새 문장이 그 자리를 이었다(칸 교체·즉시 발화·선점). 복귀 상환 표식은 세우지 않는다 — 마지막 상태는 그 새
    /// 문장이 전한다(`DeferredAnnouncer.invalidatePending`과 같은 뜻). 1회성 장부는 되살린다.
    case superseded
    /// 아무것도 잇지 않은 채 사라졌다(유효 시간·억제·채널 소실·보호 문장에 막힘). 복귀 상환 표식을 세운다.
    case undelivered
}

/// 전경 복귀 인계의 결과(계약 6) — VoiceOver로 넘길 문장(옛 것 → 새 것)과, 모델의 합본 통지가 끝내 나가지 못했을 때의
/// 되돌림. 인계한 문장은 버림이 아니라 "전달됨"이라 칸은 버림을 통지하지 않는데, 그 합본 통지가 억제로 버려지면(복귀 순간
/// 받아쓰기 시트가 열려 있음) 인계받은 1회성 경고가 장부 없이 사라진다(통합본 횡단 리뷰 F6). 모델이 합본 통지의
/// `onDropped`에서 `undelivered()`를 부르면 각 문장의 버림 통지가 `undelivered`로 **한 번** 불린다.
@MainActor
public final class DeviceSpeechHandover {
    public let texts: [String]
    private var drops: [((DeviceSpeechDrop) -> Void)?]

    init(_ items: [(text: String, onDropped: ((DeviceSpeechDrop) -> Void)?)]) {
        texts = items.map(\.text)
        drops = items.map(\.onDropped)
    }

    /// 넘길 문장이 없는 인계(백그라운드를 거치지 않은 복귀·정식판).
    public static var empty: DeviceSpeechHandover { DeviceSpeechHandover([]) }

    public var isEmpty: Bool { texts.isEmpty }

    /// 합본 통지가 끝내 나가지 못했다 — 인계한 문장마다 버림(`undelivered`)을 통지한다. 두 번 불려도 한 번만.
    public func undelivered() {
        let pending = drops
        drops = []
        pending.forEach { $0?(.undelivered) }
    }
}

/// 기기 음성 대기 한 칸(spec 2026-09-30 background-speech §4.2 — 나들이 spec 2026-09-26 §7.3에서 올렸다).
/// 도보·자동차·대중교통·나들이 세 모델이 같은 타입을 하나씩 쓴다(복붙 금지).
///
/// 계약:
/// 1. 안내 발화가 없으면 즉시 말한다(칸에 옛 문장이 있으면 `superseded`로 버린 뒤 — 순서 역전 금지).
/// 2. `.high`와 `urgent`(임박 명령)는 선점한다: 칸을 비우고 말하는 중인 안내를 끊고 즉시 말한다. 끊긴 것이 이 칸의
///    문장이면 그 문장도 `superseded`로 통지한다(몇 음절만 들린 1회성 경고의 장부를 되살린다).
/// 3. 그 밖은 한 칸에 기다린다(latest-wins, 옛 문장은 `superseded`). 칸의 문장이 보호 문장(나들이 시작·횡단보도)이면
///    보호 문장이 아닌 새 문장은 들이지 않는다(`undelivered`).
/// 4. 말이 끝나면(0.3초 확인) 톤이 울리는 중이면 그 뒤까지(한 번의 대기당 상한 3초, 톤 뒤 발화 계약) 기다렸다가 꺼내고,
///    꺼내는 순간 억제 중(우회 문장 제외)·유효 시간 초과(보호 문장 제외)면 버리고, 채널을 다시 고른다.
/// 5. 세션 경계 `reset()`은 버림 통지 없이 비운다.
/// 6. 전경 복귀 `handOver()`는 **게시하지 않고 VoiceOver로 넘길 문장 목록을 돌려준다**(모델이 복귀 상환과 합쳐 `.high`
///    한 통지로 낸다 — 통지 둘을 잇달아 내면 뒤의 것이 앞의 것을 자른다, 리뷰 M-2·접근성 MAJOR 1). 넘기는 것은 채널이
///    VoiceOver로 바뀐 문장뿐이다: 지금 말하는 문장은 **이 칸이 낸 발화일 때만**(발화 토큰 대조 — 다른 모델의 발화를
///    끊지 않는다, 리뷰 M-1) 끊고 넘긴다. 채널이 그대로 기기 음성이면(VoiceOver 꺼진 나들이) 끊지도 다시 내지도 않는다.
/// 7. 칸 밖의 정지가 이 칸의 발화를 끊으면 그 문장에 버림을 통지한다(`speechInterrupted(token:reason:)`, 통합본 횡단 리뷰 F4):
///    받아쓰기 시작·채팅 화면 이탈·채팅 듣기·오디오 인터럽션은 `undelivered`, 더 새 안내 발화는 `superseded`. 칸 자신의 선점은
///    먼저 `lastSpoken`을 비우고 `superseded`로, 인계는 넘긴 목록으로 처리한다.
/// 버림 통지(`onDropped`)는 문장마다 **최대 한 번**이고 부르는 주체는 이 칸이다(인계한 문장은 `DeviceSpeechHandover`가).
///
/// `isSpeaking`은 **안내** 발화만 본다 — 채팅 듣기는 안내를 막지 않는다(설계 리뷰 M3, 안내가 채팅을 끊는다. 운전자 채널과 같다).
/// 일시정지로 남은 발화(인터럽션 뒤)는 말하는 중이 아니다(앱 `TtsPlayer.isSpeakingGuidance`, 횡단 리뷰 F5) — 그러지 않으면 칸이
/// 선점 문장이 올 때까지 영영 막힌다. 반면 `isSpeakingToken`은 일시정지를 포함한다(그 문장이 아직 합성기에 있는가).
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

        /// 기다리지 않고 선점하는가(계약 2).
        var preempts: Bool { highPriority || speechClass == .urgent }
    }

    private let clock: () -> Double
    private let sleeper: (Double) async -> Void
    private let isSpeaking: () -> Bool
    private let isSpeakingToken: (Int) -> Bool
    private let voiceOverRunning: () -> Bool
    private let isSuppressed: () -> Bool
    private let toneEndsAt: () -> Double?
    private let route: (GuideSpeechClass) -> GuideSpeechChannel
    private let speak: (String) -> Int
    private let stopSpeaking: () -> Void
    private let postVoiceOver: (String, Bool) -> Void

    private var pending: Item?
    /// 이 칸이 마지막으로 기기 음성에 넘긴 문장과 그 발화 토큰. 토큰이 아직 말하는 중일 때만 "지금 이 칸의 문장"이다.
    private var lastSpoken: (item: Item, token: Int)?
    private var drain: Task<Void, Never>?
    /// 경계 세대 — `reset`·`handOver`·선점 뒤에 깨어난 옛 드레인이 새 칸을 건드리지 않게.
    private var generation = 0

    /// - `isSpeaking`: 어느 안내든 기기 음성이 말하는 중인가(`TtsPlayer.isSpeakingGuidance`, 채팅 듣기 제외).
    /// - `isSpeakingToken`: 그 발화 토큰의 문장이 아직 합성기에 있는가(말하는 중이든 일시정지든, 다른 발화가 끊었으면 거짓).
    /// - `voiceOverRunning`: VoiceOver가 켜져 있는가 — 꺼져 있으면 복귀 인계가 기기 음성을 끊지 않는다(들을 채널이 없다).
    /// - `isSuppressed`: 받아쓰기 억제 중인가 — 꺼내는·넘기는 순간 참이면 버린다(녹음 중 발화 0, 헌장 §6).
    /// - `toneEndsAt`: 그 모델 재생기의 톤 종료 시각 — 꺼내기 전 톤 뒤 발화(`speechDeferStep`)를 지킨다.
    /// - `route`: 지금 채널(채널 술어를 그 시점 상태로 다시 부른다).
    /// - `speak`: 안내 발화(`TtsPlayer.speakGuidance` — 직전 발화를 끊고 말한다). 발화 토큰을 돌려준다.
    /// - `stopSpeaking`: 안내 발화 중단. `postVoiceOver`: 드레인 시점에 채널이 VoiceOver로 바뀐 문장의 게시(텍스트, 고우선).
    public init(
        clock: @escaping () -> Double,
        sleeper: @escaping (Double) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        },
        isSpeaking: @escaping () -> Bool,
        isSpeakingToken: @escaping (Int) -> Bool,
        voiceOverRunning: @escaping () -> Bool,
        isSuppressed: @escaping () -> Bool,
        toneEndsAt: @escaping () -> Double?,
        route: @escaping (GuideSpeechClass) -> GuideSpeechChannel,
        speak: @escaping (String) -> Int,
        stopSpeaking: @escaping () -> Void,
        postVoiceOver: @escaping (String, Bool) -> Void
    ) {
        self.clock = clock
        self.sleeper = sleeper
        self.isSpeaking = isSpeaking
        self.isSpeakingToken = isSpeakingToken
        self.voiceOverRunning = voiceOverRunning
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
        let speakingNow = isSpeaking()
        if item.preempts || !speakingNow {
            clearPending(.superseded)
            // 끊길 이 칸의 문장 — 말하는 중이든 일시정지로 남았든(`isSpeakingToken`은 일시정지 포함). `speakingNow`로 거르면
            // 일시정지된 1회성 경고가 버림 통지 없이 사라진다(코드 품질 리뷰 M1).
            if let current = lastSpoken, isSpeakingToken(current.token) {
                lastSpoken = nil
                current.item.onDropped?(.superseded)
            }
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
    /// 다음 발화가 끊는다.
    public func reset() {
        generation += 1
        drain?.cancel()
        drain = nil
        pending = nil
        lastSpoken = nil
    }

    /// 전경 복귀(계약 6). VoiceOver로 넘길 문장을 옛 것 → 새 것 순서로 돌려준다(게시는 호출부가 한 통지로). 합본 통지가
    /// 끝내 나가지 못하면 호출부가 결과의 `undelivered()`를 부른다.
    public func handOver() -> DeviceSpeechHandover {
        // VoiceOver가 꺼진 전경(도보·대중교통은 채널이 VoiceOver 게시라 듣는 사람이 없다): 말하는 기기 음성을 끊지 않고 칸은
        // 드레인에 맡긴다(접근성 m2, 검증 리뷰 N3 — VoiceOver를 쓰지 않는 사용자는 끝까지 기기 음성으로 듣는다).
        guard voiceOverRunning() else { return .empty }
        var handed: [(text: String, onDropped: ((DeviceSpeechDrop) -> Void)?)] = []
        if let current = lastSpoken, isSpeakingToken(current.token),
           route(current.item.speechClass) == .voiceOver {
            // 들을 채널이 VoiceOver로 바뀌었다 — 기기 음성을 끊고 처음부터 넘긴다(반쯤 들린 문장은 정보가 아니다).
            stopSpeaking()
            lastSpoken = nil
            if current.item.bypassSuppression || !isSuppressed() {
                handed.append((current.item.text, current.item.onDropped))
            } else {
                current.item.onDropped?(.undelivered)
            }
        }
        if let waiting = pending {
            switch route(waiting.speechClass) {
            case .device:
                break  // 채널이 그대로다 — 칸은 드레인에 맡긴다
            case .voiceOver:
                clearDrain()
                pending = nil
                if isDeliverable(waiting) {
                    handed.append((waiting.text, waiting.onDropped))
                } else {
                    waiting.onDropped?(.undelivered)
                }
            case .drop:
                clearDrain()
                pending = nil
                waiting.onDropped?(.undelivered)
            }
        }
        return DeviceSpeechHandover(handed)
    }

    /// 칸 밖의 정지가 안내 발화를 끊었다(계약 7) — 그 발화가 이 칸이 낸 것이면 버림을 이유와 함께 통지한다: 받아쓰기·채팅·
    /// 인터럽션은 `undelivered`, 더 새 안내 발화(다른 칸, 또는 드레인이 꺼낸 이 칸의 다음 문장)는 `superseded`. 칸에서 기다리던
    /// 문장은 꺼내는 순간의 억제 검사가 맡는다(받아쓰기는 곧 억제를 건다).
    public func speechInterrupted(token: Int, reason: DeviceSpeechDrop) {
        guard let current = lastSpoken, current.token == token else { return }
        lastSpoken = nil
        current.item.onDropped?(reason)
    }

    private func clearDrain() {
        generation += 1
        drain?.cancel()
        drain = nil
    }

    private func clearPending(_ reason: DeviceSpeechDrop) {
        guard let dropped = pending else { return }
        pending = nil
        clearDrain()
        dropped.onDropped?(reason)
    }

    private func say(_ item: Item) {
        let token = speak(item.text)
        lastSpoken = (item, token)
    }

    /// 꺼내는 순간의 검사(계약 4) — 억제(우회 제외)·유효 시간(보호 제외).
    private func isDeliverable(_ item: Item) -> Bool {
        guard item.bypassSuppression || !isSuppressed() else { return false }
        return item.protected || clock() - item.at <= Self.pendingTTLSeconds
    }

    private func startDrainIfNeeded() {
        guard drain == nil else { return }
        let gen = generation
        let sleeper = self.sleeper  // 폴 대기 동안 self를 붙들지 않는다(톤 대기는 최대 3초 동안 붙든다 — 모델은 앱 수명)
        drain = Task { [weak self] in
            var toneWaitStart: Double?
            while true {
                await sleeper(Self.pollSeconds)
                guard let self, !Task.isCancelled, self.generation == gen else { return }
                if self.isSpeaking() {
                    toneWaitStart = nil  // 다시 말하기 시작했다 — 톤 대기 상한은 다음 대기에서 새로 잰다
                    continue
                }
                // 톤 뒤 발화(spec 2026-08-14): 꺼내는 순간 톤이 울리는 중이면 그 뒤까지 — 한 번의 대기당 상한 3초.
                let now = self.clock()
                let more = speechDeferStep(now: now, toneEndsAt: self.toneEndsAt())
                if more > 0 {
                    let started = toneWaitStart ?? now
                    toneWaitStart = started
                    let left = SpeechDeferConstants.speechDeferMaxSeconds - (now - started)
                    if left > 0 {
                        await sleeper(min(more, left))
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
        guard isDeliverable(item) else {
            item.onDropped?(.undelivered)
            return
        }
        switch route(item.speechClass) {
        case .device: say(item)
        // 전경 ∧ VoiceOver로 바뀌었다(복귀 인계보다 드레인이 먼저 깬 짧은 창, 또는 나들이 전경에서 VoiceOver를 켠 경우).
        // 인계와 같은 이유로 `.high` — 앱 활성화 순간의 기본 우선순위 통지는 화면 낭독에 잠식된다(검증 리뷰 N5).
        case .voiceOver: postVoiceOver(item.text, true)
        case .drop: item.onDropped?(.undelivered)
        }
    }
}
