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
/// `.ambient` + `.mixWithOthers`를 명시 선언한다.
@MainActor
final class BeaconTonePlayer {
    /// 재생 수단이 죽었는데 되살리지 못한 상태. 호출부가 통지 대상으로 삼는다
    /// (조용한 무음은 금지. hold·tick엔 통지가 없어 사용자가 침묵의 원인을 모른다).
    private(set) var isSilenced = false

    /// 상위(모델)가 출력을 억제 중인지. 억제 중에는 **인터럽션 옵서버도 세션을
    /// 건드리지 않는다**: 받아쓰기가 `.playAndRecord`로 잡아 둔 카테고리를 비콘이
    /// `.ambient`로 되돌리면 진행 중인 녹음 세션이 깨진다(리뷰 I-8).
    var isSuppressed = false

    /// 웹 GAIN 미러 — 값 변경 시 웹 `useBeaconSound.ts`와 동조할 것.
    private static let gains: [BeaconTone: Float] = [
        .closer: 0.35, .farther: 0.35, .nearby: 1, .tick: 0.3,
        .start: 0.8, .stop: 0.8, .ahead: 0.8, .warning: 1,
    ]

    private var players: [BeaconTone: AVAudioPlayer] = [:]
    private var observers: [NSObjectProtocol] = []
    private var sessionReady = false
    private let notifHaptics = UINotificationFeedbackGenerator()
    private let impactHaptics = UIImpactFeedbackGenerator(style: .medium)

    init() {
        observeInterruptions()
    }

    func play(_ tone: BeaconTone) {
        haptic(for: tone)
        guard ensureSession() else { return }
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
        player.currentTime = 0
        if player.play() {
            isSilenced = false
        } else {
            isSilenced = true
        }
    }

    /// 진동 병행: 크리티컬 신호(이탈·도착·멀어짐) + 세션 경계(시작·종료).
    /// 시작·종료는 **동일한 긴 진동**(위원장 판정 2026-08-03 — 단발 임팩트 기각).
    /// 나머지는 과잉 진동이라 두지 않는다.
    private func haptic(for tone: BeaconTone) {
        switch tone {
        case .warning: notifHaptics.notificationOccurred(.warning)
        case .nearby: notifHaptics.notificationOccurred(.success)
        case .farther: impactHaptics.impactOccurred()
        case .start, .stop: longBuzz()
        default: break
        }
    }

    /// 긴 진동(0.5초 연속). UIKit 제너레이터는 단발 탭뿐이라 CoreHaptics가 필요하다.
    /// 미지원 기기·엔진 실패는 단발 임팩트 폴백(무진동보다 낫다).
    private var hapticEngine: CHHapticEngine?

    private func longBuzz() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            impactHaptics.impactOccurred()
            return
        }
        do {
            if hapticEngine == nil { hapticEngine = try CHHapticEngine() }
            guard let engine = hapticEngine else { return }
            try engine.start()
            let event = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.8),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.4),
                ],
                relativeTime: 0,
                duration: 0.5
            )
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            try engine.makePlayer(with: pattern).start(atTime: 0)
        } catch {
            hapticEngine = nil  // 죽은 엔진을 붙들지 않는다(다음 호출에서 재생성 시도)
            impactHaptics.impactOccurred()
        }
    }

    /// 정리는 여기서 한다(`deinit`은 nonisolated라 MainActor 상태에 접근할 수 없다).
    /// 멱등이므로 중지·화면 이탈 어디서 불러도 안전하다.
    func shutdown() {
        for player in players.values { player.stop() }
        players = [:]
        sessionReady = false
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
    }

    // MARK: - 세션 수명

    /// 세션 카테고리를 확정한다. 실패는 `isSilenced`로 노출한다.
    private func ensureSession() -> Bool {
        if sessionReady { return true }
        if observers.isEmpty { observeInterruptions() }  // shutdown 이후 재사용 대비
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            sessionReady = true
            isSilenced = false
            return true
        } catch {
            isSilenced = true
            return false
        }
    }

    /// 전화 한 통이나 다른 컴포넌트의 `setActive(false)`가 세션을 멈추면 톤이 영영
    /// 사라진다. 인터럽션 종료 시 세션을 되살린다.
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
                    guard let self, !self.isSuppressed else { return }
                    self.sessionReady = false
                    _ = self.ensureSession()
                }
            }
        )
    }
}
