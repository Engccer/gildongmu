package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.guide.ui.TransitRecoveryControls
import space.dodoplanet.gildongmu.guide.ui.toGuideHaptic
import space.dodoplanet.gildongmu.guide.ui.transitRecoveryControls
import space.dodoplanet.gildongmu.guide.ui.transitRecoverySearchAccepts
import space.dodoplanet.gildongmu.guide.ui.transitSurroundingsAnchorKey
import space.dodoplanet.gildongmu.guide.ui.transitSurroundingsHeading
import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.TransitSurroundingsAnchor
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 대중교통 시트 5-D(잘못 내림 복구·목적지 전환·주변 확인) — 순수 판정은 JVM으로, 배선·표식은 소스 가드로. 모델을 지나는 흐름은 `TransitGuideRouteChangeTest`에 있다. */
class TransitSheetRecoveryTest {
    private val strings = CatalogStrings("ko")
    private val ui = TransitGuideUiState()

    @Test fun `복구가 열리지 않았으면 복구 영역이 없다`() {
        assertNull(transitRecoveryControls(ui, recoveryOffered = false, walkAvailable = true))
    }

    @Test fun `복구 버튼 집합 — 시작, 역 고르기, 실패의 다시 시도, 경로 없음의 걷기`() {
        assertEquals(TransitRecoveryControls(picking = false, start = true, retry = false, walk = false), transitRecoveryControls(ui, true, walkAvailable = true))
        val picking = ui.copy(pendingRecovery = PendingRecovery(token = 1, routeGen = 0, phase = PendingRecovery.Phase.pickStation))
        assertEquals(TransitRecoveryControls(picking = true, start = false, retry = false, walk = false), transitRecoveryControls(picking, true, walkAvailable = true))
        for (o in listOf(RecoveryOutcome.noLocation, RecoveryOutcome.fetchFailed)) {
            assertEquals(TransitRecoveryControls(picking = false, start = true, retry = true, walk = false), transitRecoveryControls(ui.copy(recoveryOutcome = o), true, walkAvailable = true), "$o")
        }
        for (o in listOf(RecoveryOutcome.noRoute, RecoveryOutcome.noGuidable)) {
            assertEquals(TransitRecoveryControls(picking = false, start = true, retry = false, walk = true), transitRecoveryControls(ui.copy(recoveryOutcome = o), true, walkAvailable = true), "$o")
            assertFalse(transitRecoveryControls(ui.copy(recoveryOutcome = o), true, walkAvailable = false)!!.walk, "목적지가 없으면 걷기 없음")
        }
    }

    @Test fun `주변 확인 헤더는 앵커 종류가 가르고 앵커 키는 좌표다`() {
        val cur = TransitSurroundingsAnchor.CurrentStation(TransitLegStop(name = "천호", lat = 37.5, lng = 127.1))
        val alight = TransitSurroundingsAnchor.AlightStop(TransitLegStop(name = "여의도", lat = 37.52, lng = 126.92))
        assertEquals("transitGuide.surroundingsAnchorCurrent" to "천호", transitSurroundingsHeading(cur))
        assertEquals("transitGuide.surroundingsAnchorAlight" to "여의도", transitSurroundingsHeading(alight))
        assertEquals("현재역 천호 주변", strings.get("transitGuide.surroundingsAnchorCurrent", "천호"))
        assertEquals("내릴 곳 여의도 주변", strings.get("transitGuide.surroundingsAnchorAlight", "여의도"))
        assertNotEquals(transitSurroundingsAnchorKey(cur), transitSurroundingsAnchorKey(alight), "앵커가 바뀌면 지난 역 장면을 버린다")
    }

    @Test fun `복구 역 검색은 지하철역만 받는다`() {
        assertTrue(transitRecoverySearchAccepts(StationLayoutKind.subway))
        assertFalse(transitRecoverySearchAccepts(StationLayoutKind.rail))
        assertFalse(transitRecoverySearchAccepts(null), "종류를 모르는 선택(최근·주소·현재 위치)은 받지 않는다")
    }

    @Test fun `진동 종류 변환`() {
        assertEquals(ResultHapticKind.success, HapticKind.success.toGuideHaptic())
        assertEquals(ResultHapticKind.attention, HapticKind.attention.toGuideHaptic())
        assertEquals(ResultHapticKind.failure, HapticKind.failure.toGuideHaptic())
    }

    private val guideUi = File("src/main/kotlin/space/dodoplanet/gildongmu/guide/ui")
    private val sheet = guideUi.resolve("TransitGuideSheet.kt").readText()
    private val rows = guideUi.resolve("TransitSheetRows.kt").readText()

