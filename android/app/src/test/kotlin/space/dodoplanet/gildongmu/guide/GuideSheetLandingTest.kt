package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.guide.ui.GuideSheetLanding
import space.dodoplanet.gildongmu.guide.ui.SheetRow
import space.dodoplanet.gildongmu.guide.ui.sheetRowExists
import space.dodoplanet.gildongmu.kit.BeaconDest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** E57 안내 시트 첫 정보 행 착지(spec 2026-09-30-guide-sheet-info-row-landing §2.1·§3) 안드로이드 상태 머신. 시간은 가상 시계. */
@OptIn(ExperimentalCoroutinesApi::class)
class GuideSheetLandingTest {
    private class H(val scope: TestScope) {
        var awaiting = false
        var settled = true
        var foreground = true
        var tracking = true
        var rows = setOf(SheetRow.remaining, SheetRow.liveTop)
        var focusOk = true
        val focused = mutableListOf<SheetRow>()
        val logs = mutableListOf<String>()
        val landing = GuideSheetLanding(
            scope = scope,
            clock = { scope.testScheduler.currentTime / 1000.0 },
            awaitingRoute = { awaiting },
            announcementsSettled = { settled },
            isForeground = { foreground },
            isTracking = { tracking },
            rowExists = { it in rows },
            focus = { row -> if (focusOk) { focused += row; true } else false },
            log = { logs += it },
        )
        val last: String get() = logs.last()
    }

