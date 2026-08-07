import Testing

@testable import GildongmuKit

@Suite("3-state 정지 판정")
struct GuideMotionTests {
    private func sample(_ at: Double, lat: Double = 37.5, lng: Double = 127.0, acc: Double = 10)
        -> MotionSample {
        MotionSample(lat: lat, lng: lng, accuracy: acc, at: at)
    }

    // MARK: 도플러 신뢰 조건

    @Test("도플러 속도가 신뢰 조건을 만족하면 그 값을 쓴다")
    func dopplerAccepted() {
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: 1.5, speedAccuracy: 0.5, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }

    @Test("speedAccuracy가 상한을 넘으면 그 speed는 근거가 못 된다")
    func speedAccuracyCeiling() {
        // speed 0.2는 정지처럼 보이지만 정확도가 나쁘면 판정 근거가 아니다.
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: 0.2, speedAccuracy: 5, maxSpeedMps: 8
        )
        #expect(motion == .speedUnknown)
    }

    @Test("음수 speed는 무효 신호다")
    func negativeSpeed() {
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: -1, speedAccuracy: 0.5, maxSpeedMps: 8
        )
        #expect(motion == .speedUnknown)
    }

    @Test("speedAccuracy가 없으면 도플러를 채택하지 않는다(웹 계약 동조)")
    func missingSpeedAccuracy() {
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: 1.5, speedAccuracy: nil, maxSpeedMps: 8
        )
        #expect(motion == .speedUnknown)
    }

    // MARK: 히스테리시스

    @Test("정지 진입은 유지 시간을 채워야 성립한다")
    func stopEnterRequiresHold() {
        var state = MotionJudgeState.initial
        var out = motionStep(
            state: state, sample: sample(0), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        state = out.state
        #expect(out.motion == .moving)  // 아직 2초를 못 채웠다

        out = motionStep(
            state: state, sample: sample(1.5), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        state = out.state
        #expect(out.motion == .moving)

        out = motionStep(
            state: state, sample: sample(2.1), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(out.motion == .stopped)
    }

    @Test("이탈은 즉시다(비대칭이 의도)")
    func stopExitImmediate() {
        var state = MotionJudgeState.initial
        for t in [0.0, 2.5] {
            state = motionStep(
                state: state, sample: sample(t), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
            ).state
        }
        let (_, motion) = motionStep(
            state: state, sample: sample(3.0), speed: 0.7, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }

    @Test("히스테리시스 구간(0.4~0.6)에서는 정지를 유지한다")
    func hysteresisBand() {
        var state = MotionJudgeState.initial
        for t in [0.0, 2.5] {
            state = motionStep(
                state: state, sample: sample(t), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
            ).state
        }
        // 0.5는 진입선(0.4)보다 크고 이탈선(0.6)보다 작다.
        let (_, motion) = motionStep(
            state: state, sample: sample(3.0), speed: 0.5, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .stopped)
    }

    @Test("느린 보행(0.7m/s)은 정지가 아니다")
    func slowWalkIsMoving() {
        var state = MotionJudgeState.initial
        for t in [0.0, 1.0, 2.0, 3.0, 4.0] {
            let out = motionStep(
                state: state, sample: sample(t), speed: 0.7, speedAccuracy: 0.3, maxSpeedMps: 8
            )
            state = out.state
            #expect(out.motion == .moving)
        }
    }

    // MARK: 거리 미분 폴백

    @Test("도플러가 없으면 거리 미분 폴백을 쓴다")
    func distanceFallback() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0, lat: 37.5), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        ).state
        // 약 22m를 2초 = 11m/s → 물리 상한(8) 초과라 폐기.
        let tooFast = motionStep(
            state: state, sample: sample(2, lat: 37.5002), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        )
        #expect(tooFast.motion == .speedUnknown)

        // 약 2.2m를 2초 = 1.1m/s → 유효.
        let ok = motionStep(
            state: state, sample: sample(2, lat: 37.50002), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        )
        #expect(ok.motion == .moving)
    }

    @Test("폴백은 간격이 너무 짧거나 길면 쓰지 않는다")
    func fallbackIntervalBounds() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        ).state
        // 0.5초: GPS 지터가 속도로 증폭된다.
        #expect(
            motionStep(
                state: state, sample: sample(0.5, lat: 37.50002), speed: nil, speedAccuracy: nil,
                maxSpeedMps: 8
            ).motion == .speedUnknown
        )
        // 7초: 실제 이동이 평균화되어 정지로 보인다.
        #expect(
            motionStep(
                state: state, sample: sample(7, lat: 37.50002), speed: nil, speedAccuracy: nil,
                maxSpeedMps: 8
            ).motion == .speedUnknown
        )
    }

    @Test("폴백은 두 fix 정확도가 20m를 넘으면 쓰지 않는다")
    func fallbackAccuracyBound() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0, acc: 35), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        ).state
        #expect(
            motionStep(
                state: state, sample: sample(2, lat: 37.50002, acc: 10), speed: nil,
                speedAccuracy: nil, maxSpeedMps: 8
            ).motion == .speedUnknown
        )
    }

    @Test("폴백으로도 정지를 판정할 수 있다")
    func fallbackDetectsStop() {
        var state = MotionJudgeState.initial
        // 제자리(좌표 불변)로 1초 간격 fix 4개.
        for t in [0.0, 1.0, 2.0, 3.0] {
            state = motionStep(
                state: state, sample: sample(t), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
            ).state
        }
        let (_, motion) = motionStep(
            state: state, sample: sample(4.0), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        )
        #expect(motion == .stopped)
    }

    @Test("속도를 모르면 정지 계측이 초기화된다")
    func unknownResetsStopTimer() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        ).state
        // 모르는 구간을 정지로 셈하면 그 사이 이동이 정지로 굳는다.
        // 이 fix는 도플러 무효 + 폴백 간격 미달(0.5초)이라 speedUnknown이다.
        state = motionStep(
            state: state, sample: sample(0.5), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        ).state
        let (_, motion) = motionStep(
            state: state, sample: sample(2.5), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }
}
