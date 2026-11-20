package space.dodoplanet.gildongmu.guide.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.DestChangePhase
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.PendingRecovery
import space.dodoplanet.gildongmu.guide.RecoveryOutcome
import space.dodoplanet.gildongmu.guide.TransitAboardStep
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.kit.TransitGuideLeg
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.TransitTrackMode

/**
 * 대중교통 시트의 착지 대상(iOS `TransitTrackingSheet.SheetControl`). **전이 착지의 대상은 `status` 하나다**(E38 위원장 판정 2026-09-12: 「시트에서 무엇을
 * 누르든 커서는 상태 문장 행에 앉는다」). 나머지는 **자기 질문을 여는 화면**(그 헤딩·라벨이 곧 질문이라 착지 낭독이 답을 유도한다)과 목적지 전환·잘못 내림
 * 복구 상태 행뿐이다 — 종전 대상 `advance`·`changeBoarding`·`boardAlready`·`title`을 되살리려면 위원장 판정부터 뒤집어야 한다.
 * `tag`는 행의 고정 표식(testTag = 리소스 id) — 줄이면 `mergedRow`의 키다.
 */
enum class TransitSheetControl(val tag: String) {
    /** 상태 문장 줄 — 모든 국면 전이·복귀 착지의 유일한 대상(E38). 폴마다 내용이 바뀌어도 노드는 같은 자리에 남는다. */
    status("transit-status"),
    /** 대기 목록 라벨 — pickVehicle 단계에선 라벨이 곧 질문이고, 폴링으로 커서가 얹힌 후보가 사라졌을 때의 목록 안 복귀 자리다. */
    waitingLabel("transit-waiting-label"),
    /** 역 선택 질문 헤딩 — 승차 중 탑승 변경(A16 L3)·「이미 탑승」(A34 ②)·잘못 내림 복구(E78) 공용. */
    reboardPrompt("transit-reboard-prompt"),
    /** 급행 확인 질문 헤딩 — 펼친 직후 착지. */
    expressPrompt("transit-express-prompt"),
    /** 급행 거절 상시 문장 — 질문의 답이라 헤딩과 한 묶음(버튼이 사라진 자리). */
    expressBlocked("transit-express-blocked"),
    /** 목적지 전환 상태 행(조회 중·0건·오류). */
    destChangeStatus("transit-dest-change-status"),
    /** 잘못 내림 복구 상태 행(조회 중·위치 실패·조회 실패·경로 없음·안내 가능 경로 없음). */
    recoveryStatus("transit-recovery-status");

    companion object {
        fun forTag(tag: String?): TransitSheetControl? = entries.firstOrNull { it.tag == tag }
    }
}

/**
 * 커서가 올라탄 **국면 전용 버튼**(iOS `PhaseButton`, A47 소실 복구). 착지 대상이 아니라 「관측 전이가 그 버튼의 국면을 끝낼 때 커서를 쥐고 있었는가」를 읽는
 * 자리다 — 버튼은 이 `tag`를 `testTag`로 단다(초점 관찰이 리소스 id로 가린다). [다음 구간]은 근사 잠금 riding에도 서지만 근사 잠금엔 관측 전이가 없다.
 */
enum class TransitPhaseButton(val tag: String, val phase: TransitPhase) {
    boardSelected("transit-board-selected", TransitPhase.boarding),
    reselect("transit-reselect", TransitPhase.boarding),
    advance("transit-advance", TransitPhase.arrived);

    companion object {
        fun forTag(tag: String?): TransitPhaseButton? = entries.firstOrNull { it.tag == tag }
    }
}

/** 국면 전이 판정의 키(iOS `PhaseTransitionKey`) — 국면 + 사용자 전이 순번(A47). 순번만 바뀐 커밋(대기 → 다음 구간 대기)도 전이다. */
data class TransitPhaseKey(val phase: TransitPhase?, val userSeq: Int)

/**
 * 국면 전이의 착지 대상(iOS `phaseTransitionLanding`). 기본은 상태 문장 하나이고, 예외는 **차량 선택 목록으로 가는 사용자 전이** 하나다(그 화면의 질문 라벨).
 * 착지 여부는 **전이의 출처**가 가른다(A47): 사용자 입력이 일으킨 전이는 전부 착지하고(누른 버튼이 사라진다), 폴 응답이 일으킨 관측 전이는 도착만 착지한다.
 * ⚠ 관측 boarding → riding 승격은 착지가 아니다(듣던 문장을 끊는 포커스 강탈). 관측 전이가 커서를 쥔 국면 버튼을 없앴으면(`lostFocus`) 잃은 포커스의 복구다.
 * `waitingLabelExists`(기본값 없음): 목록이 서지 않는 갈래(지방버스 근사 잠금·추적 불가·역 선택 단계)는 라벨이 없어 상태 문장으로 — 안 그러면 착지도 폴백도 없다.
 */