    @Test fun `열림 — 경로 조회와 시작 요약이 끝난 뒤 첫 정보 행(남은 거리)에 앉는다`() = runTest {
        val h = H(this)
        h.awaiting = true
        h.settled = false
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(5_000); runCurrent()
        assertEquals(emptyList(), h.focused)
        h.awaiting = false                    // 조회 커밋 — 같은 구간에서 요약이 TTS로 나갔다
        advanceTimeBy(3_000); runCurrent()
        assertEquals(emptyList(), h.focused, "요약이 말하는 동안 앉지 않는다")
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)
        assertTrue(h.last.contains("target=remaining landed=true") && h.last.contains("speechWait=settled") && h.last.contains("note=open"), h.last)
        assertEquals(SheetRow.remaining, h.landing.cursorRow)
    }

    @Test fun `첫 정보 행 순서 — 남은 거리가 없으면 윗줄, 둘 다 없으면 상태 문장, 아무것도 없으면 착지하지 않는다`() = runTest {
        val h = H(this)
        h.rows = setOf(SheetRow.liveTop, SheetRow.status)
        h.landing.request("a", expectsSystemPlacement = true); advanceUntilIdle()
        h.rows = setOf(SheetRow.status, SheetRow.reroute)
        h.landing.request("b", expectsSystemPlacement = true); advanceUntilIdle()
        h.rows = setOf(SheetRow.reroute)
        h.landing.request("c", expectsSystemPlacement = true); advanceUntilIdle()
        assertEquals(listOf(SheetRow.liveTop, SheetRow.status), h.focused)
        assertTrue(h.last.contains("reason=noInfoRow"), h.last)
    }

    @Test fun `경로 조회 20초 초과면 착지하지 않는다`() = runTest {
        val h = H(this)
        h.awaiting = true
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(21_000); runCurrent()
        h.awaiting = false
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertTrue(h.logs.any { it.contains("reason=timeout") })
    }

    @Test fun `안내 발화가 끝나지 않아도 12초 상한에 앉는다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.request("open", expectsSystemPlacement = true)
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)
        assertTrue(h.last.contains("speechWait=cap"), h.last)
    }

    @Test fun `기다리는 동안 사용자가 커서를 옮기면 착지하지 않는다 — 창 안 첫 이동은 시스템 배치`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(500); runCurrent()
        h.landing.onA11yFocus(null)          // 시트 표시 — 시스템 배치
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused, "시스템 배치 한 번은 세지 않는다")

        h.settled = false
        h.landing.request("again", expectsSystemPlacement = true)
        advanceTimeBy(500); runCurrent()
        h.landing.onA11yFocus(null)
        advanceTimeBy(800); runCurrent()
        h.landing.onA11yFocus(null)          // 사용자 스와이프
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)
        assertTrue(h.last.contains("reason=userMoved"), h.last)

        // 창(2.5초) 밖의 첫 이동은 사용자 이동이다.
        h.settled = false
        h.landing.request("late", expectsSystemPlacement = true)
        advanceTimeBy(3_000); runCurrent()
        h.landing.onA11yFocus(SheetRow.liveTop)
        h.settled = true
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
        assertTrue(h.last.contains("reason=userMoved"), h.last)
    }

    @Test fun `배경에선 대입하지 않고 이월해 전경 복귀 신호에서 다시 요청한다 — 이월은 한 번`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(1_000); runCurrent()
        h.foreground = false                 // 잠갔다 — 대기는 계속되고 대입 시점에 이월한다
        h.settled = true
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertTrue(h.last.contains("deferred=true phase=wait"), h.last)
        h.foreground = true
        h.settled = false                    // 모델이 복귀 상환을 냈다
        h.landing.onForegroundReturn()
        advanceTimeBy(2_000); runCurrent()
        assertEquals(emptyList(), h.focused, "상환 발화가 끝난 뒤")
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)
        assertTrue(h.last.contains("note=deferred"), h.last)
        h.landing.onForegroundReturn()
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
    }

    @Test fun `대입 400ms 사이 잠기면 대입 직전 재확인이 이월한다, 대기 중 커서를 옮겼으면 이월하지 않는다`() = runTest {
        val h = H(this)
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(200); runCurrent()     // 대입 단계(400ms 지연) 안
        h.foreground = false
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertTrue(h.last.contains("phase=inFlight"), h.last)
        h.foreground = true
        h.landing.onForegroundReturn(); advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)

        h.settled = false
        h.landing.request("moved", expectsSystemPlacement = true)
        advanceTimeBy(100); runCurrent()
        h.landing.onA11yFocus(null); h.landing.onA11yFocus(null)
        h.foreground = false
        h.settled = true
        advanceUntilIdle()
        assertTrue(h.last.contains("reason=userMoved"), h.last)
        h.foreground = true
        h.landing.onForegroundReturn()
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
    }

    @Test fun `시스템 배치를 기대하지 않는 요청(시트 안 버튼 전이·소실 복구)은 첫 이동부터 사용자 이동이다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.request("waypointRemoved", expectsSystemPlacement = false)
        advanceTimeBy(300); runCurrent()
        h.landing.onA11yFocus(null)
        h.settled = true
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertTrue(h.last.contains("reason=userMoved"), h.last)
    }

    @Test fun `소실 복구 — 커서가 앉은 정보 행이 사라지면 그 시점의 첫 정보 행으로, 스와이프로 떠났으면 그대로`() = runTest {
        val h = H(this)
        h.landing.request("open", expectsSystemPlacement = true); advanceUntilIdle()
        assertEquals(SheetRow.remaining, h.landing.cursorRow)
        h.rows = setOf(SheetRow.liveTop)          // 이탈 확정 — 남은 거리 행 숨김
        h.settled = false                         // 같은 커밋의 이탈 경고
        h.landing.onRowsChanged(setOf(SheetRow.remaining, SheetRow.liveTop), h.rows)
        advanceTimeBy(1_000); runCurrent()
        assertEquals(listOf(SheetRow.remaining), h.focused, "경고가 끝난 뒤")
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining, SheetRow.liveTop), h.focused)
        assertTrue(h.last.contains("note=lost=remaining"), h.last)

        h.landing.onA11yFocus(null)               // 사용자가 다른 버튼으로 옮겼다
        h.rows = setOf(SheetRow.status)
        h.landing.onRowsChanged(setOf(SheetRow.liveTop), h.rows)
        advanceUntilIdle()
        assertEquals(2, h.focused.size)
    }

    @Test fun `새 요청이 앞 요청을 대신하고, 추적이 끝났으면 앉지 않는다`() = runTest {
        val h = H(this)
        h.awaiting = true
        h.landing.request("first", expectsSystemPlacement = true)
        h.landing.request("second", expectsSystemPlacement = true)
        h.awaiting = false
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
        assertTrue(h.last.contains("note=second"), h.last)
        h.settled = false
        h.landing.request("end", expectsSystemPlacement = true)
        h.tracking = false
        h.settled = true
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
    }

    @Test fun `대입이 실패하면 600ms 뒤 한 번 더`() = runTest {
        val h = H(this)
        h.focusOk = false
        h.landing.request("open", expectsSystemPlacement = true)
        advanceTimeBy(450); runCurrent()
        h.focusOk = true
        advanceUntilIdle()
        assertEquals(listOf(SheetRow.remaining), h.focused)
        assertTrue(h.last.contains("attempts=2"), h.last)
    }

    @Test fun `행 렌더 조건 — 남은 거리는 상세·경로 위, 상태 문장은 간략이거나 윗줄이 없을 때, 종료 화면엔 없다`() {
        val detail = WalkGuideUiState(status = GuideStatus.tracking, mode = GuideMode.detail, remainingText = "남은 거리 1.2km", liveTopText = "50m 앞 좌회전", statusText = "s")
        assertTrue(sheetRowExists(detail, SheetRow.remaining))
        assertTrue(sheetRowExists(detail, SheetRow.liveTop))
        assertFalse(sheetRowExists(detail, SheetRow.status))
        assertFalse(sheetRowExists(detail.copy(offRoute = true), SheetRow.remaining))
        assertTrue(sheetRowExists(detail.copy(offRoute = true), SheetRow.reroute))
        assertTrue(sheetRowExists(detail.copy(liveTopText = null), SheetRow.status))
        val brief = WalkGuideUiState(status = GuideStatus.tracking, mode = GuideMode.brief, statusText = "목적지까지 약 300m", liveTopText = "x")
        assertTrue(sheetRowExists(brief, SheetRow.status))
        assertFalse(sheetRowExists(brief, SheetRow.liveTop))
        assertFalse(sheetRowExists(brief, SheetRow.reroute))
        assertFalse(sheetRowExists(detail.copy(arrivalDest = BeaconDest(37.0, 127.0)), SheetRow.remaining))
    }

    @Test fun `초점 노드 표식 → 행 — 고정 tag로 가르고 모르는 노드는 null`() {
        assertEquals(SheetRow.remaining, SheetRow.forTag("guide-remaining"))
        assertEquals(SheetRow.liveTop, SheetRow.forTag("guide-live-top"))
        assertEquals(SheetRow.status, SheetRow.forTag("guide-status"))
        assertEquals(SheetRow.reroute, SheetRow.forTag("guide-reroute"))
        assertEquals(null, SheetRow.forTag("guide-title"))
        assertEquals(null, SheetRow.forTag(null))
    }
}

