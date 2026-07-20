import AVFoundation
import Foundation
import Observation
import GildongmuKit

/// 채팅 응답 '듣기' 버튼 재생 단일 진입점(dodo-planet `TtsPlayer` 이식, full 모드만 —
/// 요약 자동 듣기·배속 설정은 gildongmu에 해당 기능이 없어 이식하지 않았다).
/// `POST /api/tts` 성공 시 MP3(AVAudioPlayer), 실패(502 fallback·4000자 초과·네트워크
/// 오류) 시 `AVSpeechSynthesizer` 온디바이스 낭독으로 폴백한다 — 서버가 어떤 이유로
/// 실패해도 듣기는 항상 동작한다. 동시 재생은 앱 전역 1개만(새 재생 시작 시 기존 정지).
@Observable
@MainActor
final class TtsPlayer {
    /// 앱 전역 단일 인스턴스 — 채팅 탭과 장소 채팅 sheet가 공유해 동시 재생 1개를 보장한다.
    static let shared = TtsPlayer()

    /// 현재 재생(네트워크 로딩 포함) 중인 메시지 id. 듣기 버튼 라벨 전환에 쓴다.
    private(set) var playingMessageID: UUID?

    /// full 모드 서버 TTS 호출 상한(dodo 웹 `TTS_FULL_TEXT_MAX` 동일값). 초과분은
    /// 서버를 건너뛰고 온디바이스 낭독으로 직행한다(전문 보장 + 비용 절약).
    static let serverTextMax = 4000

    private var audioPlayer: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()
    private var playbackDelegate: TtsPlaybackDelegate?
    /// 메시지별 MP3 캐시 — 같은 응답 재청취 시 서버 왕복(=비용)을 생략한다.
    private var audioCache: [UUID: Data] = [:]
    /// 정지·새 재생 시작마다 증가시켜, 이미 취소된 비동기 요청의 결과가 뒤늦게 적용되는 것을 막는다.
    private var generation = 0

    func isPlayingMessage(_ messageID: UUID) -> Bool {
        playingMessageID == messageID
    }

    func stop() {
        generation += 1
        audioPlayer?.stop()
        audioPlayer = nil
        synthesizer.stopSpeaking(at: .immediate)
        playbackDelegate = nil
        playingMessageID = nil
    }

    /// 응답 전문 듣기(듣기 버튼). 같은 메시지 재호출은 정지 토글이다.
    /// `text`는 마크다운 원문 — 여기서 평문화하므로 호출부는 가공하지 않는다.
    func playMessage(messageID: UUID, text: String) async {
        if playingMessageID == messageID {
            stop()
            return
        }
        stop()
        let myGeneration = generation
        let speechText = MarkdownPlainText.strip(from: text)

        if speechText.count > Self.serverTextMax {
            speak(speechText, generation: myGeneration, messageID: messageID)
            return
        }

        if let cached = audioCache[messageID] {
            play(data: cached, generation: myGeneration, messageID: messageID)
            return
        }

        playingMessageID = messageID // 네트워크 왕복 중에도 버튼을 "재생 중" 상태로 보여준다.

        do {
            let data = try await requestServerTts(text: speechText)
            guard myGeneration == generation else { return } // 그사이 정지되거나 다른 재생 시작
            audioCache[messageID] = data
            play(data: data, generation: myGeneration, messageID: messageID)
        } catch {
            guard myGeneration == generation else { return }
            // 502 fallback shape·레이트 초과·네트워크 오류 전부 온디바이스 낭독으로 폴백.
            speak(speechText, generation: myGeneration, messageID: messageID)
        }
    }

    private struct TtsRequestBody: Encodable {
        let text: String
        let locale: String
    }

    private func requestServerTts(text: String) async throws -> Data {
        var request = URLRequest(url: AppConfig.apiBaseURL.appending(path: "/api/tts"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(
            TtsRequestBody(text: text, locale: AppLanguage.current)
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.badStatus(code: status, message: nil)
        }
        return data
    }

    private func activatePlaybackSession() {
        // VoiceOver 발화와 공존(dodo 스펙 §10.7 계약): 다른 오디오는 낮추고 섞어 재생.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func play(data: Data, generation: Int, messageID: UUID) {
        guard generation == self.generation else { return }
        activatePlaybackSession()
        do {
            let player = try AVAudioPlayer(data: data)
            let delegate = TtsPlaybackDelegate { [weak self] in self?.playingMessageID = nil }
            player.delegate = delegate
            playbackDelegate = delegate
            audioPlayer = player
            playingMessageID = messageID
            player.play()
        } catch {
            playingMessageID = nil
        }
    }

    private func speak(_ text: String, generation: Int, messageID: UUID) {
        guard generation == self.generation else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            playingMessageID = nil
            return
        }
        activatePlaybackSession()
        let utterance = AVSpeechUtterance(string: trimmed)
        // STT와 같은 로케일 정본(AppLanguage) — 매핑을 재서술하지 않는다.
        utterance.voice = AVSpeechSynthesisVoice(language: AppLanguage.speechLocaleIdentifier)
        let delegate = TtsPlaybackDelegate { [weak self] in self?.playingMessageID = nil }
        synthesizer.delegate = delegate
        playbackDelegate = delegate
        playingMessageID = messageID
        synthesizer.speak(utterance)
    }
}

/// `AVAudioPlayerDelegate`·`AVSpeechSynthesizerDelegate`는 `NSObject` 상속을 요구해
/// `@Observable` 본체와 분리한다(dodo 동일 이유). 두 재생 경로(MP3·온디바이스 합성)가
/// 재생 종료 시 같은 콜백을 쓰므로 델리게이트 하나로 합쳤다.
private final class TtsPlaybackDelegate: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    private let onFinish: @MainActor () -> Void

    init(onFinish: @escaping @MainActor () -> Void) {
        self.onFinish = onFinish
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in onFinish() }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in onFinish() }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in onFinish() }
    }
}
