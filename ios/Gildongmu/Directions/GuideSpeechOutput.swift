import GildongmuKit
import SwiftUI
import UIKit

/// 안내 문장의 채널 선택과 기기 음성 출력(E53 백그라운드 음성 안내, spec 2026-09-30-background-speech-design.md).
/// 판정은 Kit(`guideSpeechChannel`·분류 함수·`DeviceSpeechQueue`)이 하고 여기는 앱 상태(전경·VoiceOver·토글)를
/// 게시 시점에 읽어 넘기기만 한다. 세 안내 모델(도보·자동차 `BeaconModel`, `TransitGuideModel`, `OutingModel`)의
/// `post`가 이 한 곳을 지난다.
///
/// ⚠ **안내의 기기 음성(`TtsPlayer.speakGuidance`)을 부르는 자리는 여기(대기 칸 배선)와 자동차 운전자 채널
/// (`BeaconModel.post`) 둘뿐이다**(소스 가드 `background-speech-guard.test.ts`). 다른 자리가 직접 부르면 토글과
/// 분류를 우회해 정식판에서도 백그라운드 음성이 나간다.
@MainActor
enum GuideSpeechOutput {
    /// 토글 "백그라운드 음성 안내"의 실효값. 게시 시점마다 읽는다(세션 중에 바꾸면 다음 문장부터).
    /// 정식판은 봉인 플래그가 거짓이라 저장값과 무관하게 거짓이다.
    static var backgroundSpeechEnabled: Bool {
        BackgroundSpeech.isEnabled(
            stored: UserDefaults.standard.object(forKey: BackgroundSpeech.storageKey) as? Bool,
            available: AppConfig.experimentalBackgroundSpeechEnabled)
    }

    /// 게시 시점 전경 판정 — `.inactive`(제어 센터·알림 센터)는 화면을 보고 있는 중이라 전경이다(종전 `isForeground`).
    static var isForeground: Bool { UIApplication.shared.applicationState != .background }

    /// 채널 선택(spec §2). `foregroundDeviceSpeech`는 나들이만 참이다. `backgroundAudible`은 그 모델 재생기의
    /// `isBackgroundAudible`(승격 실패면 기기 음성도 들리지 않는다 — 설계 리뷰 B1).
    static func channel(
        _ speechClass: GuideSpeechClass, foregroundDeviceSpeech: Bool, backgroundAudible: Bool
    ) -> GuideSpeechChannel {
        guideSpeechChannel(
            foreground: isForeground,
            voiceOverRunning: UIAccessibility.isVoiceOverRunning,
            speechClass: speechClass,
            backgroundSpeechEnabled: backgroundSpeechEnabled,
            backgroundAudible: backgroundAudible,
            foregroundDeviceSpeech: foregroundDeviceSpeech)
    }

    /// VoiceOver 통지. 버튼 활성화의 직접 응답·화면 변화 없는 통지만 `.high`(헌장 §5).
    static func postVoiceOver(_ text: String, highPriority: Bool) {
        var attributed = AttributedString(text)
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }

    /// 모델마다 하나씩 두는 기기 음성 대기 칸. 클로저는 그 모델의 받아쓰기 억제·재생기 톤 종료 시각·가청 여부.
    static func makeDeviceQueue(
        foregroundDeviceSpeech: Bool,
        isSuppressed: @escaping () -> Bool,
        toneEndsAt: @escaping () -> Double?,
        backgroundAudible: @escaping () -> Bool
    ) -> DeviceSpeechQueue {
        DeviceSpeechQueue(
            clock: { ProcessInfo.processInfo.systemUptime },
            isSpeaking: { TtsPlayer.shared.isSpeakingGuidance },
            isSuppressed: isSuppressed,
            toneEndsAt: toneEndsAt,
            route: { channel($0, foregroundDeviceSpeech: foregroundDeviceSpeech, backgroundAudible: backgroundAudible()) },
            speak: { TtsPlayer.shared.speakGuidance($0) },
            stopSpeaking: { TtsPlayer.shared.stopGuidance() },
            postVoiceOver: { postVoiceOver($0, highPriority: $1) })
    }

    /// 도보·대중교통 `stop()`의 오디오 원복 다리(spec §7). 백그라운드 ∧ 토글 켬이면 이어질 종료·도착 문장이 기기
    /// 음성으로 나갈 수 있어 말하기 시작할 때까지 원복을 붙든다(그 뒤는 `speechBusy` 대기). 그 밖은 0 — 전경(VoiceOver
    /// 통지는 원복과 무관)과 정식판은 종전 그대로다.
    static func sessionEndHoldSeconds() -> Double {
        guard !isForeground, backgroundSpeechEnabled else { return 0 }
        return deviceSpeechEndBridgeSeconds
    }

    /// 세션 종료 원복이 기다릴 조건 — 안내 기기 음성이 말하는 중이거나 그 모델의 대기 칸에 문장이 있다.
    static func speechBusy(_ queue: DeviceSpeechQueue?) -> Bool {
        TtsPlayer.shared.isSpeakingGuidance || (queue?.hasPending ?? false)
    }
}
