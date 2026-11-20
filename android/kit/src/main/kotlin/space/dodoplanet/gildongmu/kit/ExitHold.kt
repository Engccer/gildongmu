package space.dodoplanet.gildongmu.kit

// ── 출구 대기(E84, spec 2026-11-14-transit-exit-carryover-design) — Kit `ExitHold.swift` 미러 ──
// 지하철 말미 도보 인계가 출구 번호를 실어 왔을 때, 도보 세션의 시작 경로 조회 대기 창을 「역 밖으로 나와 위치가 제대로
// 잡힐 때까지」로 늘린다. **창을 닫는 축은 벽시계가 아니라 증거(최근 fix)와 사용자 선언(버튼)이다.** 판정은 전부 이 파일의
// 순수 함수이고 공유 fixture `exit-hold-cases.json`이 잠근다.

/**
 * 창이 이만큼 열려 있었고(잠정) 보관 가능한 fix가 최근 창 길이 이상 이어졌는데도 수용 정확도에 들지 못하면 최근 창의
 * 최선값으로 조회한다. fix가 아예 없으면 이 상한은 걸리지 않는다(깊은 역사를 걷는 중일 수 있다).
 */
const val exitHoldMaxSeconds = 240.0

/** 상한에서 쓸 최선값 후보의 창(초). 창 전체의 최선값은 몇 분 전 승강장 좌표일 수 있다. */
const val exitHoldRecentWindowSeconds = 15.0

/** 창 안 첫 보관 가능 fix가 하차역에서 이 거리 + 정확도보다 멀면 다른 역에서 내린 것으로 보고 출구 대기를 버린다(잠정). */
const val exitHoldStationMaxMeters = 600.0

/** 단독 출구 통지를 게시한 뒤 이 시간 안에 나가는 시작류 통지는 출구 문장을 접두로 다시 싣는다(잠정). 발화 끝 신호에 걸지 않는다. */
const val exitLeadRepeatWindowSeconds = 4.0

/** 창 동안 잊힌 세션 안전망의 fix 두절 임계(초, 잠정). `GuideTuning.sessionIdleNoFixExitHoldSeconds`가 싣는다. */
const val exitHoldSessionIdleNoFixSeconds = 900.0

/** 창 안에서 fix가 이만큼 끊겼다가 다시 오면 「관측 공백」으로 본다(초, 잠정): 그 fix가 무이동 시계를 다시 세운다. */
const val exitHoldObservationGapSeconds = 30.0

/** 창 안에서 받은 보관 가능 fix 하나와 받은 시각(단조 초). */
data class ExitHoldSample(val fix: RouteOriginFix, val at: Double)

enum class ExitHoldFetchReason {
    /** 수용 정확도·나이를 통과한 fix(역 밖으로 나온 것으로 본다). */
    accepted,

    /** 상한에 닿아 최근 창의 최선값으로. */
    recentBest;

    val rawValue: String get() = name
}

sealed class ExitHoldDecision {
    /** 계속 기다린다. */
    data object Wait : ExitHoldDecision()

    /** 이 좌표로 지금 조회한다. */
    data class Fetch(val fix: RouteOriginFix, val reason: ExitHoldFetchReason) : ExitHoldDecision()

    /** 하차역 근처가 아니다 — 출구 대기를 버리고 종전 시작 흐름으로. */
    data object Abandon : ExitHoldDecision()
}

/** 보관 가능한 fix인가(창의 표본·「첫 fix」 판정이 같은 술어를 쓴다). */
fun exitHoldStorable(fix: RouteOriginFix): Boolean = isStorableFix(accuracy = fix.accuracy, age = fix.ageSeconds)

/** 최근 창(`exitHoldRecentWindowSeconds`) 안 표본 중 가장 정확한 것. 나이는 소비 시점 기준으로 더한다. */
fun exitHoldRecentBest(samples: List<ExitHoldSample>, now: Double): RouteOriginFix? {
    var best: ExitHoldSample? = null
    for (sample in samples) {
        if (now - sample.at >= 0 && now - sample.at <= exitHoldRecentWindowSeconds) {
            if (isBetterFix(sample.fix.accuracy, best?.fix?.accuracy)) best = sample
        }
    }
    val chosen = best ?: return null
    return chosen.fix.copy(ageSeconds = chosen.fix.ageSeconds + (now - chosen.at))
}

