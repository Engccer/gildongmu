import Foundation
import Accessibility
import GildongmuKit
// AVAudioNodeTapBlock 등 AVFAudio의 Sendable 미표기 API를 Swift 6에서 경고 없이 쓰기 위함
@preconcurrency import AVFoundation
import AudioToolbox
import Observation
import OSLog
import Speech
import SwiftUI
import UIKit

/// 받아쓰기 실패 진단 채널. 실패가 화면엔 종별 문구로, 로그엔 원인 객체로 남는다
/// (심사 기기처럼 재현이 안 되는 환경의 유일한 단서).
private let speechLog = Logger(subsystem: "app.gildongmu", category: "speech")

/// 온디바이스 음성 인식. 엔진은 OS 버전이 정한다(`makeSpeechEngine`): iOS 26+는
/// `SpeechAnalyzer`+`SpeechTranscriber`(`AnalyzerSpeechEngine`), 그 아래는 `SFSpeechRecognizer`
/// 온디바이스 강제(`LegacySpeechEngine`). **어느 엔진이든 오디오는 기기를 떠나지 않는다** —
/// 개인정보 3자 일치(웹 privacy 카피·PrivacyInfo·ASC 라벨)가 이 한 줄에 걸려 있으므로
/// 서버 전사 폴백을 만들지 말 것. 웹 STT의 iOS 판이되 서버 왕복 없음, 자동 언어 감지 금지
/// (웹 detect_language 교훈과 동형). 시작·정지는 소리+햅틱 이중 채널로 통지.
@Observable @MainActor
final class SpeechService {
    enum Phase: Equatable {
        case idle
        /// 마이크 권한 요청 대기
        case requesting
        /// 전사 모델 에셋 다운로드 대기(최초 1회). 수십 초~분 단위라 `requesting`과
        /// 분리해 "준비 중"을 화면에 내보낸다 — 침묵한 채 도는 대기가 "음성이 안 된다"로
        /// 보였던 App Store 반려 원인.
        case preparing
        case listening(partial: String)
        case denied
        case failed
    }

    enum SpeechError: Error {
        case localeUnsupported  // 현재 앱 언어를 이 기기가 미지원
        case audioUnavailable   // 포맷·변환기 구성 실패
        case assetDownloadFailed  // 전사 모델 다운로드·설치 실패
        /// (26 미만) 이 언어의 온디바이스 인식 자산이 이 기기에 없다. 서버 인식으로
        /// 대신하지 않는다 — 정직한 미지원이 정답.
        case onDeviceUnsupported
        /// (26 미만) 음성 인식 권한 거부(마이크 권한과 별개의 두 번째 권한)
        case recognitionDenied
    }

    private(set) var phase: Phase = .idle
    /// 직전 실패 원인(`.failed` 구간에서만 유효). 알럿 문구를 종별로 가르는 근거 —
    /// 시각장애 사용자는 화면으로 원인을 짐작할 수 없어 문장이 유일한 구분 수단이다.
    private(set) var lastError: SpeechError?

    var isListening: Bool {
        if case .listening = phase { return true }
        return false
    }

    /// 시작 준비 중(권한 대기·모델 다운로드). 소비자 가드는 두 단계를 함께 봐야 한다 —
    /// 정지도 재시작도 불가한 구간이라는 점에서 동일하다.
    var isStarting: Bool {
        phase == .requesting || phase == .preparing
    }

    private let audioEngine = AVAudioEngine()
    /// 이번 세션의 인식 엔진(세션마다 새로 만든다 — 엔진 내부 상태를 세션 밖으로 끌고 가지 않는다)
    private var engine: (any SpeechEngine)?
    /// 취소 세대 토큰 — cancel()이 올릴 때마다 진행 중 start()가 무효화된다.
    /// start()는 권한·모델 다운로드 등 긴 await 지점을 지나므로, 그 사이 화면 이탈로
    /// cancel()이 다녀가면 뒤늦게 완주한 start()가 마이크를 재점화하는 레이스를 막는다
    /// (MainActor 직렬이라 비교·증가는 동기 구간에서 안전. webfortd 이식 리뷰 검출 백포트).
    private var generation = 0
    /// stop() 진행 중 상호 배제 — finalize 대기 동안 isListening이 true로 남아
    /// cancel()이 같은 엔진에 중복 종료를 거는 경합을 차단.
    private var stopping = false
    /// 이 서비스가 안내 출력 억제를 쥐고 있는가(`GuideSession.setDictationActive`).
    /// 시작에서 걸고 **모든** 종료 경로(거부·취소·실패·정지)에서 푼다 — 한 경로라도
    /// 빠지면 안내가 영구 침묵한다.
    private var suppressingGuide = false

