import Foundation
// AVAudioNodeTapBlock 등 AVFAudio의 Sendable 미표기 API를 Swift 6에서 경고 없이 쓰기 위함
@preconcurrency import AVFoundation
import AudioToolbox
import Observation
import Speech
import UIKit

/// 온디바이스 음성 인식(iOS 26 SpeechAnalyzer + SpeechTranscriber, ko-KR 고정).
/// 웹 STT의 iOS 판이되 서버 왕복 없음. 자동 언어 감지 금지(웹 detect_language 교훈과 동형).
/// 시작·정지는 소리+햅틱 이중 채널로 통지(웹 효과음 계약의 iOS 문법).
@Observable @MainActor
final class SpeechService {
    enum Phase: Equatable {
        case idle
        /// 권한 요청·모델 에셋 다운로드 대기(최초 1회 다운로드 포함)
        case requesting
        case listening(partial: String)
        case denied
        case failed
    }

    private enum SpeechError: Error {
        case localeUnsupported  // ko-KR 미지원 기기
        case audioUnavailable   // 포맷·변환기 구성 실패
    }

    private(set) var phase: Phase = .idle

    var isListening: Bool {
        if case .listening = phase { return true }
        return false
    }

    private let audioEngine = AVAudioEngine()
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var recognitionTask: Task<Void, Never>?
    /// 최종 확정 텍스트 누적(volatile은 phase의 partial에만 반영)
    private var finalizedText = ""

    /// 권한 요청 → 모델 에셋 확인 → 마이크 탭 + 스트리밍 인식 시작.
    /// 재진입은 phase 가드로 차단(MainActor 직렬이라 동기 구간에서 확정).
    func start() async {
        switch phase {
        case .idle, .denied, .failed:
            break
        case .requesting, .listening:
            return
        }
        phase = .requesting

        guard await AVAudioApplication.requestRecordPermission() else {
            phase = .denied
            return
        }

        do {
            try await beginListening()
            phase = .listening(partial: "")
            notify(soundID: 1113) // 녹음 시작음
        } catch {
            await teardown()
            phase = .failed
        }
    }

    /// 인식 종료 후 최종 텍스트 반환(빈 결과는 nil). 오디오 세션 해제.
    func stop() async -> String? {
        guard isListening else { return nil }
        notify(soundID: 1114) // 녹음 정지음: 즉시 통지 후 확정 대기

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        inputContinuation?.finish()
        // 남은 volatile 결과를 최종으로 확정하고 스트림 종료
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await recognitionTask?.value

        let text = finalizedText.trimmingCharacters(in: .whitespacesAndNewlines)
        await teardown()
        phase = .idle
        return text.isEmpty ? nil : text
    }

    /// 결과 없이 폐기(화면 이탈 등). 통지 없음.
    func cancel() async {
        guard phase != .idle else { return }
        audioEngine.stop()
        if isListening { audioEngine.inputNode.removeTap(onBus: 0) }
        inputContinuation?.finish()
        await analyzer?.cancelAndFinishNow()
        recognitionTask?.cancel()
        await teardown()
        phase = .idle
    }

    /// denied·failed 안내 확인 후 idle 복귀(재시도 가능 상태로).
    func reset() {
        if phase == .denied || phase == .failed { phase = .idle }
    }

    private func beginListening() async throws {
        finalizedText = ""

        let locale = Locale(identifier: "ko-KR")
        guard await SpeechTranscriber.supportedLocale(equivalentTo: locale) != nil else {
            throw SpeechError.localeUnsupported
        }

        // volatile 결과 보고로 partial 갱신, 최종 결과는 누적
        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )

        // 모델 에셋 미설치면 다운로드(최초 1회, phase는 .requesting 유지)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        // 결과 소비: 이 Task는 MainActor를 상속하므로 phase 갱신이 안전
        recognitionTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    guard let self else { return }
                    let text = String(result.text.characters)
                    if result.isFinal {
                        self.finalizedText += text
                        if case .listening = self.phase {
                            self.phase = .listening(partial: self.finalizedText)
                        }
                    } else if case .listening = self.phase {
                        self.phase = .listening(partial: self.finalizedText + text)
                    }
                }
            } catch {
                // 스트림 실패 시 이미 확정된 finalizedText는 보존(stop이 그대로 반환)
            }
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw SpeechError.audioUnavailable
        }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard let forwarder = MicBufferForwarder(
            inputFormat: inputFormat,
            analyzerFormat: analyzerFormat,
            continuation: continuation
        ) else {
            throw SpeechError.audioUnavailable
        }

        // @Sendable 명시 필수: 미표기 시 클로저가 MainActor 격리를 상속해, AVFAudio가
        // 오디오 실시간 큐에서 호출하는 순간 런타임 격리 검증(SIGTRAP)으로 크래시(실기기 실측).
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { @Sendable buffer, _ in
            forwarder.forward(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
        try await analyzer.start(inputSequence: stream)
    }

    private func teardown() async {
        audioEngine.stop()
        inputContinuation = nil
        recognitionTask = nil
        analyzer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 시작·정지 이중 채널 통지: 시스템 사운드 + 햅틱
    private func notify(soundID: SystemSoundID) {
        AudioServicesPlaySystemSound(soundID)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}

/// 마이크 탭 버퍼를 분석기 포맷으로 변환해 입력 스트림에 공급.
/// 탭 콜백은 오디오 스레드에서 직렬 호출되므로 내부 상태 경합 없음(@unchecked Sendable 근거).
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
