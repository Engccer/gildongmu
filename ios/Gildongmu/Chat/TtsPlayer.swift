import AVFoundation
import Foundation
import Observation
import GildongmuKit

/// 채팅 응답 '듣기' 버튼 재생 단일 진입점(dodo-planet `TtsPlayer` 이식, full 모드만 —
/// 요약 자동 듣기는 gildongmu에 해당 기능이 없어 이식하지 않았다. 듣기 속도 3단 설정은
/// 2026-07-28 이식: 규칙은 Kit `ListenSpeed`, 저장은 기기 로컬 `@AppStorage`).
/// `AVSpeechSynthesizer` 온디바이스 낭독이 정본이다(즉시 재생·비용 0, 2026-07-27 승격 —
/// 이전엔 서버 TTS가 정본이고 온디바이스가 폴백이었다). 서버 TTS(`POST /api/tts`,
/// Chirp MP3)는 현재 로케일 보이스가 기기에 없을 때만 폴백으로 호출하고, 그마저
/// 실패하면 시스템 기본 보이스로 낭독한다 — 듣기는 항상 동작한다.
/// 동시 재생은 앱 전역 1개만(새 재생 시작 시 기존 정지).
@Observable
@MainActor
final class TtsPlayer {
    /// 앱 전역 단일 인스턴스 — 채팅 탭과 장소 채팅 sheet가 공유해 동시 재생 1개를 보장한다.
    static let shared = TtsPlayer()

    private init() {
        synthesizer.delegate = playbackDelegate
    }

    /// 현재 재생(네트워크 로딩 포함) 중인 메시지 id. 듣기 버튼 라벨 전환에 쓴다.
    private(set) var playingMessageID: UUID?

    /// 폴백 경로의 서버 TTS 호출 상한(dodo 웹 `TTS_FULL_TEXT_MAX` 동일값). 초과분은
    /// 서버를 건너뛰고 온디바이스 낭독으로 직행한다(전문 보장 + 비용 절약).
    static let serverTextMax = 4000

    /// 듣기 속도 배율(1/1.5/2) — 재생 시점마다 설정을 조회하므로 설정 변경은 다음
    /// 재생부터 적용된다(재생 중 실시간 변속은 비대상). 규칙·키 정본은 Kit `ListenSpeed`.
    private var listenSpeed: Double {
        ListenSpeed.normalizeSpeed(
            UserDefaults.standard.object(forKey: ListenSpeed.storageKey) as? Double
        )
    }

    private var audioPlayer: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()
    /// ⚠ delegate는 싱글턴과 수명을 같이한다(재생마다 생성·정지 시 해제 금지).
    /// `stopSpeaking(.immediate)` 직후 delegate를 해제하면 TextToSpeech의 비동기
    /// 취소 콜백(메인 큐 dispatch)이 해제된 객체를 retain하다 EXC_BAD_ACCESS로
    /// 크래시한다(시뮬레이터 재현+크래시 리포트 실측 2026-07-27). 재생 세대 구분은
    /// 객체 교체가 아니라 `onFinish`의 generation 가드가 담당한다.
    private let playbackDelegate = TtsPlaybackDelegate()
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

        // 온디바이스 낭독이 정본. 서버 폴백은 현재 로케일 보이스가 기기에 없을 때만
        // (온디바이스 합성은 네트워크와 무관해 그 외 실패 모드가 없다).
        // 지원 6개 로케일 전부 iOS 기본 보이스가 내장되어 아래 서버 경로는
        // 실사용에서 거의 도달하지 않는 안전망이다.
        if AVSpeechSynthesisVoice(language: AppLanguage.speechLocaleIdentifier) != nil {
            speak(speechText, generation: myGeneration, messageID: messageID)
            return
        }

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
            // 서버까지 실패하면 시스템 기본 보이스로 최후 낭독(듣기 불능 상태 금지).
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
            // `AVAudioPlayer.rate`는 진짜 시간 배율이라 설정 배율을 그대로 대입한다
            // (온디바이스 낭독의 캘리브레이션 테이블과 축이 다름 — `ListenSpeed` 주석 참조).
            player.enableRate = true
            player.rate = Float(listenSpeed)
            player.delegate = playbackDelegate
            armFinishCallback(source: player, generation: generation)
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
        // 보이스 부재 시 nil 대입 = 시스템 기본 보이스(최후 폴백 경로).
        utterance.voice = AVSpeechSynthesisVoice(language: AppLanguage.speechLocaleIdentifier)
        // 곱셈 아님 — 실측 캘리브레이션 테이블(`ListenSpeed.speechRate` 주석의 실측 표 참조).
        utterance.rate = ListenSpeed.speechRate(forMultiplier: listenSpeed)
        armFinishCallback(source: utterance, generation: generation)
        playingMessageID = messageID
        synthesizer.speak(utterance)
    }

    /// 이번 재생 세대의 종료 콜백 장전. `source`(이번 세션의 player/utterance)의
    /// 아이덴티티와 generation 이중 가드로, 정지·새 재생 뒤 늦게 도착하는 이전 세션
    /// 콜백(didCancel 등)이 새 재생의 버튼 라벨 상태를 오클리어하지 못하게 막는다.
    private func armFinishCallback(source: AnyObject, generation: Int) {
        playbackDelegate.arm(source: source) { [weak self] in
            guard let self, self.generation == generation else { return }
            self.playingMessageID = nil
        }
    }
}

/// `AVAudioPlayerDelegate`·`AVSpeechSynthesizerDelegate`는 `NSObject` 상속을 요구해
/// `@Observable` 본체와 분리한다(dodo 동일 이유). 두 재생 경로(MP3·온디바이스 합성)가
/// 재생 종료 시 같은 콜백을 쓰므로 델리게이트 하나로 합쳤다. 인스턴스는 `TtsPlayer`
/// 싱글턴이 영구 보유(수명 주석 참조 — 재생 중 해제가 크래시 원인이었다).
/// 프레임워크 콜백은 스레드 비보장이라 클래스 전체를 `@MainActor` 격리하고, 콜백은
/// 발신 객체 아이덴티티만 뽑아 메인으로 홉 — 가변 상태 접근이 전부 메인에 직렬화된다.
@MainActor
private final class TtsPlaybackDelegate: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    /// 현재 세션의 발신 객체(player/utterance) 아이덴티티. 단일 슬롯 콜백이 이전
    /// 세션의 지연 이벤트에 오호출되는 것을 발신자 대조로 차단한다.
    private var expectedSource: ObjectIdentifier?
    private var onFinish: (() -> Void)?

    /// 재생 세대마다 `armFinishCallback`이 호출한다.
    func arm(source: AnyObject, onFinish: @escaping () -> Void) {
        expectedSource = ObjectIdentifier(source)
        self.onFinish = onFinish
    }

    /// 아이덴티티는 Sendable이라 격리 경계를 안전하게 넘는다(객체 자체는 안 넘김).
    private nonisolated func finished(from source: AnyObject) {
        let sourceID = ObjectIdentifier(source)
        Task { @MainActor in
            guard sourceID == self.expectedSource else { return }
            self.onFinish?()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        finished(from: player)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finished(from: utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finished(from: utterance)
    }
}
