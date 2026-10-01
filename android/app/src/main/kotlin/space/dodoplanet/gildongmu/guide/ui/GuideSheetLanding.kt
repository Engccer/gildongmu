package space.dodoplanet.gildongmu.guide.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.guide.GuideDiag

/**
 * 안내 시트의 행 — 정보 행 셋(첫 정보 행 후보, 순서가 곧 우선순위: 화면의 행 순서 그대로)과 재조회 버튼(착지 대상이 아니라 "커서가 사라지는 버튼
 * 위에 있었는가"를 읽는 자리). 직선거리 주석·아랫줄은 후보가 아니다(E57 spec §2.1).
 */
enum class SheetRow {
    remaining, liveTop, status, reroute;

    companion object {
        val infoRows = listOf(remaining, liveTop, status)
    }
}

/**
 * 안내 시트 첫 정보 행 착지(E57, spec `2026-09-30-guide-sheet-info-row-landing-design.md` 안드로이드 이식). 시트가 열리거나 띠바에서 돌아오거나
 * 사용자 전이가 끝나면 커서를 **첫 정보 행**(남은 거리 → 윗줄 → 상태 문장)에 앉힌다. 입구는 [request] 하나다.
 *
 * - 경로 조회 중이면 조회가 끝날 때까지(상한 20초 — 넘기면 착지하지 않는다), 그다음 **안내가 낸 문장이 모두 끝날 때까지** 기다린다(상한 12초). 안드로이드는
 *   안내 문장이 앱 TTS 한 채널이라 끝을 발화 완료 콜백으로 직접 안다(`WalkGuideModel.announcementsSettled`) — iOS의 게시 장부가 필요 없다.
 * - 기다리는 동안 사용자가 커서를 옮겼으면 착지하지 않는다. 신호는 시트 윈도의 접근성 초점 이벤트이고([onA11yFocus]), 대기를 세운 뒤 창(2.5초) 안의
 *   **첫 이동 한 번**은 시스템이 커서를 두는 것(시트 표시)으로 보고 세지 않는다.
 * - 배경에선 대입하지 않고 전경 복귀에 한 번 다시 요청한다([onBackground]·[onForegroundReturn], 복귀 요청은 모델이 복귀 상환을 낸 뒤에 온다).
 * - 커서가 앉아 있던 정보 행이 사라지면(이탈 확정·최종 접근 진입·간략 강등) 그 시점의 첫 정보 행으로 옮긴다([onRowsChanged]).
 *
 * Compose 밖의 일반 클래스라 JVM이 시간을 돌려 검증한다(`GuideSheetLandingTest`). 메인 스레드 전용(동기화 없음).
 */
