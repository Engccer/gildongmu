package space.dodoplanet.gildongmu.kit

import kotlin.math.abs

/**
 * 목적지 거리 비콘의 순수 판정 리듀서. 웹 `src/lib/beacon.ts` ↔ Kit `Beacon.swift` 미러.
 *
 * 매 GPS fix마다 호출돼 (1) 직선거리 (2) accuracy로 스케일한 데드밴드 기준 추세 (3) 도착 임박 (4) 음성 발화
 * 여부를 정한다. "무엇을 알릴지"만 정하고 "어떻게 소리낼지"(톤·throttle)는 `BeaconGate`, I/O는 앱 계층 몫이다.
 *
 * accuracy 스케일링이 이 리듀서의 전부다. 정확도 나쁜 지역일수록 데드밴드를 키워 GPS jitter로 추세가
 * 뒤집히는 것을 칼만 필터 없이 억제한다. 빠지면 걷는 내내 "가까워짐"과 "멀어짐"이 번갈아 난다.
 */
data class BeaconFix(
    val lat: Double,
    val lng: Double,
    /** 미터. **0 이하·NaN은 좌표 무효** 신호다(iOS `horizontalAccuracy`는 음수로 무효를 알린다). */
    val accuracy: Double,
)

data class BeaconDest(val lat: Double, val lng: Double)

enum class BeaconTrend { none, closer, farther }

enum class AnnounceKind { first, closer, farther, hold, nearby, weak }

data class BeaconState(
    /** 추세 판정 기준 거리. 첫 수용 fix 전엔 null. */
    val anchorDistance: Double?,
    val trend: BeaconTrend,
    /** 마지막으로 음성 발화한 거리(마일스톤 throttle 기준). */
    val lastSpokenDistance: Double?,
    /** 도착 임박 존 래치. */
    val nearby: Boolean,
) {
    companion object {
        val initial = BeaconState(anchorDistance = null, trend = BeaconTrend.none, lastSpokenDistance = null, nearby = false)
    }
}

data class BeaconAnnounce(
    val kind: AnnounceKind,
    /** 목적지까지 직선거리(m). weak이면 0일 수 있다. */
    val distance: Double,
    /** 해당 fix의 accuracy(m). nearby 통지의 ±값으로 쓰인다. */
    val accuracy: Double,
    /** 음성 발화 여부(톤과 별개). */
    val speak: Boolean,
)

object BeaconConstants {
    const val maxUsableAccuracy = 100.0
    const val baseDeadBand = 15.0
    const val arrivalBase = 20.0
    const val speakInterval = 50.0

    /** fix 신선도 창(초). 이보다 오래된(또는 미래인) fix는 앵커에 반영하지 않는다. */
    const val freshnessWindow = 5.0
}

/**
 * closer 발화 마일스톤(잔여 거리 적응형, 위원장 실측 판정 2026-08-03). 웹 `closerSpeakIntervalM` 미러.
 * 정상 진행(가까워짐)은 알림 가치가 낮고 추세 톤이 이미 연속 신호를 주므로 멀수록 성기게 발화한다.
 * farther는 경고라 50m 간격을 유지한다 — 두 축의 비대칭이 정책이다.
 */
fun closerSpeakInterval(distance: Double): Double {
    if (distance > 5000) return 1000.0
    if (distance > 1000) return 500.0
    if (distance > 300) return 200.0
    return 100.0
}

/**
 * fix를 앵커·추세에 반영해도 되는지. **캐시 위치와 무효 좌표를 배제한다.**
 *
 * 위치 갱신의 첫 콜백은 흔히 캐시라, 그대로 앵커를 잡으면 수백 m 어긋난 기준이 서고 진짜 fix가 오는 순간
 * 거짓 추세가 발화된다. `abs`는 기기 시계 보정으로 timestamp가 미래로 튀는 경우를 함께 거른다(미래 fix도
 * 신뢰할 근거가 없다).
 */
fun isUsableFix(accuracy: Double, ageSeconds: Double, maxAge: Double = BeaconConstants.freshnessWindow): Boolean =
    accuracy > 0 && abs(ageSeconds) <= maxAge

enum class TrendKind { closer, farther, hold }

/**
 * 거리 축이 바뀔 때(상세 경로 거리 ⇄ 간략 직선거리)의 재기준화. 웹 `rebaseBeaconState` 미러.
 *
 * 값이 **불연속으로** 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만 승계하고 `anchorDistance`와
 * `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로 재설정한다.
 *
 * ⚠ `lastSpokenDistance`를 옛 축 값(500m)으로 두면 새 축 현재값(120m)과의 차이 380m가 즉시 마일스톤을 넘겨
 * **전환 직후 거짓 closer 음성**이 나가고, 반대 방향 전환에서는 필요한 음성이 장기 억제된다.
 *
 * 새 축의 현재값을 모르면(낡은 fix) null이 정직한 폴백이다 — 다음 fix가 first 경로를 타서 절대거리를
 * 1회 발화하고 다시 추세를 잡는다.
 */
fun rebaseBeaconState(state: BeaconState, distance: Double?): BeaconState =
    BeaconState.initial.copy(trend = state.trend, anchorDistance = distance, lastSpokenDistance = distance)

/** `trendStep` 결과(Swift 튜플 `(kind, anchor, trend)` 대응). */
data class TrendStepResult(val kind: TrendKind, val anchor: Double?, val trend: BeaconTrend)

