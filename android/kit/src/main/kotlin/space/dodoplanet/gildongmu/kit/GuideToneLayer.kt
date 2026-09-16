package space.dodoplanet.gildongmu.kit

/**
 * 안내 톤 선택(순수 함수, 웹 `src/lib/guide-tone-layer.ts` ↔ Kit `GuideToneLayer.swift` 미러). 공유 fixture
 * `tone-layer-scenarios.json`이 톤 열 일치를 강제한다.
 *
 * **간략·상세가 같은 함수를 쓴다.** 모드 차이는 입력 조립에만 있다 — 두 모드가 각자 계층 로직을 가지면 이 설계가
 * 고치려던 부채(같은 `tick`이 간략에서 정체, 상세에서 생존 하트비트라는 두 뜻)가 형태만 바꿔 남는다.
 *
 * **우선순위 중재기가 아니라 계층 순서다.** 각 단계는 배타적이고, 위 단계가 톤을 내면 아래 단계의 `trendStep`을
 * **호출하지 않는다**. 호출하지 않으므로 앵커·추세·타이머가 갱신되지 않고, 따라서 "억제된 후보의 latch가 커밋되어
 * 다음 fix에서 사라지는" 문제가 구조적으로 성립하지 않는다(2단계 커밋 계약이 불필요하다).
 *
 * ```
 * 1. unreliable    → unreliable 톤(진입 즉시 1회 + 간격 반복)
 * 2. priorityTone  → 그 톤(상세 ahead·warning, 간략 nearby)
 * 3. eventOwned    → 침묵(이벤트가 톤 자리를 소유)
 * 4. trend         → 정지 tick / closer / farther
 * ```
 *
 * ⚠ 배타성은 **추세 앵커가 정지한다**는 뜻이다. 이탈·불확실 구간이 길면 앵커가 낡으므로 복귀 시 재기준화가
 * 필요한데, 복귀하는 fix에서 상위 톤이 나면 그 fix는 추세 축에 닿지 못한다. `needsRebase`를 상태에 두어 **추세
 * 축에 도달하는 첫 fix**가 소비하게 한다.
 *
 * 설계 정본: `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md` §4
 */
data class TrendInput(
    /** 추세 축 거리(간략=목적지 직선거리, 상세=경로 잔여 거리). */
    val distance: Double,
    val deadBand: Double,
    val motion: MotionState,
    /**
     * closer 최소 간격(초). **수단별로 가른다** — 차량은 데드밴드를 매 fix 넘어 2초 창에 매번 걸린다
     * (30분 주행에 약 900회).
     */
    val closerIntervalSeconds: Double,
    /**
     * 시간 감쇠의 하한(§데드밴드 감쇠). 이보다 작은 변화는 어떤 경우에도 추세로 읽지 않는다 — 무한 감쇠는 결국
     * GPS 지터를 톤으로 만든다. 간략은 `accuracy`, 상세는 투영 지터 하한을 준다. 미지정이면 `deadBand`와 같아
     * **감쇠가 없다**(현행 동작).
     */
    val deadBandFloor: Double = deadBand,
)

data class ToneLayerInput(
    /** 1단계: 현재 안내를 신뢰할 수 없다(간략 weak·상세 uncertain/reacquiring·fix 워치독). */
    val unreliable: Boolean = false,
    /** 2단계: 이 fix가 소유한 우선 톤. */
    val priorityTone: BeaconTone? = null,
    /** 3단계: 이벤트가 톤 자리를 소유한다(상세 event 존재). */
    val eventOwned: Boolean = false,
    /**
     * 4단계: 추세 축 입력. **null이면 추세 판정을 하지 않는다** — 이탈 중 잔여 거리는 낡은 투영이라 추세로 읽으면
     * 거짓이고, 투영이 튄 fix도 여기서 버린다.
     */
    val trend: TrendInput? = null,
    /**
     * 도착 종단 — tick·추세·unreliable을 전부 억제한다. 억제하지 않으면 목적지에 서 있는 동안 정지 tick이 계속
     * 난다. **우선 톤은 억제 대상이 아니다.**
     */
    val arrived: Boolean = false,
    /** 호출부가 요구하는 축 재기준화(이탈 복귀·handoff 축 전환). */
    val rebaseTrend: Boolean = false,
)

data class ToneLayerState(
    val anchorDistance: Double? = null,
    val trend: BeaconTrend = BeaconTrend.none,
    val lastTrendToneAt: Double? = null,
    val lastTickAt: Double? = null,
    val lastUnreliableAt: Double? = null,
    val wasUnreliable: Boolean = false,
    /** 추세 축에 도달하는 첫 fix가 소비할 재기준화 예약. */
    val needsRebase: Boolean = false,
    /** 행동 안내(ahead·warning) 후 추세 톤 억제가 끝나는 시각. */
    val quietUntil: Double? = null,
    /** 앵커가 마지막으로 **움직인** 시각. 데드밴드 시간 감쇠의 기준이다. */
    val anchorSetAt: Double? = null,
) {
    companion object {
        val initial = ToneLayerState()
    }
}