/** 시트 배선 가드(E57) — Compose는 JVM 레인이 없어 입구·렌더 조건 짝을 소스로 잠근다. */
class GuideSheetLandingGuardTest {
    private val pkg = space.dodoplanet.gildongmu.kit.Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private val sheet = pkg.resolve("guide/ui/GuideSheet.kt").readText()
    private val tracking = sheet.substringAfter("private fun TrackingContent(").substringBefore("\n}\n")

    @Test fun `열림·띠바 복귀는 첫 정보 행 입구로, 접기 버튼·띠바 표식 착지는 없다`() {
        assertTrue(tracking.contains("landing.request(\"open\", expectsSystemPlacement = true)"), "진입 착지")
        assertTrue(pkg.resolve("guide/ui/GuideBand.kt").readText().contains("GuideSession.pendingSheetReturn = null"), "띠바 복귀는 장소 상세 복귀 표식을 지운다")
        assertFalse(sheet.contains("returnedFromBand"))
        assertFalse(pkg.resolve("guide/GuideSession.kt").readText().contains("returnedFromBand"))
        assertFalse(tracking.contains("minimizeFocus"), "접기 버튼은 착지 대상이 아니다")
    }

    @Test fun `사용자 전이는 첫 정보 행으로 — 재조회·대안 채택·경유지 삭제·검색 확정`() {
        assertTrue(tracking.contains("if ((pressed || landing.cursorRow == SheetRow.reroute) && page == GuidePage.Tracking) landing.request(\"rerouted\", expectsSystemPlacement = false)"), "누름 ∨ 커서가 버튼 위")
        assertTrue(tracking.contains("toTracking(\"variantAdopted\")") && tracking.contains("landing.request(\"variantAdopted\", expectsSystemPlacement = false)"))
        assertTrue(tracking.contains("if (GuideSession.walk.removeWaypoint()) landing.request(\"waypointRemoved\", expectsSystemPlacement = false)"))
        assertTrue(sheet.contains("onDone(commitGuideEndpoint(endpoint, field))"), "검색 확정의 착지 표식")
    }

    @Test fun `정보 행 셋은 sheetRowExists 한 곳의 조건으로 렌더되고 착지 requester를 단다`() {
        for (row in listOf("remaining", "liveTop", "status")) {
            assertTrue(Regex("""if \(sheetRowExists\(ui, SheetRow\.$row\)\) InfoRow\(""").containsMatchIn(tracking), row)
        }
        assertTrue(tracking.contains("if (sheetRowExists(ui, SheetRow.reroute))"))
        assertTrue(tracking.contains("landing.onRowsChanged(old, presentRows)"), "소실 복구")
        assertTrue(tracking.contains("landing.onForegroundReturn()"), "배경 이월의 복귀")
        assertTrue(tracking.contains("ObserveA11yFocus { tag -> landing.onA11yFocus(SheetRow.forTag(tag)"), "커서 행은 초점 노드의 표식으로")
        assertTrue(tracking.contains("testTagsAsResourceId = true"), "표식을 리소스 id로 낸다")
        val observer = pkg.resolve("guide/ui/A11yFocusObserver.kt").readText()
        assertTrue(observer.contains("findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)?.viewIdResourceName"), "이벤트 이름이 아니라 초점 노드")
        assertTrue(!observer.contains("TYPE_VIEW_FOCUSED,") && !observer.contains("-> AccessibilityNodeInfo.FOCUS_INPUT"), "입력 초점 갈래는 낡은 노드를 돌려준다(Compose 1.12)")
        assertTrue(tracking.contains("announcementsSettled = { GuideSession.walk.announcementsSettled() }"))
        assertTrue(pkg.resolve("guide/GuideSession.kt").readText().contains("if (isMinimized) bandLandingSeq += 1 else sheetReturnSeq += 1"), "복귀 신호는 모델 처리 뒤")
    }
}
