package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable

/**
 * 승차 중 현재역 — 실시간 열차 위치의 **표시 전용** 순수 계층(E35, spec `2026-09-23-riding-current-station-design.md` §4).
 * 웹 `src/lib/transit-riding-position.ts` ↔ Kit `TransitRidingPosition.swift` 1:1 미러이고 공유 fixture
 * (`transit-riding-position-cases.json`)가 동조를 강제한다.
 *
 * ⚠ 이 상태는 승차 상태 머신(`TransitGuide.kt` 리듀서) **밖**에 있다. 리듀서는 이 파일을 모르고, 도착·승격·하차·neverSeen
 * 판정은 도착 API가 한다(판정서 2026-08-23 §3). 위치는 화면·문장의 "현재 위치"만 채운다.
 *
 * 불변식: 표식은 "있다"만 주장한다. 조인 실패·결측·조회 실패·동결은 모두 표식 부재로 나가고(새 문구 없음), 사유는 계측 로그가 가른다.
 */

/** 결박 하나(riding 진입 × 열차)당 위치 조회 상한의 하한 — 60초 주기로 30분. ⚠ 잠정값(실승차 판정). */
const val transitPositionLookupCapMin = 30

/** 마지막 관측 뒤 표식을 유지하는 창 — riding 미관측 주기 60초 × 3. ⚠ 잠정값. */
const val transitPositionHoldMs: Double = 180_000.0

/** 레코드 나이 상한(초) — 넘으면 동결 레코드라 관측으로 치지 않는다. ⚠ 잠정값. */
const val transitPositionMaxAgeSeconds = 300

/** 래치보다 뒤 역이 이만큼 연속으로 오면 그 역에서 다시 시작한다 — 튄 값 하나가 구간을 잠그지 않게. */
const val transitPositionBehindRestart = 2

/**
 * 클라이언트 조회 예산(초) — 웹 `POSITION_CLIENT_TIMEOUT_MS`와 같은 값. 이 조회는 도착 폴 안에 직렬로 끼므로 상한이 없으면
 * 느린 upstream이 다음 도착 폴을 그만큼 민다. Kotlin 전송은 밀리초라 호출 때 `* 1000`.
 */
const val transitPositionClientTimeoutSeconds: Double = 8.0

/** 노선 목록이 0행(INFO-200 — 운행 밖·미제공)으로 이만큼 연속이면 이 결박에선 그만 묻는다. */
const val transitPositionEmptyLineStop = 3

/** `/api/transit/position` 결과의 소비 형태. 429·5xx·네트워크 오류는 `Failed`, 그 밖의 4xx는 `Unsupported`. */
sealed class TransitPositionOutcome {
    data class Found(val station: String, val dataAgeSeconds: Int?) : TransitPositionOutcome()

    /** `lineEmpty`: 노선 목록 자체가 0행(INFO-200). 목록은 있는데 그 열차만 없으면 false. */
    data class NotFound(val lineEmpty: Boolean) : TransitPositionOutcome()
    data object Unsupported : TransitPositionOutcome()
    data object Failed : TransitPositionOutcome()
}

/** 결박 — 이 riding 진입(`phaseGen`)·이 구간·이 열차의 관측만 유효하다. 요청 시점에 떠서 응답과 함께 넘긴다. */
@Serializable
data class TransitPositionBinding(val legIndex: Int, val phaseGen: Int, val vehicleId: String)

@Serializable
data class TransitRidingPosition(
    val legIndex: Int,
    val phaseGen: Int,
    val vehicleId: String,
    /** 단조 래치 — 열차는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 null. */
    val stopIndex: Int? = null,
    /** 마지막으로 래치를 확인·전진시킨 관측 시각(ms). */
    val lastFoundAt: Double? = null,
    /** 결과를 받은 조회 수(실패는 세지 않는다 — 리듀서 `ridingPolls`와 같은 규칙). */
    val lookups: Int,
    /** 래치보다 뒤 역 관측의 연속 횟수. */
    val behind: Int,
    /** 노선 0행의 연속 횟수. */
    val emptyLine: Int,
    /** 이 결박에선 다시 묻지 않는다(미지원·노선 0행 연속). */
    val stopped: Boolean,
) {
    val binding: TransitPositionBinding get() = TransitPositionBinding(legIndex, phaseGen, vehicleId)

    companion object {
        /** Swift `init(binding:)` — 새 결박의 빈 기록. */
        fun of(binding: TransitPositionBinding) = TransitRidingPosition(
            legIndex = binding.legIndex, phaseGen = binding.phaseGen, vehicleId = binding.vehicleId,
            stopIndex = null, lastFoundAt = null, lookups = 0, behind = 0, emptyLine = 0, stopped = false,
        )
    }
}

