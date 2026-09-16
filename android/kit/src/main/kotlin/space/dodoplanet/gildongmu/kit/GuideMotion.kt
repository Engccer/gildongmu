package space.dodoplanet.gildongmu.kit

/**
 * 이동·정지 판정(순수 함수, 웹 `src/lib/guide-motion.ts` ↔ Kit `GuideMotion.swift` 미러).
 *
 * **왜 3-state인가**: "속도를 모름"은 "정지"도 "이동"도 아니다. 이진화하면 GPS가 속도를 못 줄 때 거짓 정지
 * tick이 나고, 시각장애 사용자는 화면으로 반증할 수 없다.
 *
 * **왜 도플러 속도인가**: 상세 모드에는 경로 진행거리 미분(`GuideSpeedSample`)이 있으나 간략 모드에는 경로가
 * 없다. 직선거리를 미분하는 대안은 틀린다 — 그것은 "목적지 접근 속도"이지 "이동 속도"가 아니라서, 목적지를
 * 옆으로 지나쳐 걸으면 직선거리가 거의 안 변해도 실제로는 이동 중이다. 도플러 속도는 경로와 목적지 양쪽에
 * 독립이라 두 모드에 같은 판정을 쓸 수 있는 유일한 축이다.
 *
 * ⚠ 기존 속도 표본 기계(`speedGuardActive` 등)는 **건드리지 않는다.** 그것은 "속도 빠름" 오판 가드라는 다른
 * 목적을 가진다.
 *
 * 설계 정본: `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md` §5
 */
enum class MotionState { stopped, moving, speedUnknown }

data class MotionSample(
    val lat: Double,
    val lng: Double,
    /** 수평 정확도(m). 0 이하·NaN은 좌표 무효 신호. */
    val accuracy: Double,
    /** 단조 시각(초). */
    val at: Double,
)

data class MotionJudgeState(
    val isStopped: Boolean,
    /** 정지 임계 미만이 시작된 시각. null이면 계측 중이 아니다. */
    val belowSince: Double?,
    val lastSample: MotionSample?,
) {
    companion object {
        val initial = MotionJudgeState(isStopped = false, belowSince = null, lastSample = null)
    }
}

object MotionConstants {
    /**
     * 이 값 **미만**이 `stopEnterHoldSeconds` 이상 지속되면 정지 진입.
     *
     * 위원장 판정(2026-08-08): 기준은 **비장애 보행 속도의 90%**다. 평상 보행 1.3 × 0.9 = 1.17m/s, 느린
     * 구간(혼잡·계단·경사로·장애물 탐색)은 그 60%인 0.7m/s이고, 이 값은 그 57%라 정상 보행 중 가장 느린
     * 구간보다 확실히 아래다.
     *
     * ⚠ 초판의 0.5m/s와 그 근거("보행 최저 0.8~1.0m/s")는 **철회됐다** — 비장애 보행 *평균*을 최저값으로
     * 잘못 옮긴 것이었고, 이 앱의 1급 사용자에게는 틀린 전제였다(흰지팡이 탐색 보행을 정지로 오판했을 값이다).
     * 재계산 금지.
     */
    const val stopEnterMps = 0.4

    /**
     * 이 값 **초과**면 즉시 이동. 진입보다 높다 — 정지 오판은 계속 들리는 거짓 tick을 만들고 이동 오판은
     * 한 번의 침묵으로 끝난다(비대칭이 의도).
     */
    const val stopExitMps = 0.6

    /** 신호 대기 같은 실제 정지는 이 시간을 넘고, 보행 중 순간 감속은 넘지 않는다. */
    const val stopEnterHoldSeconds = 2.0

    /**
     * `speedAccuracy` 신뢰 상한(m/s). ⚠ **음수 여부만으로 신뢰도를 판정하지 않는다** — `speed = 0.2`인데
     * 정확도가 매우 크면 그 값은 정지 근거가 못 된다.
     */
    const val speedAccuracyCeiling = 1.0

    /**
     * 거리 미분 폴백의 최소 간격(초). 더 짧으면 GPS 지터가 속도로 증폭된다(40m 정확도의 두 fix가 1초에
     * 20m 흔들리면 20m/s).
     */
    const val fallbackMinIntervalSeconds = 1.0

    /** 최대 간격(초). 더 길면 실제 이동이 평균화되어 정지로 보인다. */
    const val fallbackMaxIntervalSeconds = 5.0

    /** 폴백에 쓸 수 있는 fix 정확도 상한(m). */
    const val fallbackMaxAccuracyMeters = 20.0

    /** 물리 상한(m/s) — 이를 넘는 산출 속도는 이동이 아니라 GPS 점프다. */
    const val maxWalkSpeedMps = 8.0
    const val maxCarSpeedMps = 60.0
}

