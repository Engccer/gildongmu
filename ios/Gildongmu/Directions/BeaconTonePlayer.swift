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
/// 추세음 낮게(보행 내내 반복)·이벤트음 원음. ⚠ **`tick`(0.3)은 하트비트 시절 값이다** —
/// 2026-08-08에 뜻이 **정지**로 바뀌어 배경 톤이 아니라 상태 신호가 됐는데 게인은 그대로다.
/// `.mixWithOthers`라 배경 미디어 위에서 묻히면 '정지'와 '침묵(=고장)'이 구분되지 않는다.
/// 신규 소리와 함께 배경 미디어 위 청취 판정 대상이다(접근성 감사 M5).
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

    /// 지금 **잠금·백그라운드에서 소리가 날 수 있는가**. 전경에서는 `.ambient`로도 톤이
    /// 들리므로 이 값이 거짓이어도 사용자는 알아채지 못하고, 그대로 잠그면 무음을 만난다.
    ///
    /// ⚠ 질문이 "승격에 **실패**했는가"가 아니라 "지금 들리는가"인 것이 핵심이다
    /// (접근성 감사 M3). 전자로 두면 억제(받아쓰기·검색 시트) 중 세션을 시작해 승격이
    /// **미뤄진** 경우가 "정상"으로 보고된다 — 실패한 적이 없으니 플래그가 안 서는데
    /// 실제 카테고리는 `.ambient`다. 실패·지연·route 변경 후 재적용 실패가 이 한 축으로 모인다.
    var isBackgroundAudible: Bool { appliedCategory == .playback }

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
        // 결정 지점 행동 톤 4종 — ahead 동급(같은 자리의 소리).
        .crosswalk: 0.8, .left: 0.8, .right: 0.8, .back: 0.8,
    ]

    /// 좌우 구분 방식(실기기 선택 대기, 설정 실험 피커). 매 재생 시 읽어 전환이 즉시 듣는다.
    private var leftRightScheme: LeftRightToneScheme {
        LeftRightToneScheme(
            rawValue: UserDefaults.standard.string(forKey: LeftRightToneScheme.storageKey) ?? ""
        ) ?? .default
    }

    /// 리소스 이름 키 — 같은 톤이 scheme에 따라 다른 파일을 쓴다(left·right).
    private var players: [String: AVAudioPlayer] = [:]
    private var observers: [NSObjectProtocol] = []
    /// 오디오 세션 소유권(판정은 Kit `guideAudioStep`, 여기는 적용만).
    private var audio = GuideAudioSessionState.initial
    /// 현재 적용된 카테고리. nil이면 아직 세션을 잡지 않았다.
    private var appliedCategory: GuideAudioCategory?
    /// 현재 재생 중인 톤. 톤은 전부 1초 미만이라 겹치면 두 소리가 섞여 어느 쪽도
    /// 식별되지 않는다 — 새 요청은 기존 재생을 끊고 교체한다(spec §4.4).
    private var playing: AVAudioPlayer?
    /// 지금 재생 중인 톤이 끝나는 단조 시각(초, systemUptime 축) — 발화 지연 판정
    /// (`speechDeferStep`)의 입력. 톤을 튼 적이 없거나 재생에 실패했으면 nil.
    /// ⚠ `play()` **진입 즉시** 지우고 재생 성공 시에만 대입한다 — 조기 반환 경로
    /// (세션 미확보·리소스 누락·`play()` 실패)가 셋이라 "실패했을 때 지운다"로 쓰면
    /// 하나를 빠뜨리고, 소리가 안 나는데 이전 톤의 종료 시각 때문에 문장이 미뤄진다
    /// (spec 2026-08-14 §5, 리뷰 MINOR 3).
    private(set) var toneEndsAt: Double?
    /// 현재 재생의 남은 초. 산출을 한 곳에 모은다 — `endSession()`의 원복 대기와
    /// `toneEndsAt`이 서로 다른 잔여를 보면 원복과 발화 지연이 갈린다.
    private var remainingPlaybackSeconds: Double? {
        guard let player = playing, player.isPlaying else { return nil }
        return max(0, player.duration - player.currentTime)
    }
    /// 재생이 끝나기를 기다리는 세션 원복(아래 `endSession`). nil이면 대기 없음.
    private var revertTask: Task<Void, Never>?
    private let notifHaptics = UINotificationFeedbackGenerator()
    private let impactHaptics = UIImpactFeedbackGenerator(style: .medium)

    init() {
        observeInterruptions()
    }

    /// 안내 세션 시작 — 오디오 카테고리를 `.playback`으로 승격한다.
    /// ⚠ **첫 톤 재생 전에** 불러야 한다. 승격 실패는 전경에서 보이지 않으므로
    /// 시작 시점에 알려야 사용자가 잠그기 전에 안다.
    func beginSession() {
        // ⚠ 미뤄 둔 원복을 반드시 취소한다. 남겨 두면 새 세션 한복판에서 `.ambient`가
        //   적용되어 그 세션이 통째로 잠금 무음이 된다(원복은 **끝난** 세션의 몫이다).
        cancelPendingRevert()
        dispatch(.sessionStarted)
    }

    /// 안내 세션 종료 — **우리가 승격했을 때만** `.ambient`로 원복한다.
    ///
    /// ⚠ **재생 중인 톤이 끝난 뒤에 원복한다.** 종전에는 "정지 톤을 재생한 **뒤에**
    /// 부르라"는 순서 규칙만 있었는데, 순서는 톤의 *시작*만 `.playback` 아래에 두고
    /// 한 줄 뒤의 카테고리 변경은 여전히 재생 **도중**에 떨어진다. 백그라운드에서
    /// `.ambient`는 정의상 무음이고 오디오 백그라운드 모드의 근거도 함께 사라지므로,
    /// 2.2초짜리 도착 종은 거의 들리지 않은 채 잘린다(실사용 보고 2026-08-09:
    /// "도착할 때 종소리가 안 난다"). 정지 톤(1.3초)도 같은 경로였다.
    ///
    /// 전경에서는 증상이 없다 — 그래서 이 결함은 손에 들고 시험할 때 보이지 않는다.
    /// `holdSeconds`: 톤 뒤에 이어질 **발화**의 길이(초). 운전자 모드(K2 §6.4)는 도착 문장이 VO가
    /// 아니라 이 세션 위의 AVSpeech로 나가므로, 톤 잔여만큼만 미루면 원복이 발화를 자른다.
    func endSession(holdSeconds: Double = 0) {
        guard let playbackRemaining = remainingPlaybackSeconds ?? (holdSeconds > 0 ? 0 : nil) else {
            dispatch(.sessionEnded)
            return
        }
        // 남은 재생 시간 + 여유. 톤은 전부 3초 미만이라 상한이 필요 없다.
        let remaining = playbackRemaining + 0.15 + holdSeconds
        cancelPendingRevert()
        revertTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.revertTask = nil
            self?.dispatch(.sessionEnded)
        }
    }

    private func cancelPendingRevert() {
        revertTask?.cancel()
        revertTask = nil
    }

    func play(_ tone: BeaconTone) {
        toneEndsAt = nil  // 진입 즉시 — 아래 성공 분기만이 되살린다(조기 반환 3경로 공통)
        haptic(for: tone)
        // 세션을 아직 잡지 않았으면 지금 적용한다(세션 밖 단발 재생 경로 —
        // 종전 `ensureSession()`과 동형). 인터럽션·route 변경과 달리 이 이벤트만
        // 원복 자격 없이도 적용된다.
        if appliedCategory == nil { dispatch(.ensureActive) }
        // ⚠ 판정 축은 **세션 확보 여부**이지 `isSilenced`가 아니다. 후자는 한 번의
        // 재생 실패로도 켜지므로, 그걸로 막으면 일시적 실패가 영구 침묵으로 굳는다
        // (종전 `guard ensureSession()`은 세션만 봤고 재생은 매번 다시 시도했다).
        guard appliedCategory != nil else { return }
        let player: AVAudioPlayer
        let resource = tone.resourceName(leftRightScheme)
        if let cached = players[resource] {
            player = cached
        } else {
            guard
                let url = Bundle.main.url(forResource: resource, withExtension: "mp3"),
                let loaded = try? AVAudioPlayer(contentsOf: url)
            else {
                isSilenced = true  // 리소스 누락·디코드 실패도 무음이다. 조용히 넘기면 원인이 사라진다.
                return
            }
            loaded.volume = Self.gains[tone] ?? 1
            loaded.prepareToPlay()
            players[resource] = loaded
            player = loaded
        }
        // 선점: 겹치면 두 소리가 섞여 어느 쪽도 식별되지 않는다.
        if let current = playing, current !== player, current.isPlaying { current.stop() }
        player.currentTime = 0
        if player.play() {
            isSilenced = false
            playing = player
            toneEndsAt =
                ProcessInfo.processInfo.systemUptime
                + (remainingPlaybackSeconds ?? player.duration)
        } else {
            isSilenced = true
            playing = nil
        }
    }

    /// 진동 병행: 크리티컬 신호(이탈·도착·멀어짐·**결정 지점 임박**) + 세션 경계.
    /// **모든 햅틱은 그 사운드의 실측 파형에 동기한다**(위원장 판정 2026-08-03 —
    /// 단발 제너레이터는 긴 소리와 어긋난다). 타이밍·세기는 각 mp3의 10ms RMS
    /// 엔벨로프·온셋 분석에서 추출한 값이다. **소리 파일을 갈면 재분석해 갱신할 것.**
    /// 나머지 톤(closer·tick)은 과잉 진동이라 두지 않는다.
    ///
    /// ⚠ **햅틱은 백그라운드에서 나지 않는다(플랫폼 제약).** 주머니에 넣고 걷는 세션의
    /// 유일한 채널은 소리이고, 진동은 화면을 켜 두었거나 손에 든 동안의 **보강**이다
    /// (spec 2026-08-08 §"햅틱 백그라운드 확장: 플랫폼 미지원"). 그래서 어떤 신호도
    /// 진동에만 싣지 않는다 — 임박 큐도 소리·문장·진동 셋을 함께 낸다.
    private func haptic(for tone: BeaconTone) {
        switch tone {
        case .ahead:
            // 결정 지점 10m 앞 트릴 — 실측 타격 7회(0.68초). 소리와 같은 리듬을 손에
            // 얹어, 이어폰을 안 꽂았거나 소음 속에서도 "지금이다"가 전달되게 한다.
            let trill: [(Double, Float)] = [
                (0.04, 0.86), (0.13, 0.91), (0.21, 0.96), (0.28, 0.9),
                (0.36, 0.31), (0.42, 0.72), (0.5, 1.0),
            ]
            playHaptic(
                events: trill.map { transient(at: $0.0, intensity: $0.1, sharpness: 0.6) },
                curves: [],
                fallback: { self.impactHaptics.impactOccurred() }
            )
        case .crosswalk:
            // 음향신호기식 비프 4연음 ×2 — 비프(60ms)·간격(60ms)·묶음 간격(250ms)은
            // 생성 스크립트 상수(`build-guide-tones.py`)와 동일. 타격 8회에 탭 1:1.
            var beats: [(Double, Float)] = []
            for group in 0..<2 {
                let base = Double(group) * (4 * 0.06 + 3 * 0.06 + 0.25)
                for k in 0..<4 { beats.append((base + Double(k) * 0.12, 0.9)) }
            }
            playHaptic(
                events: beats.map { transient(at: $0.0, intensity: $0.1, sharpness: 0.8) },
                curves: [],
                fallback: { self.impactHaptics.impactOccurred() }
            )
        case .left, .right:
            // 상승 2음 모티프(0·0.22초) — 두 탭, 둘째가 세다(상승감).
            playHaptic(
                events: [
                    transient(at: 0, intensity: 0.7, sharpness: 0.5),
                    transient(at: 0.22, intensity: 1.0, sharpness: 0.6),
                ],
                curves: [],
                fallback: { self.impactHaptics.impactOccurred() }
            )
        case .back:
            // 하강 글라이드 2회(0.4초 + 0.1초 간격) — 감쇠 버즈 두 번.
            playHaptic(
                events: [
                    continuous(from: 0, duration: 0.4, intensity: 0.9, sharpness: 0.3),
                    continuous(from: 0.5, duration: 0.4, intensity: 0.9, sharpness: 0.3),
                ],
                curves: [
                    decayCurve(from: 0, duration: 0.4, start: 0.9),
                    decayCurve(from: 0.5, duration: 0.4, start: 0.9),
                ],
                fallback: { self.notifHaptics.notificationOccurred(.warning) }
            )
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
        // 미뤄 둔 원복이 있으면 **버리지 말고 지금 마친다.** 아래에서 재생을 전부 멈추므로
        // 기다릴 소리가 없고, 여기서 취소만 하면 공유 세션이 `.playback`에 남아 화면을
        // 떠난 뒤에도 무음 스위치를 무시한다(원복 자격은 여전히 우리에게 있다).
        // ⚠ 플레이어·옵서버 정리보다 **앞**이다 — `dispatch`는 옵서버가 비어 있으면
        //   다시 등록하고, 카테고리 적용은 `appliedCategory`를 되살린다.
        cancelPendingRevert()
        dispatch(.sessionEnded)
        for player in players.values { player.stop() }
        players = [:]
        playing = nil
        toneEndsAt = nil
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
        } catch {
            guard category == .playback else {
                appliedCategory = nil
                isSilenced = true
                return
            }
            // 승격 실패는 **잠금 시 무음**을 뜻하지 전경 무음을 뜻하지 않는다. 여기서
            // 세션을 포기하면 실패가 과잉 전파되어, 잠그기 전에 알리려던 장치가
            // 잠그기 전 침묵을 만든다. `.ambient`로 물러나 재생 자체는 살린다
            // (그 결과 `isBackgroundAudible`이 거짓으로 남아 호출부가 알린다).
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