    private func setGuideSuppressed(_ on: Bool) {
        guard suppressingGuide != on else { return }
        suppressingGuide = on
        GuideSession.shared.setDictationActive(on)
    }

    /// 권한 요청 → 모델 에셋 확인 → 마이크 탭 + 스트리밍 인식 시작.
    /// 재진입은 phase 가드로 차단(MainActor 직렬이라 동기 구간에서 확정).
    func start() async {
        switch phase {
        case .idle, .denied, .failed:
            break
        case .requesting, .preparing, .listening:
            return
        }
        phase = .requesting
        lastError = nil
        let gen = generation
        // 마이크가 뜨거워지기 전부터 억제한다(권한·모델 준비 중 통지도 곧 녹음에 겹친다).
        setGuideSuppressed(true)

        guard await AVAudioApplication.requestRecordPermission() else {
            if gen == generation { phase = .denied }
            setGuideSuppressed(false)
            return
        }
        // 권한 대기 중 cancel()이 다녀갔으면 여기서 중단(아직 아무것도 시작 안 됨).
        guard gen == generation else { setGuideSuppressed(false); return }

        do {
            try await beginListening(gen: gen)
            // 모델 다운로드·엔진 기동 대기 중 cancel()이 다녀갔으면, 방금 만든
            // 리소스를 cancel()과 같은 절차로 폐기하고 무음 종료(시작음·phase 갱신 없음).
            guard gen == generation else {
                audioEngine.stop()
                audioEngine.inputNode.removeTap(onBus: 0)
                await engine?.cancel()
                teardown()
                setGuideSuppressed(false)
                return
            }
            phase = .listening(partial: "")
            // 상태 전이가 만든 라벨 변경(준비 중 → 받아쓰기)을 VoiceOver가 읽기 시작하면
            // 그 발화가 이미 뜨거워진 마이크에 섞인다(2026-07-27 "받아" 혼입과 동계열).
            // 마이크 hot 직전 차단(beginListening 말미)만으로는 이 전이를 못 덮으므로,
            // 청취 진입 시점에도 한 번 끊는다 — 홀드·탭·단축어 전 경로 공통 지점.
            interruptVoiceOverSpeech()
            notify(soundID: 1113) // 녹음 시작음
        } catch {
            teardown()
            setGuideSuppressed(false)
            // 취소된 세션의 뒤늦은 실패는 사용자에게 일어난 사건이 아니다 — 화면도
            // 로그도 건드리지 않는다(취소 자체가 던지는 CancellationError 소음 차단).
            guard gen == generation else { return }
            // 오류를 버리지 않는다: 로그에 원인, 화면에 종별 문구(3-state 정신 —
            // "권한 거부"·"로케일 미지원"·"모델 준비 실패"·"오디오 사용 불가"는 다른 사건).
            speechLog.error("받아쓰기 시작 실패: \(String(describing: error), privacy: .public)")
            lastError = error as? SpeechError
            phase = .failed
        }
    }

