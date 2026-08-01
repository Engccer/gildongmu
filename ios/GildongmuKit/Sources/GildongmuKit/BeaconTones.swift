import Foundation

/// 거리 비콘 효과음의 톤 시퀀스(순수 데이터, 오디오 엔진 비의존).
///
/// **음높이 방향이 정보다**: 가까워짐 = 상승, 멀어짐 = 하강, 도착 = 밝은 더블,
/// tick = 낮은 단음("추적 중" 하트비트).
///
/// 추세·도착·tick 4종의 정본은 웹 `src/lib/beacon-tones.ts`이고, 드리프트는
/// `src/lib/__tests__/beacon-tones-drift.test.ts`가 이 파일을 직접 읽어 막는다.
///
/// ⚠ **시작·정지는 웹 값을 쓰지 않는다.** 웹은 받아쓰기용 `recording-tones.ts`의
/// `START_TONES`(660→990)·`STOP_TONES`(990→660)를 재사용하는데, 그 값이
/// `closer`·`farther`와 **주파수도 방향도 같다**. 웹에서는 비콘과 받아쓰기가 별개
/// 맥락이라 무해했지만 iOS는 둘을 한 기능 안에서 듣게 되므로 "추적 시작"과
/// "가까워지는 중"이 구분되지 않는다. 이 기능의 전제(음높이 방향 = 추세)가 무너지므로
/// 음 수(2음 대 3음)와 음역을 함께 갈라 둔다. iOS 받아쓰기는 시스템 사운드
/// (1113/1114)를 쓰므로 그쪽과도 충돌하지 않는다.
public enum BeaconTone: Sendable, Equatable, CaseIterable {
    case closer, farther, nearby, tick, start, stop
}

public struct ToneStep: Sendable, Equatable {
    public var freq: Double
    /// 시퀀스 시작 기준 오프셋(초).
    public var start: Double
    public var dur: Double

    public init(freq: Double, start: Double, dur: Double) {
        self.freq = freq
        self.start = start
        self.dur = dur
    }
}

public func toneSteps(for tone: BeaconTone) -> [ToneStep] {
    switch tone {
    case .closer:
        [ToneStep(freq: 660, start: 0, dur: 0.07), ToneStep(freq: 990, start: 0.08, dur: 0.09)]
    case .farther:
        [ToneStep(freq: 990, start: 0, dur: 0.07), ToneStep(freq: 660, start: 0.08, dur: 0.09)]
    case .nearby:
        [ToneStep(freq: 880, start: 0, dur: 0.08), ToneStep(freq: 1320, start: 0.1, dur: 0.14)]
    case .tick:
        [ToneStep(freq: 330, start: 0, dur: 0.05)]
    case .start:
        [
            ToneStep(freq: 523, start: 0, dur: 0.07),
            ToneStep(freq: 659, start: 0.08, dur: 0.07),
            ToneStep(freq: 784, start: 0.16, dur: 0.11),
        ]
    case .stop:
        [
            ToneStep(freq: 784, start: 0, dur: 0.07),
            ToneStep(freq: 659, start: 0.08, dur: 0.07),
            ToneStep(freq: 523, start: 0.16, dur: 0.11),
        ]
    }
}