/** 지금 상태의 결박 — 식별 잠금(지하철·열차번호 있음)이 없으면 null(위치 상태가 서지 않는다). */
fun transitPositionBinding(state: TransitGuideState): TransitPositionBinding? {
    val lock = state.lock ?: return null
    if (lock.mode != TransitTrackMode.subway || isApproxTransitLock(lock)) return null
    return TransitPositionBinding(state.legIndex, state.phaseGen, lock.vehicleId)
}

private fun isBound(position: TransitRidingPosition?, state: TransitGuideState): Boolean {
    if (position == null) return false
    val binding = transitPositionBinding(state) ?: return false
    return position.binding == binding
}

/** 도착 피드가 아직 열차를 못 본 riding 신호 — 위치가 새 정보를 주는 유일한 구간(spec §5 ①). */
private fun isPreTracking(state: TransitGuideState): Boolean =
    state.phase == TransitPhase.riding && (state.signal == TransitSignal.notYetVisible || state.signal == TransitSignal.neverSeen)

/** 결박당 조회 상한 — 구간 소요에 비례한다(긴 구간에서 도착 피드가 잡히기 전에 끊기지 않게, E36 유휴 상한과 같은 모양). */
fun transitPositionLookupCap(leg: TransitGuideLeg): Int =
    maxOf(transitPositionLookupCapMin, 2 * maxOf(0, leg.minutes ?: 0))

/** 켜는 조건(spec §5 ①). 폴 한 번에 최대 1회, 도착 조회·dispatch **뒤** 상태로 판정한다. */
fun transitPositionLookupDue(state: TransitGuideState, leg: TransitGuideLeg, position: TransitRidingPosition?): Boolean {
    if (!isPreTracking(state) || leg.trackMode != TransitTrackMode.subway || transitPositionBinding(state) == null) return false
    if (position == null || !isBound(position, state)) return true
    return !position.stopped && position.lookups < transitPositionLookupCap(leg)
}

/**
 * 조회 결과 한 건을 반영한다. `requested`는 **요청 시점**의 결박 — 지금 결박과 다르면 늦은 응답이라 버린다(설계 리뷰 M1: 탑승
 * 변경 뒤 옛 열차의 응답이 새 결박에 "새로 시작"으로 흡수되던 경로).
 */
fun transitRidingPositionStep(
    prev: TransitRidingPosition?,
    state: TransitGuideState,
    leg: TransitGuideLeg,
    requested: TransitPositionBinding,
    outcome: TransitPositionOutcome,
    now: Double,
): TransitRidingPosition? {
    val binding = transitPositionBinding(state) ?: return null
    if (requested != binding) return prev
    var next = if (prev != null && prev.binding == binding) prev else TransitRidingPosition.of(binding)
    // 보존 창이 지난 래치는 버린다(설계 리뷰 M2) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
    val at = next.lastFoundAt
    if (at != null && now - at > transitPositionHoldMs) {
        next = next.copy(stopIndex = null, lastFoundAt = null, behind = 0)
    }
    when (outcome) {
        TransitPositionOutcome.Failed -> return next
        TransitPositionOutcome.Unsupported -> return next.copy(lookups = next.lookups + 1, stopped = true)
        is TransitPositionOutcome.NotFound -> {
            val emptyLine = if (outcome.lineEmpty) next.emptyLine + 1 else 0
            return next.copy(lookups = next.lookups + 1, emptyLine = emptyLine, stopped = emptyLine >= transitPositionEmptyLineStop)
        }
        is TransitPositionOutcome.Found -> {
            next = next.copy(lookups = next.lookups + 1, emptyLine = 0)
            val age = outcome.dataAgeSeconds
            if (age == null || age > transitPositionMaxAgeSeconds) return next
            val index = uniqueViaStopIndex(leg, outcome.station) ?: return next
            // "연속"은 뒤 역 관측끼리의 연속이다 — 사이의 결측·동결·조인 실패는 끊지 않는다(관측이 아니므로).
            val latched = next.stopIndex
            if (latched != null && index < latched) {
                next = next.copy(behind = next.behind + 1)
                if (next.behind < transitPositionBehindRestart) return next
            }
            return next.copy(stopIndex = index, lastFoundAt = now, behind = 0)
        }
    }
}