/**
 * 데드밴드 기준 추세 판정(순수, 상태 미커밋). 간략(직선거리)과 상세(경로 잔여 거리)가 **같은 판정을 공유하는
 * 유일한 지점**이다.
 *
 * ⚠ 리듀서(`beaconStep`) 전체를 상세에 재사용하는 안은 폐기됐다: 그 리듀서는 추세 판정 외에 도착 판정·정확도
 * 게이트(100m)·음성 마일스톤을 함께 소유하는데 셋 다 상세와 충돌한다.
 *
 * 호출부가 결과를 채택할지 결정한다 — 앵커·추세는 반환값일 뿐 여기서 저장하지 않는다.
 */
fun trendStep(anchor: Double?, trend: BeaconTrend, distance: Double, deadBand: Double): TrendStepResult {
    if (anchor == null) return TrendStepResult(TrendKind.hold, distance, trend)
    if (distance <= anchor - deadBand) return TrendStepResult(TrendKind.closer, distance, BeaconTrend.closer)
    if (distance >= anchor + deadBand) return TrendStepResult(TrendKind.farther, distance, BeaconTrend.farther)
    return TrendStepResult(TrendKind.hold, anchor, trend)
}

/** `beaconStep` 결과(Swift 튜플 `(state, announce)` 대응). */
data class BeaconStepResult(val state: BeaconState, val announce: BeaconAnnounce)

fun beaconStep(state: BeaconState, fix: BeaconFix, dest: BeaconDest): BeaconStepResult {
    val distance = haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng)

    // 신호 약함/무효: 추세·앵커 불변(상태 그대로 반환).
    // `!(accuracy > 0)`은 NaN·0·음수를 한 번에 거른다. 음수는 "좌표 무효" 신호이고, 통과시키면
    // deadBand = max(15, -1) = 15가 되어 쓰레기 좌표가 앵커를 잡는다(웹 가드도 같은 조건).
    if (!distance.isFinite() || !(fix.accuracy > 0) || fix.accuracy > BeaconConstants.maxUsableAccuracy) {
        return BeaconStepResult(
            state,
            BeaconAnnounce(
                kind = AnnounceKind.weak,
                distance = if (distance.isFinite()) distance else 0.0,
                accuracy = if (fix.accuracy.isFinite()) fix.accuracy else 0.0,
                speak = false,
            ),
        )
    }

    val deadBand = maxOf(BeaconConstants.baseDeadBand, fix.accuracy)
    val arrivalThreshold = maxOf(BeaconConstants.arrivalBase, fix.accuracy)

    // 첫 수용 fix: 앵커 설정 + 첫 안내(도착 존이면 nearby).
    val anchor = state.anchorDistance
    if (anchor == null) {
        if (distance <= arrivalThreshold) {
            return BeaconStepResult(
                BeaconState(anchorDistance = distance, trend = BeaconTrend.none, lastSpokenDistance = distance, nearby = true),
                BeaconAnnounce(AnnounceKind.nearby, distance, fix.accuracy, speak = true),
            )
        }
        return BeaconStepResult(
            BeaconState(anchorDistance = distance, trend = BeaconTrend.none, lastSpokenDistance = distance, nearby = false),
            BeaconAnnounce(AnnounceKind.first, distance, fix.accuracy, speak = true),
        )
    }

    // 도착 임박(래치): 존 진입 시 1회만 발화, 머무는 동안 침묵.
    if (distance <= arrivalThreshold) {
        val wasNearby = state.nearby
        return BeaconStepResult(
            BeaconState(anchorDistance = distance, trend = BeaconTrend.none, lastSpokenDistance = distance, nearby = true),
            BeaconAnnounce(AnnounceKind.nearby, distance, fix.accuracy, speak = !wasNearby),
        )
    }

    // 래치 해제는 threshold + deadBand를 넘어야 한다(히스테리시스). 그 전엔 hold 침묵.
    if (state.nearby && distance <= arrivalThreshold + deadBand) {
        return BeaconStepResult(
            state.copy(nearby = true),
            BeaconAnnounce(AnnounceKind.hold, distance, fix.accuracy, speak = false),
        )
    }

    // 여기부터 nearby 해제 상태에서 추세 판정(공용 `trendStep` — 상세 모드와 같은 축).
    val stepped = trendStep(anchor, state.trend, distance, deadBand)
    val trend = stepped.trend
    val newAnchor = stepped.anchor ?: anchor
    val kind = when (stepped.kind) {
        TrendKind.closer -> AnnounceKind.closer
        TrendKind.farther -> AnnounceKind.farther
        TrendKind.hold -> AnnounceKind.hold // 추세·앵커 불변
    }

    val trendFlipped = kind != AnnounceKind.hold && state.trend != BeaconTrend.none && kind != announceKindOf(state.trend)
    val lastSpoken = state.lastSpokenDistance ?: distance
    val interval = if (kind == AnnounceKind.closer) closerSpeakInterval(distance) else BeaconConstants.speakInterval
    val milestone = abs(distance - lastSpoken) >= interval
    val speak = kind != AnnounceKind.hold && (trendFlipped || milestone)

    return BeaconStepResult(
        BeaconState(
            anchorDistance = newAnchor,
            trend = trend,
            lastSpokenDistance = if (speak) distance else state.lastSpokenDistance,
            nearby = false,
        ),
        BeaconAnnounce(kind, distance, fix.accuracy, speak),
    )
}

/** 추세를 같은 축의 AnnounceKind로 사상한다(웹은 두 값이 같은 문자열이라 직접 비교했다). */
private fun announceKindOf(trend: BeaconTrend): AnnounceKind? = when (trend) {
    BeaconTrend.closer -> AnnounceKind.closer
    BeaconTrend.farther -> AnnounceKind.farther
    BeaconTrend.none -> null
}