    @Test fun `시트 배선 — 복구 페이지, 첫 후보 착지, 후보 확정, 주변 확인`() {
        assertTrue(sheet.contains("TransitRecoverySearchPage("))
        assertTrue(sheet.contains("c.model.commitDestinationChange(entry.route)"))
        assertTrue(sheet.contains("GuideFormSync.post(DirectionsEndpoint.Place("))
        assertTrue(sheet.contains("c.model.cancelDestinationChange()"))
        assertTrue(sheet.contains("landFirstDestChangeRouteFocus("))
        assertTrue(sheet.contains("GuideSession.sceneLookup(GuideSession.SceneSlot.tracking"))
        assertTrue(sheet.contains("transitRecoverySearchAccepts(kind)"))
        assertTrue(sheet.contains("GuideSession.transit.recoverFrom(place.lat, place.lng)"))
        // 복구 취소는 이월이 없으면 「목록에 없는 역 찾기」 버튼으로 되돌린다.
        assertTrue(sheet.contains("if (!closeRecoverySearch())"))
        // 상태 행은 렌더 조건 + 착지 부착 한 자리.
        assertTrue(rows.contains("c.exists(TransitSheetControl.recoveryStatus)"))
        assertTrue(sheet.contains("c.exists(TransitSheetControl.destChangeStatus)"))
        assertTrue(rows.contains("transitLandingRow(c.targets, TransitSheetControl.recoveryStatus)"))
        assertTrue(sheet.contains("transitLandingRow(c.targets, TransitSheetControl.destChangeStatus)"))
        // 전화 결과는 문장과 진동을 함께(5-B 우려 3).
        assertTrue(rows.contains("announceExternalResult("))
        assertFalse(rows.contains("c.model.announceExternal("))
    }

    @Test fun `5-D·5-E 표식이 남지 않고 단계 6 표식은 둘`() {
        val files = guideUi.parentFile.walkTopDown().filter { it.extension == "kt" }.toList()
        val left = files.filter { f -> f.readText().let { it.contains("// 5-" + "D:") || it.contains("// 5-" + "E:") } }.map { it.name }
        assertEquals(emptyList(), left)
        assertFalse(rows.contains("requestFocus("))   // 시트의 `requestFocus`는 착지 기구의 성패 판정 한 자리(5-A)뿐
        for (f in listOf(rows, sheet)) {
            assertFalse(f.contains("focusRequester("))
            assertFalse(f.contains("enabled = false"))
            assertFalse(f.contains("liveRegion"))
            assertFalse(f.contains("spoken ="))
        }
    }

    private val appRoot = guideUi.parentFile.parentFile
    private val overviewSrc = guideUi.resolve("TransitOverviewPage.kt").readText()
    private val endpointSrc = appRoot.resolve("directions/EndpointSearchContent.kt").readText()

    @Test fun `리뷰 반영 소스 가드 1 — 차량 후보 행과 조망 행은 식별자 키로 감싼다`() {
        assertTrue(rows.contains("key(id) { CandidateRow("))
        assertTrue(overviewSrc.contains("key(row.id)"))
    }

    @Test fun `리뷰 반영 소스 가드 2 — 경유역 펼침을 push 메모에 적고 같은 구간일 때만 복원한다`() {
        assertTrue(sheet.contains("var viaExpandedLegAtPush: Int? = null"))
        assertTrue(sheet.contains("TransitSheetReturnMemo.viaExpandedLegAtPush = if (viaExpanded) model.ui.value.state?.legIndex else null"))
        assertTrue(sheet.contains("it != null && it == ui.state?.legIndex"))
        // 복원 초기값은 효과가 메모를 비우기 전(첫 컴포지션)에 읽는다.
        assertTrue(sheet.indexOf("var viaExpanded by remember") < sheet.indexOf("TransitSheetReturnMemo.viaExpandedLegAtPush = null"))
    }

    @Test fun `리뷰 반영 소스 가드 3 — 화면 밖일 수 있는 복귀 착지 세 곳은 들이기를 기다린 뒤 포커스를 준다`() {
        assertTrue(sheet.contains("landRevealed(returnBring.bringFor(RECOVERY_FIND_TAG)"))
        assertTrue(sheet.contains("landRevealed(returnBring.bringFor(back), it,"))
        assertTrue(overviewSrc.contains("landRevealed(altBring, altFocus,"))
        assertTrue(overviewSrc.contains("bringIntoViewRequester(altBring)"))
        assertTrue(rows.contains("bringIntoViewRequester(c.returnBring.bringFor(key))"))
        assertTrue(rows.contains("bringIntoViewRequester(c.returnBring.bringFor(RECOVERY_FIND_TAG))"))
        assertTrue(sheet.contains("bringFor = { k -> c.returnBring.bringFor(k) }"))
        assertTrue(guideUi.resolve("GuideLanding.kt").readText().contains("bring.bringIntoView()"))
    }

    @Test fun `리뷰 반영 소스 가드 4 — 복구 페이지만 역 전용 검색을 켠다`() {
        assertTrue(endpointSrc.contains("titleOverride: String?, stationsOnly: Boolean)"))
        assertTrue(endpointSrc.contains("if (!stationsOnly) when (p.target)"))
        assertTrue(endpointSrc.contains("if (!stationsOnly && !p.hasSearched && p.recentEndpoints.isNotEmpty())"))
        assertTrue(endpointSrc.contains("if (!stationsOnly) p.addresses.forEachIndexed"))
        assertTrue(sheet.contains("recoveryStationSearch\"), stationsOnly = true)"))
        assertTrue(sheet.contains("it.placesOnly = true"))  // 후보 수 통지도 장소만 센다
        assertTrue(sheet.contains("titleOverride = null, stationsOnly = false)"))
        for (f in listOf("guide/ui/GuideSheet.kt", "directions/DirectionsScreen.kt", "location/ManualLocationPickerScreen.kt")) {
            val t = appRoot.resolve(f).readText()
            assertTrue(t.contains("stationsOnly = false"), f)
            assertFalse(t.contains("stationsOnly = true"), f)
        }
    }
}