/** 표식을 낼 수 있는 위치 index — 결박·riding·보존 창 안일 때만. */
fun transitPositionShownIndex(state: TransitGuideState, position: TransitRidingPosition?, now: Double): Int? {
    if (state.phase != TransitPhase.riding || position == null || !isBound(position, state)) return null
    val index = position.stopIndex ?: return null
    val at = position.lastFoundAt ?: return null
    return if (now - at <= transitPositionHoldMs) index else null
}

/**
 * 유휴 정지(`transitIdlePollLimitMs`) 때의 위치 상태(E48 잔여 ⑥). 보존 창은 폴 시계로 판정하는데 유휴 정지가 폴과 시계를 함께
 * 멈춰, 창이 표식을 정하는 구간(추적 중이 아닌 riding — 미관측·소실·조회 실패)의 표식이 재개 전까지 옛 역을 말한다 — 그 구간에서만
 * 래치를 만료시킨다. 추적 중(인계 뒤)은 도착 쪽 표식도 함께 멈춰 있어 래치를 비우면 표식만 뒤로 간다(설계 리뷰 m1과 충돌)라 그대로
 * 둔다. 결박·조회 수는 남긴다(재개가 결박당 조회 상한을 되살리지 않게). 웹에는 유휴 정지가 없어 미러가 없다.
 */
fun transitRidingPositionOnIdlePause(position: TransitRidingPosition?, state: TransitGuideState?): TransitRidingPosition? {
    if (position == null || state == null || state.phase != TransitPhase.riding || state.signal == TransitSignal.tracking ||
        position.stopIndex == null
    ) {
        return position
    }
    return position.copy(stopIndex = null, lastFoundAt = null, behind = 0)
}

/**
 * 도착 유래 index와 겨룰 위치 항. 보존 창 안이면 그 값. **인계 뒤**(도착 피드 추적 중)에는 도착 쪽이 래치를 따라잡을 때까지 창과
 * 무관하게 래치를 둔다(설계 리뷰 m1). 따라잡으면 큰 값이 도착 쪽이다.
 */
private fun positionTerm(state: TransitGuideState, position: TransitRidingPosition?, now: Double, arrival: Int?): Int? {
    transitPositionShownIndex(state, position, now)?.let { return it }
    if (arrival != null && state.phase == TransitPhase.riding && state.signal == TransitSignal.tracking &&
        position != null && isBound(position, state)
    ) {
        val latched = position.stopIndex
        if (latched != null && arrival < latched) return latched
    }
    return null
}

/**
 * 경유역 목록 표식 — 도착 유래(`arvlMsg3`, 현행)와 위치 유래 중 **큰 값**. 인계 순간 도착 쪽이 한 역 뒤일 수 있어(위치 피드가 전역
 * 출발에서 먼저 바뀐다) 작은 값을 고르면 표식이 뒤로 튄다.
 */
fun transitViaStopHereIndex(state: TransitGuideState, leg: TransitGuideLeg, position: TransitRidingPosition?, now: Double): Int? {
    val arrival = viaStopCurrentIndex(leg, state.currentLocation)
    val located = positionTerm(state, position, now, arrival)
    return when {
        arrival != null && located != null -> maxOf(arrival, located)
        arrival != null -> arrival
        else -> located
    }
}

/**
 * 상태 문장이 신호 문장 대신 "현재 위치 {역}."을 말할 index(spec §6 판정 1). 도착 피드 미관측 신호에서만 — 추적 중은 도착 조각이
 * 이미 말하고, 소실·실패는 그 신호 문장이 정본이다.
 */
fun transitPositionStatusIndex(state: TransitGuideState, position: TransitRidingPosition?, now: Double): Int? {
    if (!isPreTracking(state)) return null
    return transitPositionShownIndex(state, position, now)
}

/**
 * 조망 후처리(spec §4 ⑥) — `transitProgressOverview`와 그 fixture는 그대로 두고 결과에 얹는다. silence 행·`reboardOffered`는
 * 불변(탈출구를 지우지 않는다).
 */