fun transitPhaseTransitionLanding(
    previous: TransitPhase?,
    phase: TransitPhase?,
    byUser: Boolean,
    lostFocus: Boolean,
    waitingLabelExists: Boolean,
): TransitSheetControl? {
    if (phase == null || phase == TransitPhase.done) return null
    if (byUser) {
        return if (phase == TransitPhase.waiting && waitingLabelExists) TransitSheetControl.waitingLabel else TransitSheetControl.status
    }
    // 관측 도착 — [다음 구간]이 아니라 도착을 말하는 문장이 착지점이다(E38 판정 문언).
    if (phase == TransitPhase.arrived && previous != TransitPhase.arrived) return TransitSheetControl.status
    if (lostFocus) return TransitSheetControl.status
    return null
}

/** 화면 상태의 현재 구간(모델 `currentLeg`와 같은 식 — 순수 판정이 모델 없이 읽는다). */
fun transitUiLeg(ui: TransitGuideUiState): TransitGuideLeg? = ui.state?.let { s -> ui.route?.legs?.getOrNull(s.legIndex) }

/**
 * 대상이 지금 렌더되는가 — 렌더 조건의 **정본**이다(iOS `controlExists`). 그 행을 그리는 자리(뒤 묶음 5-B·5-D 포함)와 착지 판정이 이 한 함수를 읽는다
 * (도보 `sheetRowExists`와 같은 구조 — iOS는 렌더 조건과 판정이 두 벌이라 어긋난 적이 있다, 코드 리뷰 M3).
 * `expressPromptActive`: 급행 확인 질문이 펼쳐졌는가(시트 지역 상태). `recoveryOffered`: 모델 `recoveryOffered`(여정 훅을 모델만 안다). 둘 다 기본값 없음.
 */
fun transitControlExists(ui: TransitGuideUiState, control: TransitSheetControl, expressPromptActive: Boolean, recoveryOffered: Boolean): Boolean {
    val state = ui.state
    val phase = state?.phase
    val leg = transitUiLeg(ui)
    return when (control) {
        TransitSheetControl.status -> state != null && leg != null
        // 대기 목록은 추적 불가·지방버스 분기와 역 선택 단계에선 그려지지 않는다.
        TransitSheetControl.waitingLabel -> phase == TransitPhase.waiting && ui.aboardStep != TransitAboardStep.pickStation &&
            state?.signal != TransitSignal.untrackable && leg?.trackMode != TransitTrackMode.tagoBus
        TransitSheetControl.reboardPrompt -> (phase == TransitPhase.riding && ui.reboardPickerActive) ||
            (phase == TransitPhase.waiting && ui.aboardStep == TransitAboardStep.pickStation) ||
            (recoveryOffered && ui.pendingRecovery?.phase == PendingRecovery.Phase.pickStation)
        TransitSheetControl.expressPrompt -> phase == TransitPhase.waiting && expressPromptActive
        TransitSheetControl.expressBlocked -> phase == TransitPhase.waiting && ui.expressBlockedNote != null
        TransitSheetControl.destChangeStatus -> ui.pendingDestChange.let { it != null && it.phase !is DestChangePhase.Loaded }
        TransitSheetControl.recoveryStatus -> recoveryOffered && transitRecoveryStatusKey(ui) != null
    }
}

/** 대기 목록 라벨 키(iOS `waitingLabelText`) — 그리는 자리(5-B)와 착지 폴백이 같은 식을 읽는다. */
fun transitWaitingLabelKey(ui: TransitGuideUiState): String =
    if (ui.aboardStep == TransitAboardStep.pickVehicle) "transitGuide.waitingLabelAboard" else "transitGuide.waitingLabel"

/** 역 선택 질문 키(iOS `reboardPromptKey`) — riding 픽커는 역(서울버스는 정류장, E76 후속 ⓔ), 「이미 탑승」 pickStation은 지나는 역. */
fun transitReboardPromptKey(ui: TransitGuideUiState): String = when {
    ui.aboardStep == TransitAboardStep.pickStation -> "transitGuide.aboardStationPrompt"
    transitUiLeg(ui)?.trackMode == TransitTrackMode.seoulBus -> "transitGuide.reboardStopPrompt"
    else -> "transitGuide.reboardStationPrompt"
}

