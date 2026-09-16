package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 톤 뒤 발화 판정 경계 표(spec 2026-08-14 §3·§8) — Kit `GuideSpeechGateTests`·웹 `guide-speech-gate.test.ts` 미러.
 * 재생 직후의 remaining은 곧 톤 전체 길이라, 실측 길이가 그대로 경계 케이스다.
 *
 * 기대값은 상수 자신이 아니라 **리터럴**로 적는다 — 웹 드리프트 가드는 Swift 파일만 읽으므로, 상수로 계산하면 Kotlin
 * 쪽 값이 바뀌어도 이 스위트가 초록으로 남는다.
 */
class GuideSpeechGateTest {
    @Test fun `상수는 웹·Swift와 같은 값이다`() {
        assertEquals(0.6, SpeechDeferConstants.speechDeferThresholdSeconds)
        assertEquals(0.15, SpeechDeferConstants.speechDeferGapSeconds)
        assertEquals(3.0, SpeechDeferConstants.speechDeferMaxSeconds)
    }

    @Test fun `짧은 톤은 즉시 — closer·farther 0점235, unreliable 0점470, tick 0점522`() {
        for (length in listOf(0.235, 0.470, 0.522)) assertEquals(0.0, speechDeferStep(0.0, length), "$length")
    }

    @Test fun `긴 톤은 지연 — ahead 0점731, warning 0점836, start·stop 1점332, nearby 2점246`() {
        for (length in listOf(0.731, 0.836, 1.332, 2.246)) {
            assertEquals(length + 0.15, speechDeferStep(0.0, length), "$length")
        }
    }

    @Test fun `잔여가 임계와 같으면 지연한다`() {
        assertEquals(0.6 + 0.15, speechDeferStep(0.0, 0.6))
    }

    @Test fun `이미 끝난 톤은 즉시`() {
        assertEquals(0.0, speechDeferStep(10.0, 9.0))
    }

    @Test fun `상한은 clamp이지 무효화가 아니다`() {
        for (length in listOf(2.9, 3.5, 100.0)) assertEquals(3.0, speechDeferStep(0.0, length), "$length")
    }

    @Test fun `비유한 값은 두 인자 모두 검사한다`() {
        assertEquals(0.0, speechDeferStep(0.0, null))
        assertEquals(0.0, speechDeferStep(0.0, Double.NaN))
        assertEquals(0.0, speechDeferStep(0.0, Double.POSITIVE_INFINITY))
        assertEquals(0.0, speechDeferStep(0.0, Double.NEGATIVE_INFINITY))
        assertEquals(0.0, speechDeferStep(Double.NaN, 1.0))
        assertEquals(0.0, speechDeferStep(Double.POSITIVE_INFINITY, 1.0))
    }
}