fun transitOverviewApplyingPosition(
    overview: TransitOverview,
    state: TransitGuideState,
    position: TransitRidingPosition?,
    now: Double,
): TransitOverview {
    var here = overview.here
    val current = overview.here
    if (current is TransitOverviewHere.Station) {
        val located = positionTerm(state, position, now, current.stopIndex)
        if (located != null && located > current.stopIndex) here = TransitOverviewHere.Station(located)
    } else if (current == TransitOverviewHere.Unknown(TransitOverviewHere.UnknownReason.noObservation)) {
        val located = transitPositionStatusIndex(state, position, now)
        if (located != null) here = TransitOverviewHere.Station(located)
    }
    if (here == overview.here) return overview
    val hereIndex = (here as? TransitOverviewHere.Station)?.stopIndex ?: -1
    val rows = overview.rows.map { row -> if (row is TransitOverviewRow.Stop) row.copy(here = row.stopIndex == hereIndex) else row }
    return overview.copy(rows = rows, here = here)
}

/**
 * `neverSeen` 1회성 경고의 보류(spec §6 판정 2). 리듀서는 그 이벤트를 한 번만 낸다 — 그 순간 현재역이 잡혀 있으면 오케스트레이터가
 * 경고를 내지 않고 결박째 보류한다.
 */
fun transitNeverSeenWarningDeferred(state: TransitGuideState, position: TransitRidingPosition?, now: Double): TransitPositionBinding? {
    if (state.signal != TransitSignal.neverSeen || transitPositionStatusIndex(state, position, now) == null) return null
    return transitPositionBinding(state)
}

enum class TransitNeverSeenPendingVerdict { fire, keep, drop }

/**
 * 보류한 경고의 처분 — 폴마다 본다. 결박이 바뀌었거나(탑승 변경·다음 구간·선언 도착·새 riding 진입) 신호가 `neverSeen`이 아니게
 * 됐으면(추적 시작·소실·실패) **버린다**. 현재역이 사라졌으면(보존 창 경과·조회 상한) 그때 **낸다**. 그 밖은 계속 보류.
 */
fun transitNeverSeenPendingStep(
    pending: TransitPositionBinding,
    state: TransitGuideState,
    position: TransitRidingPosition?,
    now: Double,
): TransitNeverSeenPendingVerdict {
    if (state.phase != TransitPhase.riding || state.signal != TransitSignal.neverSeen || transitPositionBinding(state) != pending) {
        return TransitNeverSeenPendingVerdict.drop
    }
    return if (transitPositionStatusIndex(state, position, now) == null) TransitNeverSeenPendingVerdict.fire else TransitNeverSeenPendingVerdict.keep
}

// === 조회 서비스 ===

/** `/api/transit/position` 판별 union(spec §3.2). 502는 APIClient가 던진다(호출자가 `Failed`로 소비). */
@Serializable
data class TransitPositionEnvelope(
    val status: String,
    val station: String? = null,
    val dataAgeSeconds: Int? = null,
    val total: Int? = null,
)

class TransitPositionService(private val client: APIClient) {
    /** `line`은 leg의 ODsay 노선명(`수도권 5호선`), `train`은 잠금 열차번호(`lock.vehicleId`). */
    suspend fun lookup(line: String, train: String): TransitPositionEnvelope = client.get(
        "/api/transit/position",
        listOf("line" to line, "train" to train),
        TransitPositionEnvelope.serializer(),
        timeoutMs = (transitPositionClientTimeoutSeconds * 1000).toLong(),
    )

    companion object {
        /** 응답 → 소비 형태. 알 수 없는 status는 판정 불가라 `Failed`(표식을 만들지 않는다). */
        fun outcome(envelope: TransitPositionEnvelope): TransitPositionOutcome = when (envelope.status) {
            "found" -> {
                val station = envelope.station
                if (station.isNullOrEmpty()) TransitPositionOutcome.Failed else TransitPositionOutcome.Found(station, envelope.dataAgeSeconds)
            }
            "notFound" -> TransitPositionOutcome.NotFound(lineEmpty = envelope.total == 0)
            "unsupported" -> TransitPositionOutcome.Unsupported
            else -> TransitPositionOutcome.Failed
        }

        /**
         * 200이 아닌 응답의 분류(설계 리뷰 m4, 웹 `positionOutcomeFromHttpStatus` 미러). 429·5xx·네트워크는 일시적이라 `Failed`,
         * 그 밖의 4xx는 이 결박에서 다시 물어도 같은 답이라 `Unsupported`.
         */
        fun outcome(error: Throwable): TransitPositionOutcome =
            if (error is APIError.BadStatus && error.code in 400..499 && error.code != 429) TransitPositionOutcome.Unsupported else TransitPositionOutcome.Failed
    }
}