/**
 * 출구 대기 창의 fix 한 건 판정.
 *
 * - `elapsed`: 창이 열린 뒤 경과(초).
 * - `isFirstStorable`: 이 fix가 창 안에서 처음 받은 보관 가능 fix인가(다른 역 판정은 그 한 번만 한다).
 * - `stationDistance`: 이 fix에서 하차역까지 직선 거리(m). 역 좌표를 모르면 null(다른 역 판정을 하지 않는다).
 * - `recent`: 이 fix를 **포함한** 창 안 표본.
 * - `storableSince`: 이 fix가 속한 보관 가능 fix 연속 구간의 첫 표본 시각(`exitHoldStorableRunStart`). 보관 불가면 null.
 *
 * 순서가 계약이다: 보관 불가 → 대기 / 다른 역 → 포기 / 수용 → 조회 /
 * 상한(창 240초 ∧ 연속 구간 15초 이상) → 최근 최선값 조회 / 그 밖 → 대기.
 */
fun exitHoldStep(
    elapsed: Double,
    fix: RouteOriginFix,
    isFirstStorable: Boolean,
    stationDistance: Double?,
    recent: List<ExitHoldSample>,
    storableSince: Double?,
    now: Double,
): ExitHoldDecision {
    if (!exitHoldStorable(fix)) return ExitHoldDecision.Wait
    if (isFirstStorable && stationDistance != null && stationDistance.isFinite() &&
        stationDistance > exitHoldStationMaxMeters + fix.accuracy
    ) {
        return ExitHoldDecision.Abandon
    }
    val accepted = routeOriginStep(best = null, fix = fix)
    if (accepted is RouteOriginDecision.Fetch) {
        return ExitHoldDecision.Fetch(accepted.fix, ExitHoldFetchReason.accepted)
    }
    if (elapsed >= exitHoldMaxSeconds && storableSince != null && now - storableSince >= exitHoldRecentWindowSeconds) {
        val best = exitHoldRecentBest(samples = recent, now = now)
        if (best != null) return ExitHoldDecision.Fetch(best, ExitHoldFetchReason.recentBest)
    }
    return ExitHoldDecision.Wait
}

/**
 * 시작류 통지(시작 요약·간략 강등 문장)에 출구 문장을 접두로 다시 실을 것인가. 단독 통지가 버려졌거나(억제·백그라운드)
 * 게시한 지 `exitLeadRepeatWindowSeconds`가 안 됐으면 참. `secondsSincePosted` null = 아직 게시하지 못했다.
 */
fun exitLeadPrefixNeeded(hasExit: Boolean, dropped: Boolean, secondsSincePosted: Double?): Boolean {
    if (!hasExit) return false
    if (dropped) return true
    if (secondsSincePosted == null) return true
    return secondsSincePosted < exitLeadRepeatWindowSeconds
}

/**
 * 보관 가능 fix 연속 구간의 시작 시각. 직전 보관 가능 표본과의 간격이 최근 창을 넘으면 구간이 끊긴 것으로 보고 이 fix에서
 * 새로 시작한다(`previousSampleAt` null = 첫 표본).
 */
fun exitHoldStorableRunStart(previousStart: Double?, previousSampleAt: Double?, now: Double): Double {
    if (previousStart == null || previousSampleAt == null ||
        !(now - previousSampleAt >= 0) || !(now - previousSampleAt <= exitHoldRecentWindowSeconds)
    ) {
        return now
    }
    return previousStart
}

// ── 창과 잊힌 세션 안전망(`SessionIdle.kt`) ──
// 안전망의 두 시계(fix 두절·무이동)는 「마지막 fix」「마지막 진행」에서 잰다. 출구 대기 창은 그 전제를 둘 깬다: 지하 통로에서
// 끊겼다가 처음 오는 fix는 진행으로 치지 않아 무이동 시계가 세션 시작부터 흐른 것으로 읽히고, 창이 닫히며 두절 임계가
// 900초에서 300초로 돌아오면 창 안에서 흐른 시간이 곧바로 임계를 넘는다. 그래서 시계의 **하한**을 둔다.

/** 안전망 시계의 하한. null = 하한 없음(종전 동작). */
data class ExitHoldIdleFloors(
    /** fix 두절 시계의 하한(창이 닫힌 시각). */
    val fix: Double? = null,
    /** 무이동 시계의 하한(창이 닫힌 시각 또는 관측 공백 뒤 첫 fix). */
    val progress: Double? = null,
)

