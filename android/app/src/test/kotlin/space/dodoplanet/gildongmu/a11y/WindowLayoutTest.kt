package space.dodoplanet.gildongmu.a11y

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 두 칸 배치를 켜는 창 크기 기준(E91·B30, spec 2026-11-23 §2.1). */
class WindowLayoutTest {
    @Test
    fun `한소네 7 가로 화면은 넓고 낮은 창이다`() {
        assertTrue(isWideLowWindow(1024f, 576f))
    }

    @Test
    fun `가로로 눕힌 폰은 넓고 낮은 창이다`() {
        assertTrue(isWideLowWindow(891f, 411f))
        assertTrue(isWideLowWindow(800f, 360f))
    }

    @Test
    fun `세로로 든 폰은 아니다`() {
        assertFalse(isWideLowWindow(411f, 891f))
        assertFalse(isWideLowWindow(360f, 800f))
    }

    @Test
    fun `가로가 600dp에 못 미치면 눕혀도 아니다`() {
        assertFalse(isWideLowWindow(568f, 320f))
    }

    @Test
    fun `세로로 세운 태블릿은 넓어도 아니다`() {
        assertFalse(isWideLowWindow(800f, 1280f))
    }
}
