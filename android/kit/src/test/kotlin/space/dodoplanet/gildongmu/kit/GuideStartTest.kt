package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Kit `RouteStartChatTests.swift`의 `GuideStartPredicateTests` 미러. */
class GuideStartTest {
    @Test fun `자동차 안내는 한국어 데이터와 tmap 경로일 때만 시작할 수 있다`() {
        assertTrue(canStartCarGuide(dataLocale = "ko", provider = "tmap"))
        assertFalse(canStartCarGuide(dataLocale = "en", provider = "tmap"))
        assertFalse(canStartCarGuide(dataLocale = "ko", provider = "kakao"))
        assertFalse(canStartCarGuide(dataLocale = "ko", provider = null))
    }

    @Test fun `도보 기본 줄은 조회 화면의 첫 줄이다`() {
        assertEquals(WalkLineKind.shortest, WalkLineKind.firstLine(dataLocale = "ko"))
        assertEquals(WalkLineKind.recommended, WalkLineKind.firstLine(dataLocale = "en"))
        assertEquals(WalkLineKind.shortest, WalkLineKind.startLine(accessible = false, dataLocale = "ko"))
        assertEquals(WalkLineKind.recommended, WalkLineKind.startLine(accessible = false, dataLocale = "en"))
    }

    @Test fun `계단 회피를 청하면 언어와 무관하게 그 줄이다`() {
        assertEquals(WalkLineKind.accessible, WalkLineKind.startLine(accessible = true, dataLocale = "ko"))
        assertEquals(WalkLineKind.accessible, WalkLineKind.startLine(accessible = true, dataLocale = "en"))
        assertTrue(WalkLineKind.accessible.isAccessible && WalkLineKind.accessible.variant == null)
        assertTrue(!WalkLineKind.shortest.isAccessible && WalkLineKind.shortest.variant == WalkRouteVariant.shortest)
        assertTrue(!WalkLineKind.recommended.isAccessible)
        assertNull(WalkLineKind.recommended.variant)
    }
}