class GuideSheetLanding(
    private val scope: CoroutineScope,
    /** 단조 시각(초). */
    private val clock: () -> Double,
    private val awaitingRoute: () -> Boolean,
    private val announcementsSettled: () -> Boolean,
    private val isForeground: () -> Boolean,
    /** 추적 중이고 종료 화면이 아닌가. */
    private val isTracking: () -> Boolean,
    private val rowExists: (SheetRow) -> Boolean,
    /** 대입 — 실패(예외)면 false. 지연은 여기서 두지 않는다(이 클래스가 400ms를 센다). */
    private val focus: (SheetRow) -> Boolean,
    private val log: (String) -> Unit = { GuideDiag.log(it) },
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private class Pending(val since: Double, val note: String) {
        var systemPlacementSeen = false
        var movedAfter: Double? = null
    }

    private var pending: Pending? = null
    private var job: Job? = null
    /** 대입 단계(400ms 지연·재시도)에 있는 착지의 표식 — 배경 전환이 끊고 이월할 때 읽는다. */
    private var landingNote: String? = null
    private var deferredNote: String? = null

    /** 접근성 커서가 지금 앉은 행(시트 윈도의 초점 이벤트로 안다). 모르면 null. */
    var cursorRow: SheetRow? = null
        private set

    /** 첫 정보 행 착지 요청 — 시트 열림·띠바 복귀·사용자 전이·소실 복구·전경 복귀의 공통 입구. 새 요청이 앞 요청을 대신한다(latest-wins). */
    fun request(note: String) {
        job?.cancel()
        landingNote = null
        val p = Pending(clock(), note)
        pending = p
        job = scope.launch { run(p) }
    }

    private suspend fun run(p: Pending) {
        val start = clock()
        while (awaitingRoute()) {
            if (clock() - start >= ROUTE_WAIT_SECONDS) {
                if (pending === p) pending = null
                log("sheetFocus sheet=beacon target=pending reason=timeout note=${p.note}")
                return
            }
            sleep(POLL_MS)
        }
        var speechWait = "settled"
        var waitedSpeech = 0L
        while (!announcementsSettled()) {
            if (waitedSpeech >= SPEECH_WAIT_MS) { speechWait = "cap"; break }
            sleep(POLL_MS)
            waitedSpeech += POLL_MS
        }
        if (pending !== p) return
        pending = null
        if (!isTracking()) return
        val waitedMs = ((clock() - p.since) * 1000).toInt()
        p.movedAfter?.let { moved ->
            log("sheetFocus sheet=beacon target=pending reason=userMoved movedMs=${(moved * 1000).toInt()} waitedMs=$waitedMs note=${p.note}")
            return
        }
        land(p.note, waitedMs, speechWait)
    }

    private suspend fun land(note: String, waitedMs: Int, speechWait: String) {
        if (!isForeground()) { defer(note, "none"); return }
        landingNote = note
        sleep(LAND_DELAY_MS)
        // 400ms 사이의 배경 전환은 [onBackground]가 이 코루틴을 끊고 이월한다 — 여기 다시 오는 것은 전경일 때뿐이다.
        val row = SheetRow.infoRows.firstOrNull(rowExists)
        if (row == null) {
            landingNote = null
            log("sheetFocus sheet=beacon target=none reason=noInfoRow note=$note")
            return
        }
        var attempts = 1
        var ok = focus(row)
        if (!ok) {
            sleep(RETRY_DELAY_MS)
            attempts = 2
            ok = rowExists(row) && focus(row)
        }
        landingNote = null
        if (ok) cursorRow = row
        log("sheetFocus sheet=beacon target=$row landed=$ok attempts=$attempts waitedMs=$waitedMs speechWait=$speechWait note=$note")
    }

    private fun defer(note: String, phase: String) {
        deferredNote = note
        log("sheetFocus sheet=beacon target=pending reason=background deferred=true phase=$phase note=$note")
    }

    /**
     * 시트 윈도의 접근성 초점 이동(`TYPE_VIEW_ACCESSIBILITY_FOCUSED`) — `row`는 그 노드가 정보 행·재조회 버튼이면 그 행, 아니면 null. 대기 중이면 사용자
     * 이동으로 센다(창 안 첫 이동은 시스템 배치).
     */
    fun onA11yFocus(row: SheetRow?) {
        cursorRow = row
        val p = pending ?: return
        val elapsed = clock() - p.since
        if (!p.systemPlacementSeen && elapsed <= SYSTEM_PLACEMENT_SECONDS) p.systemPlacementSeen = true
        else if (p.movedAfter == null) p.movedAfter = elapsed
    }

    /**
     * 정보 행 집합이 바뀌었다 — 커서가 앉아 있던 행이 사라졌으면 그 시점의 첫 정보 행으로(spec §3.4). 판정은 바인딩의 변화가 아니라 **행 집합이
     * 바뀌는 순간의 커서 행**이다. 스와이프로 떠난 경우는 커서가 그 행에 없어 걸리지 않는다. 같은 커밋이 낸 통지(이탈 경고 등)가 끝난 뒤에 앉는다.
     */
    fun onRowsChanged(old: Set<SheetRow>, new: Set<SheetRow>) {
        val row = cursorRow ?: return
        if (row !in SheetRow.infoRows || row !in old || row in new || !isTracking()) return
        request("lost=$row")
    }

    /** 앱이 배경으로 갔다 — 진행 중인 착지·대기를 끊고 이월한다. 대기 중 사용자가 이미 커서를 옮겼으면 이월하지 않는다. */
    fun onBackground() {
        val p = pending
        val note = when {
            p != null -> p.note.takeIf { p.movedAfter == null }
            else -> landingNote
        } ?: return
        job?.cancel()
        pending = null
        landingNote = null
        defer(note, if (p != null) "wait" else "inFlight")
    }

    /** 전경 복귀 — 모델이 복귀 상환을 낸 뒤에 온다(그 발화가 끝난 뒤 앉는다). 이월된 착지가 있을 때만. */
    fun onForegroundReturn() {
        deferredNote ?: return
        deferredNote = null
        request("deferred")
    }

    /** 시트 컴포지션이 떠난다(최소화·도착 화면) — 대기를 끊는다. 이월 표식도 버린다(띠바 복귀는 새 요청이다). */
    fun dispose() {
        job?.cancel()
        pending = null
        landingNote = null
        deferredNote = null
    }

    companion object {
        /** 경로 조회 대기 상한 — 위치 대기 15초 + 조회 왕복. 넘기면 착지하지 않는다. */
        const val ROUTE_WAIT_SECONDS = 20.0
        /** 안내 발화가 끝나기를 기다리는 상한(ms). 첫 안내를 담은 긴 요약도 이 안에 끝난다. */
        const val SPEECH_WAIT_MS = 12_000L
        /** 대기를 세운 뒤 첫 초점 이동을 시스템 배치로 인정하는 창(초). */
        const val SYSTEM_PLACEMENT_SECONDS = 2.5
        const val POLL_MS = 100L
        /** 시트 표시 애니메이션 뒤 대입(`land` 관용구 동형). */
        const val LAND_DELAY_MS = 400L
        const val RETRY_DELAY_MS = 600L
    }
}