/** 복구 상태 행 키(iOS `recoveryStatusText`) — 역 고르기 중엔 행이 없다(질문 헤딩이 그 자리). 뷰(5-D)와 착지 폴백이 같은 식을 읽는다. */
fun transitRecoveryStatusKey(ui: TransitGuideUiState): String? {
    if (ui.pendingRecovery?.phase == PendingRecovery.Phase.loading) return "android.transitGuide.destChangeLoading"
    return when (ui.recoveryOutcome) {
        RecoveryOutcome.noLocation -> "android.transitGuide.recoveryNoLocation"
        RecoveryOutcome.fetchFailed -> "android.transitGuide.destChangeError"
        RecoveryOutcome.noRoute -> "android.transitGuide.recoveryNoRoute"
        RecoveryOutcome.noGuidable -> "android.transitGuide.recoveryNoGuidable"
        null -> null
    }
}

/** 목적지 전환 상태 행 키(조회 중·0건·오류). 후보가 실리면(`Loaded`) 행이 없다. */
fun transitDestChangeStatusKey(ui: TransitGuideUiState): String? = when (ui.pendingDestChange?.phase) {
    DestChangePhase.Loading -> "android.transitGuide.destChangeLoading"
    DestChangePhase.Empty -> "android.transitGuide.destChangeNone"
    DestChangePhase.Failed -> "android.transitGuide.destChangeError"
    is DestChangePhase.Loaded, null -> null
}

/**
 * 착지 실패 폴백 문장(iOS `landingFallbackText`) — **그 대상에 착지했다면 스크린 리더가 읽었을 라벨**(같은 키). `statusText`는 화면의 상태 문장 줄 그대로
 * (모델 `statusLineText(…, now = positionClock, speaksLocated = true)`) — 낭독 거리 풀어쓰기는 모델의 음성 게시가 한다.
 */
fun transitLandingFallbackText(control: TransitSheetControl, ui: TransitGuideUiState, strings: Strings, statusText: () -> String): String = when (control) {
    TransitSheetControl.status -> statusText()
    TransitSheetControl.waitingLabel -> strings.get(transitWaitingLabelKey(ui))
    TransitSheetControl.reboardPrompt -> strings.get(transitReboardPromptKey(ui))
    TransitSheetControl.expressPrompt -> strings.get("transitGuide.expressPrompt")
    TransitSheetControl.expressBlocked -> ui.expressBlockedNote.orEmpty()
    TransitSheetControl.destChangeStatus -> transitDestChangeStatusKey(ui)?.let { strings.get(it) }.orEmpty()
    TransitSheetControl.recoveryStatus -> transitRecoveryStatusKey(ui)?.let { strings.get(it) }.orEmpty()
}

/**
 * 대중교통 시트의 컨트롤 착지(iOS `landControlFocus`의 안드로이드판). 입구는 [land] 하나 — 대상은 호출자가 고른다(전이 판정 [transitPhaseTransitionLanding]).
 *
 * 도보 시트의 [GuideSheetLanding] 관용구를 그대로 따른다: 안내가 낸 문장(TTS 한 채널)이 끝날 때까지 기다리고(상한 12초 — 안드로이드는 스크린 리더 착지 낭독과
 * 앱 TTS가 다른 소리라 겹치면 둘 다 알아듣기 어렵다), 기다리는 동안 사용자가 커서를 옮겼으면 앉지 않는다([onA11yFocus], 시스템 배치를 기대한 요청이면 창 안
 * 첫 이동 한 번은 제외), 400ms 뒤 대입하고 실패하면 600ms 뒤 한 번 더. 성패는 `requestFocus(FocusDirection.Enter)`의 Boolean이고 대입 전에 그 행을 화면
 * 안으로 들인다(`bringIntoView` — 화면 밖 행의 포커스 이동은 한소네 커서가 따르지 않는다). 배경 판정은 대입 시점의 실제 앱 상태다.
 *
 * iOS 계약에서 옮긴 것: 배경·시트 안 페이지(조망·검색) 위에선 대입하지 않고 이월한다(`deferredLanding`, latest-wins) — 전경 복귀·페이지 닫힘이 한 번 소비한다.
 * 대상이 그 사이 사라졌으면(`vanished`) 폴백 없이 끝난다(새 국면의 착지가 대신한다). 두 번 다 초점을 받지 못하면 그 자리에서 낭독됐을 라벨을 모델 통지로 낸다
 * (`announceLandingFallback` — 착지 못 하면 통지가 유일한 증거, 헌장 §5). 도보 착지(`GuideSheetLanding`)는 대상이 「첫 정보 행」 하나로 정해져 있고 폴백이
 * 없어 클래스를 나눴다(도보 동작·테스트 불변).
 *
 * Compose 밖의 일반 클래스라 JVM이 시간을 돌려 검증한다(`TransitSheetLandingTest`). 메인 스레드 전용.
 */
