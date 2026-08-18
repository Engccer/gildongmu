import Foundation
// AVAudioNodeTapBlock 등 AVFAudio의 Sendable 미표기 API를 Swift 6에서 경고 없이 쓰기 위함
@preconcurrency import AVFoundation
import OSLog
import Speech

private let speechLog = Logger(subsystem: "app.gildongmu", category: "speech")

/// iOS 26+ 온디바이스 인식: `SpeechAnalyzer` + `SpeechTranscriber`. 앱이 전사 모델을
/// 직접 내려받는다(`prepare`의 `willDownload` 뒤 `AssetInventory`).
@available(iOS 26, *)
@MainActor
final class AnalyzerSpeechEngine: SpeechEngine {
    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var inputStream: AsyncStream<AnalyzerInput>?
    private var recognitionTask: Task<Void, Never>?
    /// 최종 확정 텍스트 누적(volatile은 onPartial에만 반영)
    private var finalizedText = ""

    func prepare(locale: Locale, willDownload: () throws -> Void) async throws {
        guard await SpeechTranscriber.supportedLocale(equivalentTo: locale) != nil else {
            throw SpeechService.SpeechError.localeUnsupported
        }

        // volatile 결과 보고로 partial 갱신, 최종 결과는 누적
        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )
        self.transcriber = transcriber

        // 설치 여부를 먼저 판정한다: 무조건 설치 요청은 이미 설치된 기기에서도 불필요한
        // 왕복이고, 미설치 기기에서는 아무 표시 없이 수십 초를 삼켰다. 미설치일 때만
        // 준비 단계를 화면에 노출하고 받는다.
        let installed = await SpeechTranscriber.installedLocales
        let target = locale.identifier(.bcp47)
        if !installed.contains(where: { $0.identifier(.bcp47) == target }) {
            try willDownload()
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try await request.downloadAndInstall()
                }
            } catch {
                speechLog.error("전사 모델 설치 실패(\(target, privacy: .public)): \(String(describing: error), privacy: .public)")
                throw SpeechService.SpeechError.assetDownloadFailed
            }
        }
        // 예약(시스템 회수 방지)은 실패해도 이번 세션 인식엔 영향이 없다 — 비치명으로
        // 기록만 하고 진행한다. 언어 전환이 남긴 다른 로케일 예약은 먼저 회수한다:
        // 예약 상한(maximumReservedLocales)을 잠식하면 새 로케일 예약이 거부된다.
        do {
            for stale in await AssetInventory.reservedLocales
            where stale.identifier(.bcp47) != target {
                await AssetInventory.release(reservedLocale: stale)
            }
            if try await AssetInventory.reserve(locale: locale) == false {
                speechLog.error("로케일 예약 미확보(\(target, privacy: .public)) — 인식은 계속 진행")
            }
        } catch {
            speechLog.error("로케일 예약 실패(\(target, privacy: .public)): \(String(describing: error), privacy: .public)")
        }
    }

    func attach(
        to audioEngine: AVAudioEngine,
        onPartial: @escaping @MainActor (String) -> Void,
        onFailure: @escaping @MainActor () -> Void
    ) async throws {
        guard let transcriber else { throw SpeechService.SpeechError.audioUnavailable }
        finalizedText = ""
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        // 결과 소비: 이 Task는 MainActor를 상속하므로 상태 갱신이 안전
        recognitionTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    guard let self else { return }
                    let text = String(result.text.characters)
                    if result.isFinal {
                        self.finalizedText += text
                        onPartial(self.finalizedText)
                    } else {
                        onPartial(self.finalizedText + text)
                    }
                }
            } catch {
                // 스트림 실패 시 이미 확정된 finalizedText는 보존. 정상 종료·취소인지의
                // 판정은 서비스가 한다(청취 중이 아니면 무시).
                speechLog.error("인식 스트림 실패: \(String(describing: error), privacy: .public)")
                onFailure()
            }
        }

        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw SpeechService.SpeechError.audioUnavailable
        }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation
        self.inputStream = stream

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard let forwarder = MicBufferForwarder(
            inputFormat: inputFormat,
            analyzerFormat: analyzerFormat,
            continuation: continuation
        ) else {
            throw SpeechService.SpeechError.audioUnavailable
        }

        // @Sendable 명시 필수: 미표기 시 클로저가 MainActor 격리를 상속해, AVFAudio가
        // 오디오 실시간 큐에서 호출하는 순간 런타임 격리 검증(SIGTRAP)으로 크래시(실기기 실측).
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { @Sendable buffer, _ in
            forwarder.forward(buffer)
        }
    }

    func run() async throws {
        guard let analyzer, let inputStream else { throw SpeechService.SpeechError.audioUnavailable }
        try await analyzer.start(inputSequence: inputStream)
    }

    func finish() async -> String {
        inputContinuation?.finish()
        // 남은 volatile 결과를 최종으로 확정하고 스트림 종료
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await recognitionTask?.value
        return finalizedText
    }

    func cancel() async {
        inputContinuation?.finish()
        await analyzer?.cancelAndFinishNow()
        recognitionTask?.cancel()
    }
}

/// 마이크 탭 버퍼를 분석기 포맷으로 변환해 입력 스트림에 공급.
/// 탭 콜백은 오디오 스레드에서 직렬 호출되므로 내부 상태 경합 없음(@unchecked Sendable 근거).
@available(iOS 26, *)
private final class MicBufferForwarder: @unchecked Sendable {
    private let converter: AVAudioConverter?
    private let analyzerFormat: AVAudioFormat
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    /// 변환 대기 버퍼. convert()의 입력 블록은 forward() 안에서 동기 호출되므로 경합 없음.
    private var pendingBuffer: AVAudioPCMBuffer?

    init?(
        inputFormat: AVAudioFormat,
        analyzerFormat: AVAudioFormat,
        continuation: AsyncStream<AnalyzerInput>.Continuation
    ) {
        self.analyzerFormat = analyzerFormat
        self.continuation = continuation
        if inputFormat == analyzerFormat {
            self.converter = nil
        } else {
            guard let converter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else { return nil }
            self.converter = converter
        }
    }

    func forward(_ buffer: AVAudioPCMBuffer) {
        guard let converter else {
            continuation.yield(AnalyzerInput(buffer: buffer))
            return
        }
        let ratio = analyzerFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
        guard let converted = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else { return }

        pendingBuffer = buffer
        var conversionError: NSError?
        converter.convert(to: converted, error: &conversionError) { [self] _, outStatus in
            guard let pending = pendingBuffer else {
                outStatus.pointee = .noDataNow
                return nil
            }
            pendingBuffer = nil
            outStatus.pointee = .haveData
            return pending
        }
        if conversionError == nil, converted.frameLength > 0 {
            continuation.yield(AnalyzerInput(buffer: converted))
        }
    }
}