object ToneLayerConstants {
    /** 신뢰 불가 지속 중 반복 간격(초). 초기값이며 실사용 판정 대상이다(`maxNormalSilenceSeconds` 이하여야 한다). */
    const val unreliableIntervalSeconds = 10.0

    /** 행동 안내 후 정숙 구간(초). 사용자가 행동해야 하는 안내 직후에 배경 톤이 끼어들면 의미가 흐려진다. */
    const val quietAfterActionSeconds = 3.0

    /** 정지 tick 간격(초). */
    const val tickIntervalSeconds = 3.0

    /**
     * farther 간격(초). **수단별로 가르지 않는다** — 경고 축이기 때문이다(정상 진행 통지와 경고 통지의 빈도
     * 비대칭은 이미 확립된 정책이다).
     */
    const val fartherIntervalSeconds = 2.0
    const val walkCloserIntervalSeconds = 2.0

    /** 차량 closer 간격(초). 초기값이며 실주행 판정 대상이다. */
    const val carCloserIntervalSeconds = 10.0

    /**
     * 허용 최대 정상 침묵(초) = 데드밴드 15m ÷ 느린 구간 0.7m/s. 위원장 판정으로 계약값 확정(2026-08-08) — "이보다
     * 오래 조용하면 고장"이라는 사용자 계약이다.
     * ⚠ 최소 재확인 간격 추가는 **폐기한 하트비트가 이름만 바꿔 돌아오는 것**이라 기각됐고, 데드밴드 축소는 GPS
     * 지터 내성을 깎아 기각됐다. 되살리지 말 것.
     */
    const val maxNormalSilenceSeconds = 21.0

    /**
     * 데드밴드 감쇠 유예(초). **계약값과 같게 둔다** — 그 안에서는 데드밴드가 원값 그대로라 현행 동작이 한 치도
     * 바뀌지 않고, 계약을 넘어선 뒤에만 감쇠가 시작된다.
     */
    const val deadBandGraceSeconds = maxNormalSilenceSeconds

    /** 유예 이후 하한에 도달하기까지의 시간(초). */
    const val deadBandDecaySpanSeconds = 21.0
}

/**
 * 거리 축이 평평할 때의 데드밴드 감쇠(위원장 판정 2026-08-08).
 *
 * **왜 필요한가**: 21초 계약의 산식(데드밴드 ÷ 느린 구간 속도)은 "목적지를 향해 직선으로 이동한다"는 미명시 전제
 * 위에 서 있었다. 목적지와 평행하게 걷거나 블록을 돌아가면 거리가 거의 변하지 않아 `hold`가 무한 지속되고,
 * `moving`이라 정지 tick도 안 난다.
 *
 * **왜 감쇠인가**: 고정 간격 재확인은 "폐기한 하트비트가 이름만 바꿔 돌아오는 것"이고, 정적 축소는 GPS 지터
 * 내성을 처음부터 깎는다 — 위원장이 둘 다 기각했다. 시간 감쇠는 초기 내성을 온전히 유지하면서 **실제 이동이
 * 있으면 결국 톤이 나게** 한다.
 */
fun decayedDeadBand(base: Double, floor: Double, holdSeconds: Double): Double {
    if (!(holdSeconds > ToneLayerConstants.deadBandGraceSeconds) || !(floor < base)) return base
    val progress = minOf(
        1.0,
        (holdSeconds - ToneLayerConstants.deadBandGraceSeconds) / ToneLayerConstants.deadBandDecaySpanSeconds,
    )
    return maxOf(floor, base - (base - floor) * progress)
}

/** 행동 안내 톤 — 정숙 창(`quietAfterActionSeconds`)을 여는 집합. 결정 지점 임박 5종과 이탈 경고. 웹 `isActionTone` 미러. */
fun isActionTone(tone: BeaconTone): Boolean = when (tone) {
    BeaconTone.ahead, BeaconTone.crosswalk, BeaconTone.left, BeaconTone.right, BeaconTone.back, BeaconTone.warning -> true
    BeaconTone.closer, BeaconTone.farther, BeaconTone.nearby, BeaconTone.tick, BeaconTone.start, BeaconTone.stop,
    BeaconTone.unreliable,
    -> false
}

/** `toneLayerStep` 결과(Swift 튜플 `(state, tone)` 대응). */
data class ToneLayerStepResult(val state: ToneLayerState, val tone: BeaconTone?)