/** `motionStep` 결과(Swift 튜플 `(state, motion)` 대응). */
data class MotionStepResult(val state: MotionJudgeState, val motion: MotionState)

/**
 * 한 fix의 이동 상태를 판정한다.
 *
 * `speed`·`speedAccuracy`가 nullable인 것은 웹과의 계약 통일 때문이다 — 웹 `GeolocationCoordinates.speed`는
 * 무효일 때 **`null`**이고 음수 sentinel이 아니라, `speed < 0` 분기를 그대로 옮기면 `null`이 0으로 암묵
 * 변환되어 거짓 정지가 난다.
 *
 * ⚠ 안드로이드 `Location`은 값이 없을 때 음수가 아니라 **0.0**을 준다. `hasSpeed()`가 거짓이면 `speed`에,
 * `hasSpeedAccuracy()`가 거짓이면 `speedAccuracy`에 0.0이 아니라 null을 넘긴다 — 0.0을 넘기면 도플러가 신뢰
 * 조건을 통과해 걷는 중에도 거짓 정지 tick이 난다.
 */
fun motionStep(
    state: MotionJudgeState,
    sample: MotionSample,
    speed: Double?,
    speedAccuracy: Double?,
    maxSpeedMps: Double,
): MotionStepResult {
    val velocity = resolveSpeed(state, sample, speed, speedAccuracy, maxSpeedMps)
    // 폴백에 쓸 수 없는 정확도의 표본은 기준을 덮지 않는다 — 덮으면 다음 fix까지 강제로 speedUnknown이 되어
    // 침묵이 fix 하나만큼 더 길어진다. 낡은 기준은 간격 상한이 알아서 걸러낸다.
    val lastSample =
        if (sample.accuracy > 0 && sample.accuracy <= MotionConstants.fallbackMaxAccuracyMeters) sample else state.lastSample
    val next = state.copy(lastSample = lastSample)

    if (velocity == null) {
        // 모르는 구간을 정지로 셈하면 그 사이 이동이 정지로 굳는다.
        return MotionStepResult(next.copy(belowSince = null), MotionState.speedUnknown)
    }

    if (state.isStopped) {
        if (velocity > MotionConstants.stopExitMps) {
            return MotionStepResult(next.copy(isStopped = false, belowSince = null), MotionState.moving)
        }
        return MotionStepResult(next, MotionState.stopped)
    }

    if (!(velocity < MotionConstants.stopEnterMps)) {
        return MotionStepResult(next.copy(belowSince = null), MotionState.moving)
    }
    val since = state.belowSince ?: sample.at
    if (sample.at - since >= MotionConstants.stopEnterHoldSeconds) {
        return MotionStepResult(next.copy(belowSince = since, isStopped = true), MotionState.stopped)
    }
    return MotionStepResult(next.copy(belowSince = since), MotionState.moving)
}

/** 채택할 속도(m/s). 도플러 우선, 조건 불충족 시 거리 미분 폴백, 둘 다 불가면 null. */
private fun resolveSpeed(
    state: MotionJudgeState,
    sample: MotionSample,
    speed: Double?,
    speedAccuracy: Double?,
    maxSpeedMps: Double,
): Double? {
    if (speed != null && speed >= 0 && speed.isFinite()) {
        // ⚠ 정확도는 3-state다: 좋음 / 나쁨 / **모름**. null은 플랫폼이 그 축을 제공하지 않는다는 뜻이고
        // (웹 `GeolocationCoordinates`에는 speedAccuracy가 없다), 그것을 "나쁨"으로 뭉개면 그 플랫폼에서
        // 도플러가 절대 성립하지 않아 `tick`(정지)이 죽은 소리가 된다. 값이 있는데 무효이거나 상한을 넘는
        // 경우만 도플러를 버린다.
        if (speedAccuracy == null) return speed
        if (speedAccuracy >= 0 && speedAccuracy.isFinite() && speedAccuracy <= MotionConstants.speedAccuracyCeiling) {
            return speed
        }
    }
    val prev = state.lastSample ?: return null
    val dt = sample.at - prev.at
    if (!(dt >= MotionConstants.fallbackMinIntervalSeconds) ||
        !(dt <= MotionConstants.fallbackMaxIntervalSeconds) ||
        !(prev.accuracy > 0) || !(prev.accuracy <= MotionConstants.fallbackMaxAccuracyMeters) ||
        !(sample.accuracy > 0) || !(sample.accuracy <= MotionConstants.fallbackMaxAccuracyMeters)
    ) {
        return null
    }
    val meters = haversineMeters(prev.lat, prev.lng, sample.lat, sample.lng)
    if (!meters.isFinite()) return null
    val v = meters / dt
    if (!(v <= maxSpeedMps)) return null
    return v
}
