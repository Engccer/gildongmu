package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.QuickExitDoor
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 빠른하차 문장(E5) — 웹 `quick-exit-text.test.ts`·Kit `QuickExitTextTests`와 같은 케이스를 본다.
 * 문구가 갈리면 같은 하차역이 웹·CLI·앱에서 다르게 낭독된다. Kit의 `QuickExitGuideRouteTests`
 * (`buildTransitGuideRoute`)는 GUIDE `TransitGuide` 몫이다(core.json 참조).
 */
class QuickExitTextTest {
    private val elevator = QuickExitDoor(kind = "door", doors = listOf("6-4"))
    private val stairs = QuickExitDoor(kind = "door", doors = listOf("5-4"))
    private val between = QuickExitDoor(kind = "between", doors = listOf("3-2", "3-3"))

    @Test fun `둘 다`() {
        assertEquals("여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문", quickExitText(QuickExit(elevator = elevator, stairs = stairs), "여의도", "ko"))
    }

    @Test fun `환승 leg는 빠른환승 문 하나만`() {
        val transfer = QuickExitDoor(kind = "door", doors = listOf("5-2"))
        assertEquals("사당 하차, 빠른 환승 5-2 문", quickExitText(QuickExit(transfer = transfer), "사당", "ko"))
        assertEquals("Get off at Sadang, quick transfer at door 5-2", quickExitText(QuickExit(transfer = transfer), "Sadang", "en"))
        // 배타 계약의 소비자 측: 섞여 와도 환승 문장만.
        assertEquals("사당 하차, 빠른 환승 5-2 문", quickExitText(QuickExit(transfer = transfer, elevator = elevator, stairs = stairs), "사당", "ko"))
    }

    /** 서버가 실은 값이 선언 누락으로 조용히 떨어지지 않는지 — 디코딩부터 문장까지. */
    @Test fun `transfer 디코딩 계약`() {
        val decoded = KitJson.decodeFromString(QuickExit.serializer(), """{"transfer":{"kind":"door","doors":["5-2"]}}""")
        assertEquals(listOf("5-2"), decoded.transfer?.doors)
        assertEquals("사당 하차, 빠른 환승 5-2 문", quickExitText(decoded, "사당", "ko"))
    }

    @Test fun `엘리베이터만`() {
        assertEquals("연신내 하차, 엘리베이터 6-4 문", quickExitText(QuickExit(elevator = elevator), "연신내", "ko"))
    }

    @Test fun `계단만`() {
        assertEquals("장암 하차, 계단 5-4 문", quickExitText(QuickExit(stairs = stairs), "장암", "ko"))
    }

    /** 문 번호 자리에 원문을 넣으면 "엘리베이터 3-2,3-3 사이 문"이 된다. */
    @Test fun `문 사이는 별도 조각`() {
        assertEquals("군자 하차, 엘리베이터 3-2 문과 3-3 문 사이", quickExitText(QuickExit(elevator = between), "군자", "ko"))
    }

    @Test fun `값이 없으면 문구를 만들지 않는다`() {
        assertNull(quickExitText(null, "여의도", "ko"))
        assertNull(quickExitText(QuickExit(), "여의도", "ko"))
        assertNull(quickExitText(QuickExit(elevator = elevator), "", "ko"))
    }

    @Test fun `빈 doors는 그 시설을 없는 것으로 본다`() {
        val empty = QuickExitDoor(kind = "door", doors = emptyList())
        assertNull(quickExitText(QuickExit(elevator = empty), "여의도", "ko"))
        assertEquals("여의도 하차, 계단 5-4 문", quickExitText(QuickExit(elevator = empty, stairs = stairs), "여의도", "ko"))
    }

    @Test fun `between인데 문이 하나면 단일 형태로 떨어진다`() {
        val broken = QuickExitDoor(kind = "between", doors = listOf("6-4"))
        assertEquals("여의도 하차, 엘리베이터 6-4 문", quickExitText(QuickExit(elevator = broken), "여의도", "ko"))
    }

    /** 위치 인자가 뒤섞이면 컴파일은 통과하고 낭독만 깨진다 — 로케일별로 잠근다. */
    @Test fun `로케일별 실문장`() {
        val value = QuickExit(elevator = elevator, stairs = QuickExitDoor(kind = "between", doors = listOf("5-3", "5-4")))
        assertEquals("Get off at Yeouido, elevator at door 6-4, stairs between doors 5-3 and 5-4", quickExitText(value, "Yeouido", "en"))
        assertEquals("汝矣島で下車、エレベーターは6-4のドア、階段は5-3と5-4のドアの間", quickExitText(value, "汝矣島", "ja"))
    }

    @Test fun `미지원 로케일은 ko로 떨어진다`() {
        assertEquals("여의도 하차, 엘리베이터 6-4 문", quickExitText(QuickExit(elevator = elevator), "여의도", "de"))
    }

    /** 서버가 실었는데 앱만 침묵하는 조용한 결함을 막는다 — 디코딩부터 문장까지 한 번에. */
    @Test fun `응답 디코딩부터 문장까지`() {
        val json = """{"mode":"subway","lineName":"수도권 5호선","fromName":"천호","toName":"여의도","stationCount":8,"minutes":24,
            "quickExit":{"elevator":{"kind":"door","doors":["6-4"]},"stairs":{"kind":"door","doors":["5-4"]}}}"""
        val leg = KitJson.decodeFromString(TransitRouteLeg.serializer(), json)
        assertEquals("여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문", quickExitText(leg.quickExit, leg.toName ?: "", "ko"))
    }

    @Test fun `quickExit 없는 응답도 디코딩된다`() {
        val json = """{"mode":"subway","lineName":"수도권 5호선","fromName":"천호","toName":"여의도","stationCount":8,"minutes":24}"""
        val leg = KitJson.decodeFromString(TransitRouteLeg.serializer(), json)
        assertNull(leg.quickExit)
        assertNull(quickExitText(leg.quickExit, leg.toName ?: "", "ko"))
    }
}
