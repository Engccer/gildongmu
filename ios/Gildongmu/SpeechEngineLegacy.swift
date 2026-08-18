import Foundation
@preconcurrency import AVFoundation
import OSLog
import Speech

private let speechLog = Logger(subsystem: "app.gildongmu", category: "speech")

/// iOS 26 미만 온디바이스 인식: `SFSpeechRecognizer` + `requiresOnDeviceRecognition`.
/// 이 옵션이 개인정보 불변식(오디오는 기기를 떠나지 않는다)의 유일한 근거이므로 절대
/// 끄지 말 것 — 온디바이스 자산이 없는 언어·기기는 `.onDeviceUnsupported`로 정직하게
/// 실패한다(서버 인식으로 조용히 대신하지 않는다). 앱은 그 자산을 내려받을 수 없어
/// 준비 단계(`willDownload`)가 없다.
@MainActor
final class LegacySpeechEngine: SpeechEngine {
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onPartial: (@MainActor (String) -> Void)?
    private var onFailure: (@MainActor () -> Void)?
    /// `bestTranscription.formattedString`은 세션 누적본이라 마지막 값이 곧 전사다.
    private var latestText = ""
    /// 결과 스트림이 끝났는가(최종 결과 또는 오류). finish()의 대기 여부를 가른다.
    private var ended = false
    private var finishContinuation: CheckedContinuation<Void, Never>?
    private var finishTimeout: Task<Void, Never>?

    /// `isAvailable == false`(네트워크·시스템 사정으로 인식기가 일시 불가). 종별 문구가
    /// 없는 일반 실패로 둔다 — 사용자가 할 일이 "다시 시도" 하나뿐이다.
    private struct RecognizerUnavailable: Error {}

    func prepare(locale: Locale, willDownload: () throws -> Void) async throws {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw SpeechService.SpeechError.localeUnsupported
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw SpeechService.SpeechError.onDeviceUnsupported
        }
        guard await Self.authorize() == .authorized else {
            throw SpeechService.SpeechError.recognitionDenied
        }
        self.recognizer = recognizer
    }

    private static func authorize() async -> SFSpeechRecognizerAuthorizationStatus {
        let current = SFSpeechRecognizer.authorizationStatus()
        if current != .notDetermined { return current }
        return await withCheckedContinuation { continuation in
            // @Sendable 명시 필수: TCC 콜백은 백그라운드 큐에서 오는데, 미표기 시 클로저가
            // MainActor 격리를 상속해 런타임 격리 검증(SIGTRAP)으로 크래시한다
            // (iOS 18.6 시뮬레이터 실측 2026-08-19 — 마이크 탭 클로저와 같은 계열).
            SFSpeechRecognizer.requestAuthorization { @Sendable status in
                continuation.resume(returning: status)
            }
        }
    }

    func attach(
        to audioEngine: AVAudioEngine,
        onPartial: @escaping @MainActor (String) -> Void,
        onFailure: @escaping @MainActor () -> Void
    ) async throws {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // 개인정보 불변식의 근거. 지우면 오디오가 Apple 서버로 나간다.
        request.requiresOnDeviceRecognition = true
        // SpeechTranscriber 전사도 문장부호를 붙이므로 소비 지점(검색 normalizeVoiceQuery·
        // 채팅 원문 유지)의 전제를 같게 맞춘다.
        request.addsPunctuation = true
        self.request = request
        self.onPartial = onPartial
        self.onFailure = onFailure
        latestText = ""
        ended = false

        let box = RequestBox(request)
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        // @Sendable 명시 필수(AnalyzerSpeechEngine과 같은 이유 — 오디오 실시간 큐 호출).
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { @Sendable buffer, _ in
            box.request.append(buffer)
        }
    }

    func run() async throws {
        guard let recognizer, let request else { throw SpeechService.SpeechError.audioUnavailable }
        guard recognizer.isAvailable else { throw RecognizerUnavailable() }
        // @Sendable 명시 필수(권한 콜백과 같은 이유 — 결과 콜백 큐가 임의다).
        task = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            // 콜백 큐가 임의라 Sendable 조각만 뽑아 MainActor로 넘긴다.
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            if let error { speechLog.error("SFSpeech 결과 오류: \(String(describing: error), privacy: .public)") }
            Task { @MainActor [weak self] in
                self?.handle(text: text, isFinal: isFinal, failed: failed)
            }
        }
    }

    private func handle(text: String?, isFinal: Bool, failed: Bool) {
        if let text {
            latestText = text
            onPartial?(text)
        }
        guard isFinal || failed else { return }
        ended = true
        // 정지·취소 뒤의 오류(무발화 "No speech detected"·취소 216)는 서비스가 청취 상태가
        // 아니라 무시한다. 청취 중의 오류만 스트림 사망으로 전달된다.
        if failed, !isFinal { onFailure?() }
        resumeFinish()
    }

    func finish() async -> String {
        request?.endAudio()
        if !ended {
            // 최종 결과는 endAudio 직후 오는 것이 정상이나, 오지 않는 경우(무발화·시스템
            // 지연)에 정지가 영영 안 끝나는 것을 막는 상한. 상한에 걸리면 현재 전사로 확정.
            await withCheckedContinuation { continuation in
                finishContinuation = continuation
                finishTimeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(3))
                    self?.resumeFinish()
                }
            }
        }
        task?.cancel()
        task = nil
        return latestText
    }

    func cancel() async {
        request?.endAudio()
        task?.cancel()
        task = nil
        resumeFinish()
    }

    private func resumeFinish() {
        finishTimeout?.cancel()
        finishTimeout = nil
        finishContinuation?.resume()
        finishContinuation = nil
    }
}

/// 탭 콜백(오디오 스레드)에서 요청에 버퍼를 붙이기 위한 상자. `append`는 Apple이
/// 오디오 콜백에서 호출하도록 설계한 API라 스레드 안전(@unchecked Sendable 근거).
private final class RequestBox: @unchecked Sendable {
    let request: SFSpeechAudioBufferRecognitionRequest
    init(_ request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }
}