/** `exitHoldIdleFloorsAfterFix` 결과(Swift 튜플 `(floors:, resumed:)`). */
data class ExitHoldIdleFloorsAfterFixResult(val floors: ExitHoldIdleFloors, val resumed: Boolean)

/**
 * 창 안 fix 한 건. 직전 fix(없으면 세션 시작)와의 간격이 `exitHoldObservationGapSeconds`를 넘고 **그 fix가 진행 앵커에서
 * 벗어났을 때만**(앵커가 아직 없거나 `sessionProgressEpsilonMeters` 이상) 무이동 시계를 이 fix로 다시 세운다. `resumed`가
 * 참이면 호출부는 진행 앵커도 이 fix로 재설정한다.
 * ⚠ 같은 자리의 공백 뒤 fix로는 세우지 않는다: 30초 넘는 간격으로 드문드문 오는 제자리 fix마다 시계가 다시 서면 세션이
 * 영영 끝나지 않는다. `distanceFromAnchor` null = 앵커 없음(세션 첫 fix).
 */
fun exitHoldIdleFloorsAfterFix(
    floors: ExitHoldIdleFloors,
    now: Double,
    previousFixAt: Double?,
    startedAt: Double,
    distanceFromAnchor: Double?,
): ExitHoldIdleFloorsAfterFixResult {
    val gap = now - maxOf(startedAt, previousFixAt ?: startedAt)
    if (!(gap > exitHoldObservationGapSeconds)) return ExitHoldIdleFloorsAfterFixResult(floors, false)
    if (distanceFromAnchor != null && distanceFromAnchor < sessionProgressEpsilonMeters) {
        return ExitHoldIdleFloorsAfterFixResult(floors, false)
    }
    return ExitHoldIdleFloorsAfterFixResult(floors.copy(progress = now), true)
}

/** 창이 닫히는 순간: 두 시계가 그 시각부터 새로 흐른다. */
fun exitHoldIdleFloorsAfterClose(now: Double): ExitHoldIdleFloors = ExitHoldIdleFloors(fix = now, progress = now)

/** 안전망 시계의 기준 시각. `floor` null이면 종전 식(`max(startedAt, last ?: startedAt)`)과 같다. */
fun sessionIdleReference(startedAt: Double, last: Double?, floor: Double?): Double =
    maxOf(startedAt, last ?: startedAt, floor ?: startedAt)

/**
 * 도보·자동차 세션의 안전망 판정 한 자리(워치독 틱마다). 출구 대기가 없던 세션(`floors` 비어 있음 ∧ `holdActive` 거짓)은
 * 종전 식과 값이 같다. 창 동안은 ① 두절 임계가 `sessionIdleNoFixExitHoldSeconds`이고 ② 지금 관측이 끊겨 있으면(마지막 fix 뒤
 * `exitHoldObservationGapSeconds` 초과) 무이동을 세지 않는다 — 무이동은 fix가 와야 관측된다.
 */
fun exitHoldAwareSessionIdleStep(
    now: Double,
    startedAt: Double,
    lastFixAt: Double?,
    lastProgressAt: Double?,
    floors: ExitHoldIdleFloors,
    holdActive: Boolean,
    tuning: GuideTuning,
    presumedArrivalCanFire: Boolean,
): SessionIdleReason? {
    val sinceFix = now - sessionIdleReference(startedAt = startedAt, last = lastFixAt, floor = floors.fix)
    val sinceProgress = now - sessionIdleReference(startedAt = startedAt, last = lastProgressAt, floor = floors.progress)
    val stationary: Double? = if (!tuning.sessionIdleStationaryAxis) {
        null
    } else if (holdActive && sinceFix > exitHoldObservationGapSeconds) {
        0.0
    } else {
        sessionIdleStationaryElapsed(secondsSinceProgress = sinceProgress, presumedArrivalCanFire = presumedArrivalCanFire)
    }
    return sessionIdleStep(
        secondsSinceUsableFix = sinceFix,
        secondsSinceProgress = stationary,
        noFixSeconds = if (holdActive) tuning.sessionIdleNoFixExitHoldSeconds else tuning.sessionIdleNoFixSeconds,
    )
}
