package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** 듣기 속도 순수 규칙 — Kit `ListenSpeedTests` 미러. */
class ListenSpeedTest {
    @Test fun `허용값은 그대로 통과`() {
        assertEquals(1.0, ListenSpeed.normalizeSpeed(1.0))
        assertEquals(1.5, ListenSpeed.normalizeSpeed(1.5))
        assertEquals(2.0, ListenSpeed.normalizeSpeed(2.0))
    }

    @Test fun `미설정과 이상값은 1로 정규화`() {
        for (v in listOf(null, 0.0, 3.0, 1.25, -1.0)) assertEquals(1.0, ListenSpeed.normalizeSpeed(v), "$v")
    }

    /** 1배 앵커(0.55)는 위원장이 "듣기 좋다" 확정한 불변값이다. */
    @Test fun `기본 배율은 고정 앵커와 일치`() {
        assertEquals(ListenSpeed.baseSpeechRate, ListenSpeed.speechRate(1.0))
        assertEquals(0.55f, ListenSpeed.speechRate(1.0))
    }

    /** 1.5배·2배는 곱셈이 아니라 실측 캘리브레이션 표 값이다 — 곱셈 재도입 시 깨진다. */
    @Test fun `캘리브레이션 표이지 선형 곱셈이 아니다`() {
        assertEquals(0.65f, ListenSpeed.speechRate(1.5))
        assertEquals(0.75f, ListenSpeed.speechRate(2.0))
        assertNotEquals(ListenSpeed.baseSpeechRate * 1.5f, ListenSpeed.speechRate(1.5))
        assertNotEquals(minOf(ListenSpeed.baseSpeechRate * 2, 1.0f), ListenSpeed.speechRate(2.0))
    }

    /** 세 값이 서로 구분되고 상한(AVSpeech 최대 rate 1.0) 안이어야 한다. */
    @Test fun `세 배율 값은 상호 구분되고 상한 이내`() {
        val rate1 = ListenSpeed.speechRate(1.0)
        val rate15 = ListenSpeed.speechRate(1.5)
        val rate2 = ListenSpeed.speechRate(2.0)
        assertTrue(rate1 < rate15)
        assertTrue(rate15 < rate2)
        assertTrue(rate2 <= 1.0f)
    }

    @Test fun `미지 배율은 앵커로 낙착`() {
        assertEquals(ListenSpeed.baseSpeechRate, ListenSpeed.speechRate(3.0))
    }
}