    /// 인식 종료 후 최종 텍스트 반환(빈 결과는 nil). 오디오 세션 해제.
    func stop() async -> String? {
        guard isListening, !stopping else { return nil }
        stopping = true
        defer { stopping = false }
        notify(soundID: 1114) // 녹음 정지음: 즉시 통지 후 확정 대기

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        // 남은 입력을 최종으로 확정하고 스트림 종료까지 대기
        let text = (await engine?.finish() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        teardown()
        phase = .idle
        setGuideSuppressed(false)
        // 발화가 담기지 않은 전사는 빈 전사와 같이 nil로 돌린다. 무음 구간에서 STT가
        // 문장부호만 내놓는 일이 있는데(무발화 릴리스에 "." 실측 2026-08-01), 그대로
        // 소비하면 채팅은 "."을 전송해 답변을 받아오고 검색은 "."으로 조회한다 —
        // 사용자가 한 적 없는 행동이다. 소비 지점 4곳(검색·길찾기·채팅 전송·잠금)에
        // 가드를 흩뿌리는 대신 여기 한 곳에서 가른다.
        return hasSpeechContent(text) ? text : nil
    }

    /// 결과 없이 폐기(화면 이탈 등). 통지 없음.
    func cancel() async {
        // 진행 중 start()를 무효화(늦은 완주가 마이크를 재점화하지 못하게).
        generation += 1
        guard phase != .idle else { return }
        // stop()이 finalize 진행 중이면 그 경로가 teardown까지 책임진다 — 같은
        // 엔진에 중복 종료를 걸지 않는다(결과 텍스트는 이미
        // 이탈한 화면의 입력 필드에 붙을 뿐이라 무해).
        guard !stopping else { return }
        audioEngine.stop()
        if isListening { audioEngine.inputNode.removeTap(onBus: 0) }
        await engine?.cancel()
        teardown()
        phase = .idle
        setGuideSuppressed(false)
    }

    /// denied·failed 안내 확인 후 idle 복귀(재시도 가능 상태로).
    func reset() {
        if phase == .denied || phase == .failed { phase = .idle }
    }

    /// `gen`은 호출 시점의 취소 세대. 상태를 화면에 내보내는 지점에서 이 세션이 아직
    /// 유효한지 확인하는 데 쓴다(취소된 세션이 죽은 뒤 UI를 되살리지 못하게).
    private func beginListening(gen: Int) async throws {
        let locale = Locale(identifier: AppLanguage.speechLocaleIdentifier)
        let engine = makeSpeechEngine()
        self.engine = engine

        try await engine.prepare(locale: locale) {
            // 취소된 세션은 여기서 끝낸다: cancel()이 phase를 .idle로 되돌린 뒤 이미
            // 죽은 이 호출이 .preparing을 재기입하면, 완료 시 세대 가드가 phase를
            // 건드리지 않으므로 아무도 내려 주지 않는 영구 고착이 된다(isStarting이
            // true로 남아 탭·홀드 전부 무반응, reset()도 .denied/.failed만 봐서 미복구).
            // MainActor 직렬이라 이 검사와 다음 줄 대입 사이엔 아무도 끼어들 수 없다.
            guard gen == generation else { throw CancellationError() }
            phase = .preparing
        }
        // prepare()의 긴 대기(모델 다운로드·인식 권한) 중 cancel()이 다녀갔으면 teardown이
        // self.engine을 이미 비웠다 — 여기서 끝내야 아직 아무것도 시작하지 않은 채 조용히
        // 정리된다(리뷰 검출 2026-08-19: 계속 진행하면 로컬 engine만 살아 attach·run을 완주하고
        // start()의 청소 경로는 nil을 보게 돼 인식 세션이 고아가 된다).
        guard gen == generation else { throw CancellationError() }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        try await engine.attach(
            to: audioEngine,
            onPartial: { [weak self] text in
                guard let self, case .listening = self.phase else { return }
                self.phase = .listening(partial: text)
            },
            onFailure: { [weak self] in
                // 청취 중이 아니면 정상 종료(취소·정지가 스트림을 끊은 것)이므로 무시하고,
                // stop()이 진행 중이면 그 경로가 정리·전달을 책임진다(중복 종료 금지).
                guard let self, !self.stopping, case .listening = self.phase else { return }
                // 인식이 죽은 채 마이크만 뜨거운 상태를 남기지 않는다.
                self.audioEngine.inputNode.removeTap(onBus: 0)
                self.teardown()
                self.phase = .failed
                self.setGuideSuppressed(false)
            }
        )

        // 마이크가 뜨거워지기(engine.start) "직전"에 진행 중 VO 낭독을 끊는다(헌장 §6:
        // 발화가 마이크 입력에 겹치면 안 됨). ⚠ 과거엔 start()가 beginListening 완료
        // "후"에 끊었는데, 그 시점엔 이미 녹음 중이라 단축어 진입의 "받아쓰기" 라벨
        // 낭독 앞부분("받아")이 전사에 혼입됐다(2026-07-27 실기기 회귀). 홀드 경로가
        // 깨끗한 이유가 "누르는 즉시 = 마이크 hot 이전 차단"이므로 그 순서를 서비스
        // 계층에서 보장한다 — 홀드 없이 시작되는 모든 경로(단축어 포함)의 정본 차단 지점.
        interruptVoiceOverSpeech()
        audioEngine.prepare()
        try audioEngine.start()
        try await engine.run()
        // attach·run의 짧은 await 사이에도 cancel()이 self.engine을 비울 수 있다. 청소 경로가
        // 언제나 실제 세션을 가리키도록 완주 시점에 재동기화한다(start()의 세대 가드가 정리).
        self.engine = engine
    }

    private func teardown() {
        audioEngine.stop()
        engine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 시작·정지 이중 채널 통지: 시스템 사운드 + 햅틱
    private func notify(soundID: SystemSoundID) {
        AudioServicesPlaySystemSound(soundID)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}

/// 받아쓰기 안내 알럿 문구(없으면 nil = 알럿 미표시). 권한 거부와 실패를 가르고,
/// 실패는 다시 원인별로 가른다 — 사용자가 다음에 할 일이 각각 다르기 때문이다
/// (설정 열기 / 언어 바꾸기 / 다른 앱 정리 / 네트워크 확인 후 재시도).
/// 소비 3뷰가 같은 분기를 복제하지 않도록 판정을 여기 한 곳에 둔다.
@MainActor
func speechAlertText(_ speech: SpeechService) -> String? {
    switch speech.phase {
    case .denied:
        return appLocalized("ios.voice.denied")
    case .failed:
        switch speech.lastError {
        case .localeUnsupported: return appLocalized("ios.voice.errorLocale")
        case .audioUnavailable: return appLocalized("ios.voice.errorAudio")
        case .assetDownloadFailed: return appLocalized("ios.voice.errorDownload")
        case .onDeviceUnsupported: return appLocalized("ios.voice.errorOnDevice")
        case .recognitionDenied: return appLocalized("ios.voice.deniedRecognition")
        case nil: return appLocalized("ios.voice.failed")
        }
    default:
        return nil
    }
}

/// 진행 중인 VoiceOver 낭독(라벨·힌트 설명)을 즉시 끊는다. 받아쓰기 시작 지점이면
/// 어디서든 쓰이므로(서비스·홀드 버튼) 파일 레벨에 둔다.
///
/// **문자열은 빈 문자열이어야 한다**(2026-08-01 실기기 4후보 판정). `.high` 통지는
/// *게시 시점에* 발화 큐를 끊고 *발화는 내용이 있을 때만* 하는 분리된 동작이라,
/// 빈 문자열이 "발화 0 + 차단 성공"을 동시에 만족한다(announcementDidFinish 이벤트가
/// 아예 오지 않는 것이 발화 0의 증거).
///
/// ⚠ **발화 가능한 문자를 넣지 말 것 — 전사 오염과 같은 뜻이다.** 이 함수는 마이크가
/// 뜨거워진 뒤에도 호출되므로(start()의 청취 진입) 그 발화가 스피커→마이크로 돌아
/// 전사에 그대로 섞인다. 실측 반증된 후보: 공백 1자(" ")는 "space"로 낭독돼 홀드
/// 한 번에 "space space"가 들리고 아무 말 없는 전사에 "자."가 찍혔다(종전 주석의
/// "공백은 무음"은 거짓). U+200B도 발화돼 "들어가겠습니다."가 혼입됐고,
/// `.layoutChanged` 통지는 차단에 실패하며 오히려 새 낭독을 유발했다("잠 고 정 다시.").
@MainActor
func interruptVoiceOverSpeech() {
    guard UIAccessibility.isVoiceOverRunning else { return }
    var silence = AttributedString("")
    silence.accessibilitySpeechAnnouncementPriority = .high
    AccessibilityNotification.Announcement(silence).post()
}