class TransitSheetLanding(
    private val scope: CoroutineScope,
    /** 단조 시각(초). */
    private val clock: () -> Double,
    private val announcementsSettled: () -> Boolean,
    private val isForeground: () -> Boolean,
    private val isTracking: () -> Boolean,
    /** 시트 안 페이지(조망·목적지 검색·복구 역 검색)가 열려 있는가 — 그 위에선 대입하지 않는다(커서가 페이지 안이다). */
    private val pageOpen: () -> Boolean,
    /** 대상이 지금 렌더되는가([transitControlExists] + 지금 Tracking 페이지인가). */
    private val exists: (TransitSheetControl) -> Boolean,
    /** 대상 행을 화면 안으로(`BringIntoViewRequester.bringIntoView`). */
    private val reveal: suspend (TransitSheetControl) -> Unit,
    /** 대입 — 초점을 받지 못했으면 false. 지연은 여기서 두지 않는다. */
    private val focus: (TransitSheetControl) -> Boolean,
    private val fallbackText: (TransitSheetControl) -> String,
    private val announceFallback: (String) -> Unit,
    private val log: (String) -> Unit = { GuideDiag.log(it) },
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private class Pending(val target: TransitSheetControl, val since: Double, val note: String, expectsSystemPlacement: Boolean) {
        var systemPlacementSeen = !expectsSystemPlacement
        var movedAfter: Double? = null
    }

    private var pending: Pending? = null
    private var job: Job? = null

    /** 배경·페이지 위에서 이월된 착지 대상(latest-wins). 전경 복귀·페이지 닫힘이 [landDeferred]로 한 번 소비한다. */
    var deferred: TransitSheetControl? = null
        private set

    /** 접근성 커서가 지금 앉은 노드의 고정 표식(시트 윈도의 초점 이벤트로 안다). 국면 버튼 소실 판정(`TransitPhaseButton.forTag`)이 읽는다. 모르면 null. */
    var cursorTag: String? = null
        private set

    /** 진행 중 요청이 아직 시스템 배치를 기다리는가 — 같은 커밋에서 그 요청을 대신하는 새 요청이 이 기대를 물려받는다(조망 닫힘 직후 국면 전이). */
    val awaitingSystemPlacement: Boolean get() = pending?.systemPlacementSeen == false

    /**
     * 착지 요청 — 새 요청이 앞 요청을 대신한다(latest-wins). `expectsSystemPlacement`(기본값 없음): 시스템이 곧 커서를 둘 요청인가(시트 표시·페이지 닫힘·전경
     * 복귀) — 참이면 창 안 첫 이동 한 번을 시스템 배치로 보고 세지 않는다. 시트 안 버튼 전이·관측 전이는 거짓.
     */
    fun land(target: TransitSheetControl, note: String, expectsSystemPlacement: Boolean) {
        job?.cancel()
        pending = null
        val blocker = when {
            !isForeground() -> "background"
            pageOpen() -> "modal"
            else -> null
        }
        if (blocker != null) {
            deferred = target
            log("controlFocus target=$target reason=$blocker deferred=true note=$note")
            return
        }
        deferred = null
        val p = Pending(target, clock(), note, expectsSystemPlacement)
        pending = p
        job = scope.launch { run(p) }
    }

    private suspend fun run(p: Pending) {
        var speechWait = "settled"
        val speechStart = clock()
        while (!announcementsSettled()) {
            if ((clock() - speechStart) * 1000 >= SPEECH_WAIT_MS) { speechWait = "cap"; break }
            sleep(POLL_MS)
        }
        if (pending !== p) return
        pending = null
        if (!isTracking()) return
        p.movedAfter?.let { moved ->
            log("controlFocus target=${p.target} reason=userMoved movedMs=${(moved * 1000).toInt()} note=${p.note}")
            return
        }
        assign(p.target, p.note, speechWait)
    }

    private suspend fun assign(target: TransitSheetControl, note: String, speechWait: String) {
        if (!isForeground()) { defer(target, "background", "wait", note); return }
        sleep(LAND_DELAY_MS)
        // 대입 직전 재확인 — 400ms 사이 잠겼거나 페이지가 열렸으면 이월한다.
        if (!isForeground()) { defer(target, "background", "inFlight", note); return }
        if (pageOpen()) { defer(target, "modal", "inFlight", note); return }
        if (!exists(target)) { log("controlFocus target=$target landed=false attempts=1 reason=vanished note=$note"); return }
        reveal(target)
        var attempts = 1
        var ok = focus(target)
        if (!ok) {
            sleep(RETRY_DELAY_MS)
            if (!isForeground()) { defer(target, "background", "inFlight", note); return }
            attempts = 2
            if (!exists(target)) { log("controlFocus target=$target landed=false attempts=$attempts reason=vanished note=$note"); return }
            reveal(target)
            ok = focus(target)
        }
        if (ok) cursorTag = target.tag
        log("controlFocus target=$target landed=$ok attempts=$attempts speechWait=$speechWait reason=${if (ok) "ok" else "unfocusable"} note=$note")
        if (ok) return
        // 착지 못 했으면 그 자리에서 낭독됐을 라벨을 통지한다(헌장 §5 — 통지가 유일한 증거).
        val text = fallbackText(target)
        if (text.isEmpty()) { log("landingFallback target=$target skipped=emptyText"); return }
        if (!isForeground()) { defer(target, "background", "fallback", note); return }
        log("landingFallback target=$target")
        announceFallback(text)
    }

    private fun defer(target: TransitSheetControl, reason: String, phase: String, note: String) {
        deferred = target
        log("controlFocus target=$target reason=$reason deferred=true phase=$phase note=$note")
    }

    /** 착지를 시도하지 않고 이월만 한다 — 페이지를 닫기 직전에 그 닫힘이 소비할 대상을 세운다(iOS `deferredLanding = .status` 자리). */
    fun defer(target: TransitSheetControl, note: String) {
        deferred = target
        log("controlFocus target=$target reason=modal deferred=true note=$note")
    }

    /** 이월된 착지가 있으면 그것으로 착지하고 true(페이지 닫힘·전경 복귀). 없으면 false — 호출자가 제 자리로 되돌린다. */
    fun landDeferred(note: String): Boolean {
        val target = deferred ?: return false
        deferred = null
        land(target, note, expectsSystemPlacement = true)
        return true
    }

    /** 전경 복귀 — 모델이 복귀 상환을 낸 뒤에 온다(`GuideSession.sheetReturnSeq`). 이월된 착지가 있을 때만. */
    fun onForegroundReturn() {
        landDeferred("deferred")
    }

    /** 국면이 바뀌었다 — 진행 중 착지는 낡은 대상을 좇는다(iOS `controlFocusTask?.cancel()`). 이월 표식은 새 착지가 덮는다. */
    fun cancel() {
        job?.cancel()
        pending = null
    }

    /** 시트 윈도의 접근성 초점 이동 — 그 노드의 고정 표식(모르면 null). 대기 중이면 사용자 이동으로 센다(시스템 배치를 기대한 요청이면 창 안 첫 이동은 제외). */
    fun onA11yFocus(tag: String?) {
        cursorTag = tag
        val p = pending ?: return
        val elapsed = clock() - p.since
        if (!p.systemPlacementSeen && elapsed <= SYSTEM_PLACEMENT_SECONDS) p.systemPlacementSeen = true
        else if (p.movedAfter == null) p.movedAfter = elapsed
    }

    /** 시트 컴포지션이 떠난다(최소화·장소 상세 push) — 대기를 끊고 이월 표식도 버린다(돌아온 시트의 진입 착지가 새 요청이다). */
    fun dispose() {
        job?.cancel()
        pending = null
        deferred = null
    }

    companion object {
        const val SPEECH_WAIT_MS = GuideSheetLanding.SPEECH_WAIT_MS
        const val SYSTEM_PLACEMENT_SECONDS = GuideSheetLanding.SYSTEM_PLACEMENT_SECONDS
        const val POLL_MS = GuideSheetLanding.POLL_MS
        const val LAND_DELAY_MS = GuideSheetLanding.LAND_DELAY_MS
        const val RETRY_DELAY_MS = GuideSheetLanding.RETRY_DELAY_MS
    }
}