fun toneLayerStep(state: ToneLayerState, input: ToneLayerInput, now: Double): ToneLayerStepResult {
    var next = state

    // 1단계 — 신뢰 불가. 도착 후에는 억제한다(목적지에 서 있는 동안 반복 금지).
    if (input.unreliable && !input.arrived) {
        // 진입 즉시 1회가 계약의 핵심이다. 간격 타이머만 두면 GPS 상실 후 최대 `unreliableIntervalSeconds`만큼
        // 침묵해 사용자가 이상을 늦게 안다.
        val due = !state.wasUnreliable ||
            now - (state.lastUnreliableAt ?: Double.NEGATIVE_INFINITY) >= ToneLayerConstants.unreliableIntervalSeconds
        next = next.copy(needsRebase = true, wasUnreliable = true)
        if (!due) return ToneLayerStepResult(next, null)
        return ToneLayerStepResult(next.copy(lastUnreliableAt = now), BeaconTone.unreliable)
    }
    if (state.wasUnreliable) next = next.copy(wasUnreliable = false, needsRebase = true)
    if (input.rebaseTrend) next = next.copy(needsRebase = true)

    // 2단계 — 우선 톤. 행동 안내는 정숙 구간을 연다.
    val priority = input.priorityTone
    if (priority != null) {
        if (isActionTone(priority)) next = next.copy(quietUntil = now + ToneLayerConstants.quietAfterActionSeconds)
        // 이탈 구간의 잔여 거리는 낡은 투영이라 앵커가 낡는다.
        if (priority == BeaconTone.warning) next = next.copy(needsRebase = true)
        return ToneLayerStepResult(next, priority)
    }

    // 3단계 — 이벤트가 톤 자리를 소유.
    if (input.eventOwned) return ToneLayerStepResult(next, null)

    // 4단계 — 추세 축.
    val until = next.quietUntil
    if (until != null && now < until) return ToneLayerStepResult(next, null)
    val t = input.trend
    if (t == null || input.arrived) return ToneLayerStepResult(next, null)

    if (next.needsRebase) {
        next = next.copy(needsRebase = false, anchorDistance = t.distance, anchorSetAt = now)
        // 회복 즉시 1회: 데드밴드 미달이어도 현재 상태를 알린다. 없으면 사용자가 회복 여부를 모른 채 최대
        // `maxNormalSilenceSeconds`를 더 기다린다.
        if (t.motion == MotionState.stopped) return ToneLayerStepResult(next.copy(lastTickAt = now), BeaconTone.tick)
        return when (next.trend) {
            BeaconTrend.closer -> ToneLayerStepResult(next.copy(lastTrendToneAt = now), BeaconTone.closer)
            BeaconTrend.farther -> ToneLayerStepResult(next.copy(lastTrendToneAt = now), BeaconTone.farther)
            BeaconTrend.none -> ToneLayerStepResult(next, null) // 승계할 추세가 없으면 앵커만 잡는다
        }
    }

    // 4.5 추세 축 내부 순서 — 정지가 먼저다.
    if (t.motion == MotionState.stopped) {
        if (!(now - (state.lastTickAt ?: Double.NEGATIVE_INFINITY) >= ToneLayerConstants.tickIntervalSeconds)) {
            return ToneLayerStepResult(next, null)
        }
        return ToneLayerStepResult(next.copy(lastTickAt = now), BeaconTone.tick)
    }
    // ⚠ `speedUnknown`에서는 tick을 내지 않는다(속도를 모르는데 정지 톤은 거짓이다).
    // 침묵이 늘지만 거짓 정지보다 낫고, 지속되면 fix 워치독이 unreliable로 잡는다.

    // 앵커가 오래 제자리면 데드밴드를 점진 축소한다(평평한 거리 축의 무한 침묵 차단).
    val band = decayedDeadBand(t.deadBand, t.deadBandFloor, now - (next.anchorSetAt ?: now))
    val previousAnchor = next.anchorDistance
    val stepped = trendStep(previousAnchor, next.trend, t.distance, band)
    next = next.copy(anchorDistance = stepped.anchor, trend = stepped.trend)
    // ⚠ 앵커가 **처음 설정되는** 경우도 포함해야 한다(그때 `kind`는 hold다). `kind != hold`로만 갱신하면 기준이
    // 영영 null로 남아 감쇠가 작동하지 않는다 — 계약 테스트가 이 구멍을 잡았다.
    if (stepped.anchor != previousAnchor) next = next.copy(anchorSetAt = now)
    val (tone, interval) = when (stepped.kind) {
        TrendKind.closer -> BeaconTone.closer to t.closerIntervalSeconds
        TrendKind.farther -> BeaconTone.farther to ToneLayerConstants.fartherIntervalSeconds
        // `moving`인데 데드밴드 미달인 침묵은 허용한다 — 직전 톤이 상태를 이미 알렸고, 여기를 채우면 도보에서
        // 2초마다 소리가 나 빈도 절제와 충돌한다.
        TrendKind.hold -> return ToneLayerStepResult(next, null)
    }
    if (!(now - (state.lastTrendToneAt ?: Double.NEGATIVE_INFINITY) >= interval)) return ToneLayerStepResult(next, null)
    return ToneLayerStepResult(next.copy(lastTrendToneAt = now), tone)
}
