import AVFoundation
import CoreHaptics
import GildongmuKit
import UIKit

/// 실시간 길 안내 효과음 재생기(파일 기반, 2026-08-03 위원장 선정 교체).
///
/// 소리 정본은 번들 mp3(`guide-*.mp3`, 웹 `public/sounds/guide/*`와 바이트 동일 —
/// 드리프트 가드가 강제). 종전 사인파 합성(AVAudioEngine)은 폐기했고, 재생은
/// 톤별 `AVAudioPlayer` 프리로드로 한다(짧은 큐를 낮은 지연으로 반복 재생).
///
/// 게인 위계는 종전 합성 시절의 상대 크기를 보존한다(웹 `useBeaconSound` GAIN 미러):
/// 추세음 낮게(보행 내내 반복)·tick 더 낮게(하트비트)·이벤트음 원음. 실보행 튜닝 대상.
///
/// **햅틱(위원장 제안 2026-08-03)**: 크리티컬 신호는 진동 병행 — 이탈 경고=warning,
/// 도착=success, 멀어짐=impact. 소리와 같은 지점에서 나가므로 재생기가 단일 발원지다.
///
/// ⚠ **오디오 세션은 채팅 효과음(`SoundPlayer`) 선례를 따르지 않는다.** 그쪽은 가끔
/// 한 번이고 비콘은 보행 내내 2~3초마다라 프로파일이 다르다. 기본 `.soloAmbient`는 타 앱
/// 오디오를 정지시켜 음악·팟캐스트를 들으며 걷는 사용자의 재생을 첫 tick에 끊고, 반대로
/// 그 세션에 TTS(`.playback`)를 썼다면 카테고리가 남아 무음 스위치를 무시한다.
/// 유일한 연속 피드백 채널의 동작이 "그 세션에 TTS를 썼는지"에 좌우되면 안 되므로
/// `.mixWithOthers`를 양쪽 카테고리에 명시 선언한다.
///
/// **카테고리는 안내 세션 중에만 `.playback`으로 승격한다**(2026-08-08, 위원장 결정).
/// `.ambient`는 정의상 백그라운드에서 무음이라 "주머니에 넣고 걸어도 안내가 살아야
/// 한다"가 절반만 실현돼 있었다(위치는 살아 있는데 출력이 전부 막혔다). 승격의 대가로
/// 무음 스위치를 무시하게 되지만 세션 경계에서 원복하므로 영향이 세션에 갇힌다.
/// 판정은 Kit `guideAudioStep`이 소유한다 — 세션은 프로세스 전역 자원이고 소비자가
/// 셋(안내 톤·TTS·받아쓰기)이라 무조건 원복하면 다른 소비자를 깬다.
@MainActor
final class BeaconTonePlayer {
    /// 재생 수단이 죽었는데 되살리지 못한 상태. 호출부가 통지 대상으로 삼는다
    /// (조용한 무음은 금지. hold·tick엔 통지가 없어 사용자가 침묵의 원인을 모른다).
    private(set) var isSilenced = false

    /// 승격에 실패해 **잠금 중 무음이 예상되는** 상태. 전경에서는 `.ambient`로도 톤이
    /// 들리므로 알리지 않으면 사용자가 정상으로 믿고 잠근 뒤 무음을 만난다(spec §3.2).
    private(set) var isDegraded = false

    /// 상위(모델)가 출력을 억제 중인지. 억제 중에는 **인터럽션 옵서버도 세션을
    /// 건드리지 않는다**: 받아쓰기가 `.playAndRecord`로 잡아 둔 카테고리를 비콘이
    /// `.ambient`로 되돌리면 진행 중인 녹음 세션이 깨진다(리뷰 I-8).
    /// 판정은 상태 머신이 소유하므로 여기서는 이벤트로만 전달한다.
    var isSuppressed: Bool {
        get { audio.isSuppressed }
        set { dispatch(.suppressionChanged(newValue)) }
    }

