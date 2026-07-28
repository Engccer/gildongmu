import AVFoundation

/// 채팅 전송·수신 효과음 재생(dodo-planet `SoundPlayer` 이식, 2026-07-28).
/// 시각장애인 사용자에게 대화 턴의 경계를 비언어 신호로 알린다 — 제출은 짧은 단음,
/// 응답 완료는 밝은 2음 상승(웹 `useChatSound`와 동일 신호 체계, mp3도 dodo 번들 재사용).
/// 받아쓰기 신호음은 `SpeechService`의 시스템 사운드(1113/1114)가 담당해 여기선 비이식.
/// 인스턴스 생성 시 1회만 파일을 로드해 두고 재생 요청마다 처음부터 다시 튼다.
/// 오디오 세션 카테고리는 건드리지 않는다(단순 UI 효과음 — 실 음성을 다루는 `TtsPlayer`와
/// 분리). ⚠ 앱 기본 카테고리는 무음 스위치를 존중하지만, TTS(.playback)·받아쓰기
/// (.playAndRecord)를 한 번이라도 쓰면 카테고리가 남아 이후 효과음이 무음 스위치를
/// 무시할 수 있다(dodo 동일 구조의 상속된 한계 — 세션 리셋은 TTS 재생 중단 위험과
/// 트레이드오프라 도입하지 않음).
@MainActor
final class SoundPlayer {
    enum Sound: String {
        case chatSend = "chat-send"
        case chatReceive = "chat-receive"
    }

    private var players: [Sound: AVAudioPlayer] = [:]

    init() {
        for sound in [Sound.chatSend, .chatReceive] {
            guard let url = Bundle.main.url(forResource: sound.rawValue, withExtension: "mp3"),
                  let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            player.prepareToPlay()
            players[sound] = player
        }
    }

    /// 파일 로드 실패 시 조용히 아무 것도 하지 않는다(효과음은 부가 기능이라 채팅 자체를
    /// 막을 이유가 아니다).
    func play(_ sound: Sound) {
        guard let player = players[sound] else { return }
        player.currentTime = 0
        player.play()
    }
}
