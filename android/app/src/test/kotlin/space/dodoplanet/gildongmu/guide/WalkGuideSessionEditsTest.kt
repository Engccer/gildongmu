package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.queryOf
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/**
 * 안내 중 변경(M4b spec 2026-09-27 §2, iOS `BeaconModel` 동형): 목적지 전환·경유지 추가/변경/삭제의 경로 재획득, 두 줄 사이 대안 프리뷰·채택·낡음 폴백.
 * 판정(경로 리듀서·신선도 게이트)은 :kit이 잠그고, 여기는 모델이 **무엇을 다시 조회하고 무엇을 말하고 무엇을 바꾸는가**를 잠근다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideSessionEditsTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val urls = mutableListOf<String>()
    private val newDest = BeaconDest(north(500.0).lat, lng0)

    /** 기본 400m 단일 스텝, 최단 줄(`variant=shortest`)은 250m, 경유지는 150m에서 갈리는 두 스텝. */
    private fun responder(shortest: String? = walkBriefingJson(listOf(TestStep("최단 직진", listOf(north(0.0), north(250.0)))), distanceMeters = 250, durationSeconds = 200)): (String) -> HttpResponse = { url ->
        urls += url
        when {
            url.contains("variant=shortest") -> HttpResponse(200, shortest ?: "{\"result\":null}")
            url.contains("via=") -> HttpResponse(200, walkBriefingJson(listOf(TestStep("직진A", listOf(north(0.0), north(150.0))), TestStep("직진B", listOf(north(150.0), north(400.0)))), distanceMeters = 400, durationSeconds = 400, waypointStepIndex = 1))
            else -> HttpResponse(200, walkBriefingJson(listOf(TestStep("직진C", listOf(north(0.0), north(400.0)))), distanceMeters = 400, durationSeconds = 400))
        }
    }

    private fun TestScope.startDetail(h: GuideTestHarness, waypoint: GuideWaypoint? = null) {
        h.model.requestStart(h.request.copy(waypoint = waypoint))
        settle()
        h.model.handleFix(h.fix(0.0)); settle()
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        // 첫 fix는 경로 조회 origin으로만 쓰인다 — 재조회·프리뷰 origin(최신 수용 fix)은 다음 fix부터 선다(실기기는 1초마다 온다).
        h.clock.now += 1; h.model.handleFix(h.fix(0.0)); settle()
    }

    private fun params(url: String): Map<String, String> = queryOf(url).split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }
    private fun lastWalkQuery(): Map<String, String> = params(urls.last())

    @Test fun `목적지 전환 — 즉시 확인 통지, 경로를 내려놓고 다음 fix에 새 목적지로 조회`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.speaker.spoken.clear()
        assertTrue(h.model.changeDestination(newDest, "천호역"))
        // 활성화 응답은 즉시·high(착지 낭독·억제에 잠식되지 않게).
        assertEquals(listOf("새 목적지 천호역. 경로를 조회하고 있습니다." to true), h.speaker.spoken)
        val ui = h.model.ui.value
        assertEquals("천호역", ui.destinationLabel)
        assertEquals(newDest, ui.dest)
        assertEquals(GuideMode.brief, ui.mode)
        assertNull(ui.remainingText)
        assertNull(ui.routeStepDescriptions)
        val before = urls.size
        h.clock.now += 1; h.model.handleFix(h.fix(5.0)); settle()
        assertEquals(before + 1, urls.size, "재획득 = 다음 수용 fix가 조회")
        assertNotEquals(params(urls.first())["dest"], lastWalkQuery()["dest"], urls.last())
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        assertTrue(h.speaker.texts.last().startsWith("천호역까지 도보 안내 시작"), h.speaker.texts.toString())
    }

    @Test fun `목적지 같은 좌표 재선택은 라벨만 — 재조회 없음`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        val before = urls.size
        h.speaker.spoken.clear()
        assertTrue(h.model.changeDestination(h.dest, "길동역 1번 출구"))
        assertEquals(listOf("새 목적지 길동역 1번 출구." to true), h.speaker.spoken)
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        assertEquals("길동역 1번 출구", h.model.ui.value.destinationLabel)
        h.clock.now += 1; h.model.handleFix(h.fix(5.0)); settle()
        assertEquals(before, urls.size)
    }

    @Test fun `세션이 없으면 변경은 false — 호출부는 폼도 건드리지 않는다`() = guideTest(dispatcher, responder()) { h ->
        assertFalse(h.model.changeDestination(newDest, "천호역"))
        assertFalse(h.model.setWaypoint(newDest, "천호역"))
        assertFalse(h.model.removeWaypoint())
        assertTrue(h.speaker.spoken.isEmpty())
    }

    @Test fun `재획득 대기 중 도착한 옛 경로 응답은 버린다`() = guideTest(dispatcher, responder()) { h ->
        h.model.requestStart(h.request)
        settle()
        h.model.handleFix(h.fix(0.0))          // 조회 잡이 떴지만 아직 돌지 않았다
        h.model.changeDestination(newDest, "천호역")
        settle()
        assertEquals(GuideMode.brief, h.model.ui.value.mode, "옛 목적지 조회가 새 목적지 세션에 커밋되지 않는다")
        assertNull(h.model.ui.value.routeStepDescriptions)
    }

    @Test fun `경유지 추가 → via로 재조회, 변경 라벨, 삭제 → via 없이 재조회`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        val via = BeaconDest(north(150.0).lat, lng0)
        h.speaker.spoken.clear()
        assertTrue(h.model.setWaypoint(via, "장미공원"))
        assertEquals(listOf("경유지 장미공원, 경로를 다시 조회합니다" to true), h.speaker.spoken)
        assertEquals("장미공원", h.model.ui.value.waypointLabel)
        h.clock.now += 1; h.model.handleFix(h.fix(2.0)); settle()
        assertTrue(lastWalkQuery().containsKey("via"), urls.last())
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        assertTrue(h.model.ui.value.remainingText!!.startsWith("경유지 장미공원까지"), h.model.ui.value.remainingText)

        h.speaker.spoken.clear()
        assertTrue(h.model.removeWaypoint())
        assertEquals(listOf("경유지 장미공원 삭제, 경로를 다시 조회합니다" to true), h.speaker.spoken)
        assertNull(h.model.ui.value.waypointLabel)
        h.clock.now += 1; h.model.handleFix(h.fix(4.0)); settle()
        assertFalse(lastWalkQuery().containsKey("via"), urls.last())
        assertTrue(h.model.ui.value.remainingText!!.startsWith("남은 거리"), h.model.ui.value.remainingText)
    }

    @Test fun `같은 경유지 재선택은 "그대로" — 재조회 없음`() = guideTest(dispatcher, responder()) { h ->
        val via = GuideWaypoint(BeaconDest(north(150.0).lat, lng0), "장미공원")
        startDetail(h, via)
        val before = urls.size
        h.speaker.spoken.clear()
        assertTrue(h.model.setWaypoint(via.dest, "장미 공원"))
        assertEquals(listOf("경유지 장미 공원 그대로입니다" to true), h.speaker.spoken)
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        assertEquals(before, urls.size)
    }

    @Test fun `목적지 전환은 경유지를 지난 세션 표식을 지운다 — 새 여정의 행은 "남은 거리"`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h, GuideWaypoint(BeaconDest(north(150.0).lat, lng0), "장미공원"))
        // 경유지 도착선(150m)까지 걷는다.
        var d = 8.0
        while (h.model.ui.value.waypointLabel != null && d <= 200.0) {
            h.clock.now += 8.0; h.model.handleFix(h.fix(d)); advanceTimeBy(8_000); runCurrent(); d += 8.0
        }
        assertNull(h.model.ui.value.waypointLabel, "경유지 도착")
        h.model.changeDestination(newDest, "천호역")
        h.clock.now += 1; h.model.handleFix(h.fix(d)); settle()
        assertTrue(h.model.ui.value.remainingText!!.startsWith("남은 거리"), h.model.ui.value.remainingText)
    }

    // ── 대안 프리뷰·채택 ──

    @Test fun `대안 프리뷰 — 노출 술어·조회 중·준비 헤더와 완료 통지`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        assertTrue(h.model.ui.value.alternativePreviewAvailable)
        h.speaker.spoken.clear()
        h.model.openAlternativePreview()
        assertTrue(h.model.ui.value.altPreviewOpen)
        assertEquals("대안 경로 조회 중", h.model.altPreviewHeaderText())
        settle()
        assertTrue(h.model.ui.value.altPreviewReady)
        assertEquals(listOf("최단 직진"), h.model.ui.value.altPreviewSteps)
        assertEquals("shortest", lastWalkQuery()["variant"])
        val header = h.model.altPreviewHeaderText()
        assertEquals("최단 경로, 총 250m, 도보 약 3분, 지금 경로 잔여 400m", header)
        assertEquals(listOf(spokenDistanceUnits(header, "미터") to false), h.speaker.spoken, "결과 도착 polite 1회")
    }

    @Test fun `대안 없음과 조회 실패를 가른다`() = guideTest(dispatcher, responder(shortest = null)) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        assertFalse(h.model.ui.value.altPreviewReady)
        assertEquals("대안 경로가 없습니다", h.model.altPreviewHeaderText())
    }

    @Test fun `다른 줄이 없는 세션엔 대안 보기가 없다`() = guideTest(dispatcher, responder()) { h ->
        h.model.requestStart(h.request.copy(alternate = null)); settle()
        h.model.handleFix(h.fix(0.0)); settle()
        h.clock.now += 1; h.model.handleFix(h.fix(0.0)); settle()
        assertFalse(h.model.ui.value.alternativePreviewAvailable)
        h.model.openAlternativePreview(); settle()
        assertFalse(h.model.ui.value.altPreviewOpen)
    }

    @Test fun `프리뷰를 닫은 뒤 도착한 응답은 버린다`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview()
        h.model.closeAlternativePreview()
        settle()
        assertFalse(h.model.ui.value.altPreviewOpen)
        assertFalse(h.model.ui.value.altPreviewReady)
    }

    @Test fun `신선한 채택 — 왕복 없이 본 경로로, 줄이 맞바뀌고 다음 프리뷰는 반대 줄`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        val before = urls.size
        h.speaker.spoken.clear()
        h.model.adoptAlternativePreview()
        assertEquals(before, urls.size, "본 것 = 안내받는 것(재조회 없음)")
        assertEquals(1, h.model.ui.value.variantAdoptedSeq)
        assertEquals(listOf("최단 직진"), h.model.ui.value.routeStepDescriptions)
        assertFalse(h.model.ui.value.altPreviewOpen, "경로 교체가 프리뷰를 무효화")
        settle()
        assertTrue(h.speaker.spoken.single().first.startsWith("최단 경로로 전환했습니다"), h.speaker.texts.toString())
        assertTrue(h.speaker.spoken.single().second)
        assertEquals(listOf(ResultHapticKind.success), h.haptics.fired.takeLast(1))
        // 줄이 맞바뀌었다 — 다음 프리뷰는 큰길(기본 파이프라인)을 조회한다.
        h.model.openAlternativePreview(); settle()
        assertNull(lastWalkQuery()["variant"])
        assertEquals("큰길 경로, 총 400m, 도보 약 6분, 지금 경로 잔여 250m", h.model.altPreviewHeaderText())
    }

    @Test fun `채택 뒤 복구 재시작은 전환된 줄로 시작한다`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        h.model.adoptAlternativePreview(); settle()
        h.model.stop()
        h.model.restart(); settle()
        h.model.handleFix(h.fix(0.0)); settle()
        assertEquals("shortest", lastWalkQuery()["variant"], "A13 — 고른 경로가 조용히 바뀌지 않는다")
    }

    @Test fun `낡은 채택은 같은 줄로 현위치 재조회에 폴백 — 진행 표식, 성공하면 채택 세대`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        // 취득 뒤 120초가 지났다(최근 fix는 신선) — 제안 신선도 미달.
        repeat(13) { h.clock.now += 10.0; h.model.handleFix(h.fix(0.0)); advanceTimeBy(10_000); runCurrent() }
        val before = urls.size
        h.model.adoptAlternativePreview()
        assertTrue(h.model.ui.value.isSwitchingVariant)
        assertEquals(0, h.model.ui.value.variantAdoptedSeq)
        settle()
        assertEquals(before + 1, urls.size)
        assertEquals("shortest", lastWalkQuery()["variant"])
        assertFalse(h.model.ui.value.isSwitchingVariant)
        assertEquals(1, h.model.ui.value.variantAdoptedSeq)
        assertTrue(h.speaker.texts.last().startsWith("최단 경로로 전환했습니다"), h.speaker.texts.toString())
    }

    @Test fun `경로 재획득이 프리뷰를 닫는다`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        assertTrue(h.model.ui.value.altPreviewReady)
        h.model.changeDestination(newDest, "천호역")
        assertFalse(h.model.ui.value.altPreviewOpen)
        assertFalse(h.model.ui.value.alternativePreviewAvailable, "경로가 없는 동안(간략)은 대안 보기가 없다")
    }

    @Test fun `시작 요청은 다른 줄을 기본값 없이 싣는다 — 경유지 변경 뒤 복구 재시작도 새 경유지로`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.setWaypoint(BeaconDest(north(150.0).lat, lng0), "장미공원")
        h.model.stop()
        h.model.restart(); settle()
        h.model.handleFix(h.fix(0.0)); settle()
        assertTrue(lastWalkQuery().containsKey("via"), urls.last())
        assertEquals(WalkLineKind.broad, h.model.ui.value.lastStartLine)
    }

    @Test fun `최종 접근 진입이 프리뷰를 비운다 — 문 앞 전환은 최종 접근을 풀므로`() = guideTest(dispatcher, responder()) { h ->
        startDetail(h)
        h.model.openAlternativePreview(); settle()
        assertTrue(h.model.ui.value.altPreviewReady)
        var d = 8.0
        while (h.model.ui.value.altPreviewOpen && d <= 420.0) { h.clock.now += 8.0; h.model.handleFix(h.fix(d)); advanceTimeBy(8_000); runCurrent(); d += 8.0 }
        assertFalse(h.model.ui.value.altPreviewOpen, "경로 끝 접근(최종 접근·간략 인계)이 프리뷰를 비웠다")
        assertTrue(d > 300.0, "경로 끝 근처에서야 비워졌다: $d")
    }
}