    /// 웹 GAIN 미러 — 값 변경 시 웹 `useBeaconSound.ts`와 동조할 것.
    /// ⚠ `unreliable`은 `tick`(0.3)보다 높다. 신뢰 불가는 상태 경고라 배경 미디어
    /// 위에서 묻히면 안 된다(`.mixWithOthers`, spec §10.2).
    private static let gains: [BeaconTone: Float] = [
        .closer: 0.35, .farther: 0.35, .nearby: 1, .tick: 0.3,
        .start: 0.8, .stop: 0.8, .ahead: 0.8, .warning: 1, .unreliable: 0.45,
    ]

    private var players: [BeaconTone: AVAudioPlayer] = [:]
    private var observers: [NSObjectProtocol] = []
    /// 오디오 세션 소유권(판정은 Kit `guideAudioStep`, 여기는 적용만).
    private var audio = GuideAudioSessionState.initial
    /// 현재 적용된 카테고리. nil이면 아직 세션을 잡지 않았다.
    private var appliedCategory: GuideAudioCategory?
    /// 현재 재생 중인 톤. 톤은 전부 1초 미만이라 겹치면 두 소리가 섞여 어느 쪽도
    /// 식별되지 않는다 — 새 요청은 기존 재생을 끊고 교체한다(spec §4.4).
    private var playing: AVAudioPlayer?
    private let notifHaptics = UINotificationFeedbackGenerator()
    private let impactHaptics = UIImpactFeedbackGenerator(style: .medium)

    init() {
        observeInterruptions()
    }

    /// 안내 세션 시작 — 오디오 카테고리를 `.playback`으로 승격한다.
    /// ⚠ **첫 톤 재생 전에** 불러야 한다. 승격 실패는 전경에서 보이지 않으므로
    /// 시작 시점에 알려야 사용자가 잠그기 전에 안다.
    func beginSession() {
        isDegraded = false
        dispatch(.sessionStarted)
    }

    /// 안내 세션 종료 — **우리가 승격했을 때만** `.ambient`로 원복한다.
    /// ⚠ 정지 톤을 재생한 **뒤에** 부를 것. 먼저 원복하면 그 톤이 `.ambient`로 나가
    /// 잠금 상태에서 들리지 않는다.
    func endSession() {
        dispatch(.sessionEnded)
        isDegraded = false
    }

    func play(_ tone: BeaconTone) {
        haptic(for: tone)
        // 세션을 아직 잡지 않았으면 지금 적용한다(세션 밖 단발 재생 경로).
        // `.interrupted`는 "저장된 의도를 지금 적용하라"는 재조정 이벤트다 —
        // 세션 밖이면 의도가 `.ambient`라 종전 동작과 같다.
        if appliedCategory == nil { dispatch(.interrupted) }
        // ⚠ 판정 축은 **세션 확보 여부**이지 `isSilenced`가 아니다. 후자는 한 번의
        // 재생 실패로도 켜지므로, 그걸로 막으면 일시적 실패가 영구 침묵으로 굳는다
        // (종전 `guard ensureSession()`은 세션만 봤고 재생은 매번 다시 시도했다).
        guard appliedCategory != nil else { return }
        let player: AVAudioPlayer
        if let cached = players[tone] {
            player = cached
        } else {
            guard
                let url = Bundle.main.url(forResource: tone.resourceName, withExtension: "mp3"),
                let loaded = try? AVAudioPlayer(contentsOf: url)
            else {
                isSilenced = true  // 리소스 누락·디코드 실패도 무음이다. 조용히 넘기면 원인이 사라진다.
                return
            }
            loaded.volume = Self.gains[tone] ?? 1
            loaded.prepareToPlay()
            players[tone] = loaded
            player = loaded
        }
        // 선점: 겹치면 두 소리가 섞여 어느 쪽도 식별되지 않는다.
        if let current = playing, current !== player, current.isPlaying { current.stop() }
        player.currentTime = 0
        if player.play() {
            isSilenced = false
            playing = player
        } else {
            isSilenced = true
            playing = nil
        }
    }

