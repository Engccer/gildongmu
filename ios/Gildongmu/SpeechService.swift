import Foundation
import Accessibility
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

/// 온디바이스 음성 인식(iOS 26 SpeechAnalyzer + SpeechTranscriber, ko-KR 고정).
/// 웹 STT의 iOS 판이되 서버 왕복 없음. 자동 언어 감지 금지(웹 detect_language 교훈과 동형).
/// 시작·정지는 소리+햅틱 이중 채널로 통지(웹 효과음 계약의 iOS 문법).
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
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var recognitionTask: Task<Void, Never>?
    /// 최종 확정 텍스트 누적(volatile은 phase의 partial에만 반영)
    private var finalizedText = ""
    /// 취소 세대 토큰 — cancel()이 올릴 때마다 진행 중 start()가 무효화된다.
    /// start()는 권한·모델 다운로드 등 긴 await 지점을 지나므로, 그 사이 화면 이탈로
    /// cancel()이 다녀가면 뒤늦게 완주한 start()가 마이크를 재점화하는 레이스를 막는다
    /// (MainActor 직렬이라 비교·증가는 동기 구간에서 안전. webfortd 이식 리뷰 검출 백포트).
    private var generation = 0
    /// stop() 진행 중 상호 배제 — finalize 대기 동안 isListening이 true로 남아
    /// cancel()이 같은 analyzer/recognitionTask에 중복 종료를 거는 경합을 차단.
    private var stopping = false

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

        guard await AVAudioApplication.requestRecordPermission() else {
            if gen == generation { phase = .denied }
            return
        }
        // 권한 대기 중 cancel()이 다녀갔으면 여기서 중단(아직 아무것도 시작 안 됨).
        guard gen == generation else { return }

        do {
            try await beginListening()
            // 모델 다운로드·analyzer 기동 대기 중 cancel()이 다녀갔으면, 방금 만든
            // 리소스를 cancel()과 같은 절차로 폐기하고 무음 종료(시작음·phase 갱신 없음).
            guard gen == generation else {
                audioEngine.stop()
                audioEngine.inputNode.removeTap(onBus: 0)
                inputContinuation?.finish()
                await analyzer?.cancelAndFinishNow()
                recognitionTask?.cancel()
                await teardown()
                return
            }
            phase = .listening(partial: "")
            notify(soundID: 1113) // 녹음 시작음
        } catch {
            // 오류를 버리지 않는다: 로그에 원인, 화면에 종별 문구(3-state 정신 —
            // "권한 거부"·"로케일 미지원"·"모델 준비 실패"·"오디오 사용 불가"는 다른 사건).
            speechLog.error("받아쓰기 시작 실패: \(String(describing: error), privacy: .public)")
            await teardown()
            guard gen == generation else { return }
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
        // 진행 중 start()를 무효화(늦은 완주가 마이크를 재점화하지 못하게).
        generation += 1
        guard phase != .idle else { return }
        // stop()이 finalize 진행 중이면 그 경로가 teardown까지 책임진다 — 같은
        // analyzer/recognitionTask에 중복 종료를 걸지 않는다(결과 텍스트는 이미
        // 이탈한 화면의 입력 필드에 붙을 뿐이라 무해).
        guard !stopping else { return }
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

        let locale = Locale(identifier: AppLanguage.speechLocaleIdentifier)
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

        // 설치 여부를 먼저 판정한다: 무조건 설치 요청은 이미 설치된 기기에서도 불필요한
        // 왕복이고, 미설치 기기에서는 아무 표시 없이 수십 초를 삼켰다. 미설치일 때만
        // .preparing으로 대기를 화면에 노출하고 받는다.
        let installed = await SpeechTranscriber.installedLocales
        let target = locale.identifier(.bcp47)
        if !installed.contains(where: { $0.identifier(.bcp47) == target }) {
            phase = .preparing
            do {
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try await request.downloadAndInstall()
                }
            } catch {
                speechLog.error("전사 모델 설치 실패(\(target, privacy: .public)): \(String(describing: error), privacy: .public)")
                throw SpeechError.assetDownloadFailed
            }
        }
        // 예약(시스템 회수 방지)은 실패해도 이번 세션 인식엔 영향이 없다 — 비치명으로
        // 기록만 하고 진행한다. 앱 언어를 바꾸면 다음 세션이 새 로케일로 예약한다.
        do {
            try await AssetInventory.reserve(locale: locale)
        } catch {
            speechLog.error("로케일 예약 실패(\(target, privacy: .public)): \(String(describing: error), privacy: .public)")
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
                // 스트림 실패 시 이미 확정된 finalizedText는 보존(teardown이 건드리지 않음).
                // 청취 중이 아니면 정상 종료(취소·정지가 스트림을 끊은 것)이므로 무시하고,
                // stop()이 진행 중이면 그 경로가 정리·전달을 책임진다(중복 종료 금지).
                guard let self, !self.stopping, case .listening = self.phase else { return }
                speechLog.error("인식 스트림 실패: \(String(describing: error), privacy: .public)")
                // 인식이 죽은 채 마이크만 뜨거운 상태를 남기지 않는다.
                self.audioEngine.inputNode.removeTap(onBus: 0)
                await self.teardown()
                self.phase = .failed
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

        // 마이크가 뜨거워지기(engine.start) "직전"에 진행 중 VO 낭독을 끊는다(헌장 §6:
        // 발화가 마이크 입력에 겹치면 안 됨). ⚠ 과거엔 start()가 beginListening 완료
        // "후"에 끊었는데, 그 시점엔 이미 녹음 중이라 단축어 진입의 "받아쓰기" 라벨
        // 낭독 앞부분("받아")이 전사에 혼입됐다(2026-07-27 실기기 회귀). 홀드 경로가
        // 깨끗한 이유가 "누르는 즉시 = 마이크 hot 이전 차단"이므로 그 순서를 서비스
        // 계층에서 보장한다 — 홀드 없이 시작되는 모든 경로(단축어 포함)의 정본 차단 지점.
        interruptVoiceOverSpeech()
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
        case nil: return appLocalized("ios.voice.failed")
        }
    default:
        return nil
    }
}

/// 진행 중인 VoiceOver 낭독(라벨·힌트 설명)을 즉시 끊는다. 공백 1자의
/// interrupting(.high) 통지는 아무것도 발화하지 않으면서 발화 큐만 비운다.
/// 받아쓰기 시작 지점이면 어디서든 쓰이므로(서비스·홀드 버튼) 파일 레벨에 둔다.
@MainActor
func interruptVoiceOverSpeech() {
    guard UIAccessibility.isVoiceOverRunning else { return }
    var silence = AttributedString(" ")
    silence.accessibilitySpeechAnnouncementPriority = .high
    AccessibilityNotification.Announcement(silence).post()
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
