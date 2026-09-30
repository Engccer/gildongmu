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

    /// VoiceOver 통지. 버튼 활성화의 직접 응답·화면 변화 없는 통지만 `.high`(헌장 §5). 안내 VoiceOver 게시의 **유일한
    /// 창구**라 게시 장부를 여기서 적는다(E57 착지 대기 — 소스 가드가 다른 게시 자리를 막는다).
    static func postVoiceOver(_ text: String, highPriority: Bool) {
        var attributed = AttributedString(text)
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        // VoiceOver가 꺼진 채 게시한 통지는 끝 신호가 오지 않는다 — 적지 않는다.
        if UIAccessibility.isVoiceOverRunning {
            observeAnnouncementFinishes()
            ledger.posted(text, at: ProcessInfo.processInfo.systemUptime)
        }
        AccessibilityNotification.Announcement(attributed).post()
    }

    /// 안내가 게시한 VoiceOver 통지 중 끝나지 않은 것(E57 spec 2026-09-30 §3.3, Kit `GuideAnnouncementLedger`). 세 모델 공용 —
    /// 착지는 어느 안내 통지든 말하는 중이면 끊지 않는다.
    private static var ledger = GuideAnnouncementLedger()
    private static var finishObserver: NSObjectProtocol?

    /// 안내가 게시한 VoiceOver 통지가 모두 끝났는가(만료 포함). 모델의 `announcementsSettled`가 지연 슬롯과 함께 묻는다.
    static var announcementsFinished: Bool { ledger.isSettled(at: ProcessInfo.processInfo.systemUptime) }

    /// 끝나지 않은 안내 통지 수 — 착지가 상한까지 기다렸을 때의 계측(E57 spec §4).
    static var openAnnouncements: Int { ledger.openCount(at: ProcessInfo.processInfo.systemUptime) }

    /// 끝 신호를 장부에 잇는다 — 끝까지 말했든 끊겼든(`wasSuccessful`과 무관) 그 문장은 더 말하지 않는다. 앱 수명 한 번.
    /// 문장 값은 `String`과 `NSAttributedString` 둘 다 받는다: 우리는 `AttributedString`(우선순위 속성)으로 게시하는데 끝 신호가
    /// 어느 형으로 오는지 실측이 없다(설계 리뷰 MAJOR 2 — 어긋나면 모든 착지가 상한까지 기다린다). 실험판은 형과 짝 여부를 남긴다.
    private static func observeAnnouncementFinishes() {
        guard finishObserver == nil else { return }
        finishObserver = NotificationCenter.default.addObserver(
            forName: UIAccessibility.announcementDidFinishNotification, object: nil, queue: .main
        ) { note in
            let value = note.userInfo?[UIAccessibility.announcementStringValueUserInfoKey]
            let text = (value as? String) ?? (value as? NSAttributedString)?.string
            let valueType = value.map { "\(Swift.type(of: $0))" } ?? "nil"
            MainActor.assumeIsolated {
                let now = ProcessInfo.processInfo.systemUptime
                let before = ledger.openCount(at: now)
                if let text { ledger.finished(text, at: now) }
                guard before > 0 else { return }  // 안내 통지가 없을 때의 다른 화면 통지는 남기지 않는다
                // 문장 앞부분: `matched=false`가 짝 실패인지 다른 화면 통지의 끝인지 가른다(spec 준수 리뷰 m6).
                guideDiagLog(
                    "announceFinish type=\(valueType) matched=\(ledger.openCount(at: now) < before) "
                        + "open=\(ledger.openCount(at: now)) text=\((text ?? "").prefix(20))")
            }
        }
    }

    /// 모델마다 하나씩 두는 기기 음성 대기 칸. 클로저는 그 모델의 받아쓰기 억제·재생기 톤 종료 시각·가청 여부.
    static func makeDeviceQueue(
        foregroundDeviceSpeech: Bool,
        isSuppressed: @escaping () -> Bool,
        toneEndsAt: @escaping () -> Double?,
        backgroundAudible: @escaping () -> Bool
    ) -> DeviceSpeechQueue {
        let queue = DeviceSpeechQueue(
            clock: { ProcessInfo.processInfo.systemUptime },
            isSpeaking: { TtsPlayer.shared.isSpeakingGuidance },
            isSpeakingToken: { TtsPlayer.shared.isSpeakingGuidance(token: $0) },
            voiceOverRunning: { UIAccessibility.isVoiceOverRunning },
            isSuppressed: isSuppressed,
            toneEndsAt: toneEndsAt,
            route: { channel($0, foregroundDeviceSpeech: foregroundDeviceSpeech, backgroundAudible: backgroundAudible()) },
            speak: { TtsPlayer.shared.speakGuidance($0) },
            stopSpeaking: { TtsPlayer.shared.stopGuidance() },
            postVoiceOver: { postVoiceOver($0, highPriority: $1) })
        // 칸 밖의 정지(받아쓰기 시작·채팅 화면 이탈·채팅 듣기)가 이 칸의 발화를 끊었는가(횡단 리뷰 F4, 계약 ⑨).
        TtsPlayer.shared.observeGuidanceInterruption { [weak queue] token in queue?.speechInterrupted(token: token) }
        return queue
    }

    /// 도보·대중교통 `stop()`의 오디오 원복 다리(spec §7). 백그라운드 ∧ 토글 켬이면 이어질 종료·도착 문장이 기기
    /// 음성으로 나갈 수 있어 말하기 시작할 때까지 원복을 붙든다(그 뒤는 `speechBusy` 대기). 그 밖은 0 — 전경(VoiceOver
    /// 통지는 원복과 무관)과 정식판은 종전 그대로다.
    static func sessionEndHoldSeconds() -> Double {
        guard !isForeground, backgroundSpeechEnabled else { return 0 }
        return deviceSpeechEndBridgeSeconds
    }

    /// 세션 종료 원복이 기다릴 조건 — **어느 안내든** 기기 음성이 말하는 중이거나(세 모델 공용 합성기) 그 모델의 대기
    /// 칸에 문장이 있다. 끝난 세션의 원복이 다음 세션의 발화 동안 기다리다 `.ownershipTransferred`로 끝나는 것은 무해하다.
    static func speechBusy(_ queue: DeviceSpeechQueue?) -> Bool {
        TtsPlayer.shared.isSpeakingGuidance || (queue?.hasPending ?? false)
    }
}
