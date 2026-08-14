import Testing

@testable import GildongmuKit

/// 톤 뒤 발화 판정 경계 표(spec 2026-08-14 §3·§8) — 웹 `guide-speech-gate.test.ts` 미러.
/// 재생 직후의 remaining은 곧 톤 전체 길이라, 실측 길이(afinfo)가 그대로 경계 케이스다.
struct GuideSpeechGateTests {
    // 즉시(짧은 톤): closer/farther 0.235 · unreliable 0.470 · tick 0.522
    @Test(arguments: [0.235, 0.470, 0.522])
    func shortTonesImmediate(length: Double) {
        #expect(speechDeferStep(now: 0, toneEndsAt: length) == 0)
    }

    // 지연(긴 톤): ahead 0.731 · warning 0.836 · start/stop 1.332 · nearby 2.246
    @Test(arguments: [0.731, 0.836, 1.332, 2.246])
    func longTonesDeferred(length: Double) {
        #expect(
            speechDeferStep(now: 0, toneEndsAt: length)
                == length + SpeechDeferConstants.speechDeferGapSeconds)
    }

    @Test func boundaryRemainingEqualsThresholdDefers() {
        let threshold = SpeechDeferConstants.speechDeferThresholdSeconds
        #expect(
            speechDeferStep(now: 0, toneEndsAt: threshold)
                == threshold + SpeechDeferConstants.speechDeferGapSeconds)
    }

    @Test func pastToneImmediate() {
        #expect(speechDeferStep(now: 10, toneEndsAt: 9) == 0)
    }

    // 상한은 clamp이지 무효화가 아니다(리뷰 MINOR 1).
    @Test(arguments: [2.9, 3.5, 100.0])
    func capClampsNotVoids(length: Double) {
        #expect(
            speechDeferStep(now: 0, toneEndsAt: length)
                == SpeechDeferConstants.speechDeferMaxSeconds)
    }

    // 비유한 값은 両인자 모두 검사(리뷰 MINOR 2 — NaN은 나노초 정수 변환에서 trap).
    @Test func nonFiniteInputsImmediate() {
        #expect(speechDeferStep(now: 0, toneEndsAt: nil) == 0)
        #expect(speechDeferStep(now: 0, toneEndsAt: .nan) == 0)
        #expect(speechDeferStep(now: 0, toneEndsAt: .infinity) == 0)
        #expect(speechDeferStep(now: 0, toneEndsAt: -.infinity) == 0)
        #expect(speechDeferStep(now: .nan, toneEndsAt: 1) == 0)
        #expect(speechDeferStep(now: .infinity, toneEndsAt: 1) == 0)
    }
}