    /// 진동 병행: 크리티컬 신호(이탈·도착·멀어짐) + 세션 경계(시작·종료).
    /// **모든 햅틱은 그 사운드의 실측 파형에 동기한다**(위원장 판정 2026-08-03 —
    /// 단발 제너레이터는 긴 소리와 어긋난다). 타이밍·세기는 각 mp3의 10ms RMS
    /// 엔벨로프·온셋 분석에서 추출한 값이다. **소리 파일을 갈면 재분석해 갱신할 것.**
    /// 나머지 톤(closer·tick·ahead)은 과잉 진동이라 두지 않는다.
    private func haptic(for tone: BeaconTone) {
        switch tone {
        case .warning:
            // 단일 저음 burst 후 0.35초 감쇠(실측: RMS 1.0 → 0.32@0.1s → 0.19@0.2s).
            playHaptic(
                events: [
                    transient(at: 0, intensity: 1.0, sharpness: 0.3),
                    continuous(from: 0, duration: 0.35, intensity: 0.8, sharpness: 0.25),
                ],
                curves: [decayCurve(from: 0, duration: 0.35, start: 0.8)],
                fallback: { self.notifHaptics.notificationOccurred(.warning) }
            )
        case .nearby:
            // 마지막 바퀴 종 연타 — 실측 타격 시점(초)·상대 세기에 탭을 1:1 배치.
            let strikes: [(Double, Float)] = [
                (0.0, 1.0), (0.29, 0.75), (0.44, 0.8), (0.59, 0.85), (0.84, 0.75), (1.1, 0.5),
            ]
            playHaptic(
                events: strikes.map { transient(at: $0.0, intensity: $0.1, sharpness: 0.55) },
                curves: [],
                fallback: { self.notifHaptics.notificationOccurred(.success) }
            )
        case .farther:
            // 하강 2음(0·0.08초) — 두 번의 짧은 탭.
            playHaptic(
                events: [
                    transient(at: 0, intensity: 0.75, sharpness: 0.5),
                    transient(at: 0.08, intensity: 0.95, sharpness: 0.4),
                ],
                curves: [],
                fallback: { self.impactHaptics.impactOccurred() }
            )
        case .start, .stop:
            longBuzz()
        default:
            break
        }
    }

