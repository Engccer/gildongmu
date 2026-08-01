import AVFoundation
import GildongmuKit

/// 거리 비콘 톤 재생기. Kit `BeaconTones`의 시퀀스를 사인파로 합성한다.
///
/// mp3를 번들하지 않는 이유: 추세를 **음높이 방향**으로 알리는 게 이 기능의 전부라
/// 주파수가 데이터로 남아야 하고, 파일로 렌더하면 웹 정본과 따로 굳어 드리프트한다.
///
/// ⚠ **오디오 세션은 채팅 효과음(`SoundPlayer`) 선례를 따르지 않는다.** 그쪽은 가끔
/// 한 번이고 비콘은 보행 내내 2~3초마다라 프로파일이 다르다. 기본 `.soloAmbient`는 타 앱
/// 오디오를 정지시켜 음악·팟캐스트를 들으며 걷는 사용자의 재생을 첫 tick에 끊고, 반대로
/// 그 세션에 TTS(`.playback`)를 썼다면 카테고리가 남아 무음 스위치를 무시한다.
/// 유일한 연속 피드백 채널의 동작이 "그 세션에 TTS를 썼는지"에 좌우되면 안 되므로
/// `.ambient` + `.mixWithOthers`를 명시 선언한다.
@MainActor
final class BeaconTonePlayer {
    /// 엔진이 죽었는데 되살리지 못한 상태. 호출부가 통지 대상으로 삼는다
    /// (조용한 무음은 금지 — hold·tick엔 통지가 없어 사용자가 침묵의 원인을 모른다).
    private(set) var isSilenced = false

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate = 44_100.0
    private var format: AVAudioFormat?
    private var observers: [NSObjectProtocol] = []

    init() {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            isSilenced = true
            return
        }
        self.format = format
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        observeInterruptions()
    }

    func play(_ tone: BeaconTone) {
        guard let format, let buffer = makeBuffer(for: tone, format: format) else { return }
        guard ensureRunning() else { return }
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    /// 정리는 여기서 한다(`deinit`은 nonisolated라 MainActor 상태에 접근할 수 없다).
    /// 멱등이므로 중지·화면 이탈 어디서 불러도 안전하다.
    func shutdown() {
        player.stop()
        engine.stop()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
    }

    // MARK: - 엔진 수명

    /// 세션 카테고리를 확정하고 엔진을 띄운다. 실패는 `isSilenced`로 노출한다.
    private func ensureRunning() -> Bool {
        if engine.isRunning { return true }
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
            isSilenced = false
            return true
        } catch {
            isSilenced = true
            return false
        }
    }

    /// 전화 한 통이나 다른 컴포넌트의 `setActive(false)`가 엔진을 멈추면 톤이 영영
    /// 사라진다. repo 전체에 인터럽션 처리가 없어 이 계층에서 처음 도입한다.
    private func observeInterruptions() {
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(), queue: .main
            ) { [weak self] note in
                guard
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    AVAudioSession.InterruptionType(rawValue: raw) == .ended
                else { return }
                MainActor.assumeIsolated { _ = self?.ensureRunning() }
            }
        )
        observers.append(
            center.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, let format = self.format else { return }
                    // 구성 변경 후에는 연결이 끊겨 있을 수 있어 다시 잇는다.
                    self.engine.connect(self.player, to: self.engine.mainMixerNode, format: format)
                    _ = self.ensureRunning()
                }
            }
        )
    }

    // MARK: - 합성

    /// 시퀀스 전체를 담는 버퍼 하나를 만들고 각 단계를 오프셋 위치에 사인파로 채운다.
    /// 단계마다 짧은 페이드를 넣어 클릭 노이즈를 없앤다.
    private func makeBuffer(for tone: BeaconTone, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let steps = toneSteps(for: tone)
        guard let last = steps.map({ $0.start + $0.dur }).max(), last > 0 else { return nil }

        let frameCount = AVAudioFrameCount(last * sampleRate)
        guard
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
            let channel = buffer.floatChannelData?[0]
        else { return nil }
        buffer.frameLength = frameCount
        for i in 0..<Int(frameCount) { channel[i] = 0 }

        let peak: Float = tone == .tick ? 0.06 : 0.18  // tick은 하트비트라 낮게(웹 동형)
        let fadeFrames = Int(0.005 * sampleRate)

        for step in steps {
            let startFrame = Int(step.start * sampleRate)
            let stepFrames = Int(step.dur * sampleRate)
            guard stepFrames > 0 else { continue }
            for i in 0..<stepFrames {
                let frame = startFrame + i
                guard frame < Int(frameCount) else { break }
                let envelope: Float =
                    if i < fadeFrames { Float(i) / Float(fadeFrames) }
                    else if i > stepFrames - fadeFrames { Float(stepFrames - i) / Float(fadeFrames) }
                    else { 1 }
                let phase = 2.0 * Double.pi * step.freq * (Double(i) / sampleRate)
                channel[frame] += peak * envelope * Float(sin(phase))
            }
        }
        return buffer
    }
}