    private func transient(at time: Double, intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time
        )
    }

    private func continuous(
        from time: Double, duration: Double, intensity: Float, sharpness: Float
    ) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time,
            duration: duration
        )
    }

    private func decayCurve(
        from time: Double, duration: Double, start: Float
    ) -> CHHapticParameterCurve {
        CHHapticParameterCurve(
            parameterID: .hapticIntensityControl,
            controlPoints: [
                .init(relativeTime: time, value: start),
                .init(relativeTime: time + duration * 0.3, value: start * 0.4),
                .init(relativeTime: time + duration, value: 0),
            ],
            relativeTime: 0
        )
    }

    /// CoreHaptics 패턴 재생 공통 경로. 미지원·실패는 폴백 제너레이터(무진동보다 낫다).
    private func playHaptic(
        events: [CHHapticEvent],
        curves: [CHHapticParameterCurve],
        fallback: () -> Void
    ) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            fallback()
            return
        }
        do {
            if hapticEngine == nil { hapticEngine = try CHHapticEngine() }
            guard let engine = hapticEngine else { return }
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            try engine.makePlayer(with: pattern).start(atTime: 0)
        } catch {
            hapticEngine = nil  // 죽은 엔진을 붙들지 않는다(다음 호출에서 재생성 시도)
            fallback()
        }
    }

    /// 긴 진동 — 시작·종료 효과음(트레몰로 험, 1.3초)의 엔벨로프에 **동기**한다
    /// (위원장 피드백 2026-08-03: 일정 세기 0.5초는 소리가 정점에 오르기 전에 끝나
    /// 어긋나게 느껴진다). 소리 산식이 코사인 어택 0.455초·서스테인·릴리스 0.585초라
    /// 진동 세기 곡선을 같은 시점에 맞춘다. 소리 파일을 갈면 이 곡선도 함께 갱신할 것.
    /// UIKit 제너레이터는 단발 탭뿐이라 CoreHaptics가 필요하고, 미지원 기기·엔진
    /// 실패는 단발 임팩트 폴백(무진동보다 낫다).
    private var hapticEngine: CHHapticEngine?

    private func longBuzz() {
        // 소리 엔벨로프 미러: 어택 0~0.455(코사인 상승), 서스테인 ~0.715, 릴리스 ~1.3.
        let curve = CHHapticParameterCurve(
            parameterID: .hapticIntensityControl,
            controlPoints: [
                .init(relativeTime: 0, value: 0),
                .init(relativeTime: 0.15, value: 0.15),
                .init(relativeTime: 0.3, value: 0.55),
                .init(relativeTime: 0.455, value: 1.0),
                .init(relativeTime: 0.715, value: 1.0),
                .init(relativeTime: 0.9, value: 0.7),
                .init(relativeTime: 1.1, value: 0.3),
                .init(relativeTime: 1.3, value: 0),
            ],
            relativeTime: 0
        )
        playHaptic(
            events: [continuous(from: 0, duration: 1.3, intensity: 1.0, sharpness: 0.4)],
            curves: [curve],
            fallback: { self.impactHaptics.impactOccurred() }
        )
    }

    /// 정리는 여기서 한다(`deinit`은 nonisolated라 MainActor 상태에 접근할 수 없다).
    /// 멱등이므로 중지·화면 이탈 어디서 불러도 안전하다.
    func shutdown() {
        for player in players.values { player.stop() }
        players = [:]
        playing = nil
        appliedCategory = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
    }

    // MARK: - 세션 수명

    /// 이벤트를 상태 머신에 넘기고 결과 동작을 수행한다. **판정은 Kit이 한다.**
    private func dispatch(_ event: GuideAudioEvent) {
        if observers.isEmpty { observeInterruptions() }  // shutdown 이후 재사용 대비
        let out = guideAudioStep(state: audio, event: event)
        audio = out.state
        switch out.action {
        case .none:
            break
        case let .apply(category):
            apply(category, rebuildPlayers: false)
        case let .rebuild(category):
            apply(category, rebuildPlayers: true)
        }
    }

    /// 카테고리 적용. 실패를 **삼키지 않는다** — 전경에서는 `.ambient`로도 톤이
    /// 들리므로 조용히 넘기면 사용자가 정상으로 믿고 잠근 뒤 무음을 만난다.
    private func apply(_ category: GuideAudioCategory, rebuildPlayers: Bool) {
        if rebuildPlayers {
            // route 변경·media reset은 기존 플레이어를 무효화한다. 재사용하면
            // `play()`가 true를 반환하고도 소리가 안 나는 조용한 무음이 된다.
            for player in players.values { player.stop() }
            players = [:]
            playing = nil
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                category == .playback ? .playback : .ambient, options: [.mixWithOthers]
            )
            try session.setActive(true)
            appliedCategory = category
            isSilenced = false
            if category == .playback { isDegraded = false }
        } catch {
            guard category == .playback else {
                appliedCategory = nil
                isSilenced = true
                return
            }
            // 승격 실패는 **잠금 시 무음**을 뜻하지 전경 무음을 뜻하지 않는다. 여기서
            // 세션을 포기하면 실패가 과잉 전파되어, 잠그기 전에 알리려던 장치가
            // 잠그기 전 침묵을 만든다. `.ambient`로 물러나 재생 자체는 살린다.
            isDegraded = true
            do {
                try session.setCategory(.ambient, options: [.mixWithOthers])
                try session.setActive(true)
                appliedCategory = .ambient
                isSilenced = false
            } catch {
                appliedCategory = nil
                isSilenced = true
            }
        }
    }

    /// 전화 한 통이나 다른 컴포넌트의 `setActive(false)`가 세션을 멈추면 톤이 영영
    /// 사라진다. 인터럽션 종료·route 변경·media reset을 **같은 재조정 경로**로 모은다.
    private func observeInterruptions() {
        observers.append(
            NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(), queue: .main
            ) { [weak self] note in
                guard
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    AVAudioSession.InterruptionType(rawValue: raw) == .ended
                else { return }
                MainActor.assumeIsolated {
                    self?.dispatch(.interrupted)
                }
            }
        )
        // route 변경(AirPods 해제 등)·media services reset은 플레이어를 무효화한다.
        // ⚠ `object: nil` — mediaServicesWereReset은 세션 인스턴스가 재생성되므로
        // 특정 객체로 필터하면 알림을 놓친다.
        for name in [
            AVAudioSession.routeChangeNotification,
            AVAudioSession.mediaServicesWereResetNotification,
        ] {
            observers.append(
                NotificationCenter.default.addObserver(
                    forName: name, object: nil, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.dispatch(.routeChanged)
                    }
                }
            )
        }
    }
}
