package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.TransitLegStop

/**
 * 버스 승차 중 현재 정류장 — 기기 위치(fix)의 **표시 전용** 순수 계층(E48, spec `2026-09-23-bus-current-stop-design.md` §2).
 * 웹 `src/lib/transit-bus-stop.ts` ↔ Kit `TransitBusStop.swift` 1:1 미러이고 공유 fixture(`transit-bus-stop-cases.json`)가
 * 동조를 강제한다.
 *
 * ⚠ 이 상태는 승차 상태 머신(`TransitGuide.kt` 리듀서) **밖**에 있다. 리듀서는 이 파일을 모르고, 도착·승격·하차·neverSeen 판정은
 * 도착 API가 한다(판정서 2026-08-23 §3). 기기 위치는 경유 정류장 목록·조망의 "현재 위치" 표식만 채운다.
 *
 * E35 열차 위치(`TransitRidingPosition.kt`)와 합치지 않는다 — 결박·출처·빈도·뒤 재시작 규칙이 다르다. 합류는 표식 index의 큰 값
 * 하나다. 불변식: 표식은 "있다"만 주장한다.
 */

/** fix 정확도 상한(m) — 앱 공유 스토어 저장 상한(`LocationFixPolicy.storeCeiling`)과 같다. ⚠ 잠정값. */
const val transitBusStopMaxAccuracyM: Double = 100.0

/** fix 나이 상한(초) — 캐시 fix를 거른다. ⚠ 잠정값. */
const val transitBusStopFixMaxAgeSeconds: Double = 10.0

/** 최근접 정류장까지의 거리 상한(m) — 넘으면 노선 밖이라 관측이 아니다. ⚠ 잠정값. */
const val transitBusStopNearRadiusM: Double = 300.0

/** 비인접 정류장이 최근접보다 이만큼 안쪽이면 노선이 접힌 곳이라 모호하다. ⚠ 잠정값. */
const val transitBusStopAmbiguityMarginM: Double = 50.0

/**
 * 하차 정류장은 이만큼 가까워야 관측으로 친다(m). "하차, 현재 위치"는 "지금 내려라"로 들린다 — 직전 정류장에 문이 열린 채 서 있는
 * 동안 한쪽으로 치우친 fix 두 건이 중간 지점을 넘겨 그 줄을 먼저 세우지 않게(접근성 감사 MINOR-2). ⚠ 잠정값.
 */
const val transitBusStopAlightRadiusM: Double = 50.0

/** 마지막 관측 뒤 표식을 유지하는 창(ms). 만료는 폴 시계가 아니라 **이 시각에 맞춘 한 번짜리 타이머**가 판정한다(설계 리뷰 M2). ⚠ 잠정값. */
const val transitBusStopHoldMs: Double = 90_000.0

/** 래치보다 뒤 정류장 관측이 이만큼 이어지면 그 정류장에서 다시 시작한다(ms). ⚠ 잠정값. */
const val transitBusStopBehindRestartMs: Double = 60_000.0

/** 하차 정류장 도착 한 마디(A69)의 fix 정확도 상한(m) — 알림 전용. 2026-10-18 실승차 `busFix`는 대부분 14~34m. ⚠ 잠정값. */
const val transitBusAlightNoticeMaxAccuracyM: Double = 35.0

/** 적격 fix 두 건 사이 최대 간격(ms) — 넘으면 연속이 아니다. ⚠ 잠정값. */
const val transitBusAlightNoticeMaxGapMs: Double = 10_000.0

/** fix 한 건. `ageSeconds`는 호출자가 **측정 시각**으로 잰다(수신 시각이 아니다). `accuracy`: 수평 정확도(m), 0 이하·비유한은 판정 불가. */
@Serializable
data class TransitDeviceFix(val lat: Double, val lng: Double, val accuracy: Double, val ageSeconds: Double)

@Serializable
data class TransitBusStopTracker(
    val legIndex: Int,
    val phaseGen: Int,
    /** 단조 래치 — 버스는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 null. */
    val stopIndex: Int? = null,
    /** 마지막으로 래치를 확인·전진시킨 관측 시각(ms). */
    val lastObservedAt: Double? = null,
    /** 래치보다 앞(또는 래치 없음)으로 한 번 관측된 정류장 — 같은 정류장이 한 번 더 이어서 관측돼야 래치가 옮겨 간다(설계 리뷰 M1). */
    val pendingIndex: Int? = null,
    /** 뒤 정류장 관측이 시작된 시각(ms) — 같거나 앞 관측이 오면 끊긴다. */
    val behindSince: Double? = null,
)

/**
 * 뷰가 읽는 표식 — 시각이 빠진 (결박, 정류장)이다. fix마다 바뀌는 `lastObservedAt`을 뷰에 노출하면 관측이 이어지는 동안 목록이
 * 초마다 다시 그려진다(설계 리뷰 m3).
 */
@Serializable
data class TransitBusStopMark(val legIndex: Int, val phaseGen: Int, val stopIndex: Int)

@Serializable
enum class TransitBusStopVerdict { notApplicable, inaccurate, stale, offRoute, ambiguous, approachingAlight, pending, observed, behind, restarted }

data class TransitBusStopStepResult(
    val tracker: TransitBusStopTracker?,
    val verdict: TransitBusStopVerdict,
    /** 이 fix의 최근접 정류장(원본 index) — 거리를 재기 전에 걸러졌으면 null. 계측 전용(구현 리뷰 m3). */
    val nearestIndex: Int?,
)

/** 적용 조건(spec §2 ①) — 잠금 종류·신호는 보지 않는다(기기 위치는 도착 피드와 독립이다). */
fun transitBusStopApplies(state: TransitGuideState, leg: TransitGuideLeg): Boolean =
    state.phase == TransitPhase.riding && leg.mode == "bus" && leg.viaStops.isNotEmpty()

private fun isBound(legIndex: Int, phaseGen: Int, state: TransitGuideState): Boolean =
    legIndex == state.legIndex && phaseGen == state.phaseGen

/** 쓸 수 있는 정류장 좌표 — 비유한·(0,0)은 후보에서 뺀다(설계 리뷰 m5, `transitPrewalkTarget`과 같은 방어). */
private fun usableStop(s: TransitLegStop): Boolean = s.lat.isFinite() && s.lng.isFinite() && !(s.lat == 0.0 && s.lng == 0.0)

/**
 * fix 한 건을 반영한다(spec §2 ③). 기기 위치는 언제 도착하든 "지금 이 사람의 위치"라 요청 결박을 따지지 않고 **현재 상태**의
 * 결박에 넣는다(E35의 늦은 응답 폐기와 다른 점).
 */
fun transitBusStopStep(
    prev: TransitBusStopTracker?,
    state: TransitGuideState,
    leg: TransitGuideLeg,
    fix: TransitDeviceFix,
    now: Double,
): TransitBusStopStepResult {
    if (!transitBusStopApplies(state, leg)) return TransitBusStopStepResult(null, TransitBusStopVerdict.notApplicable, null)
    var next = if (prev != null && isBound(prev.legIndex, prev.phaseGen, state)) {
        prev
    } else {
        TransitBusStopTracker(legIndex = state.legIndex, phaseGen = state.phaseGen)
    }
    // 보존 창이 지난 래치는 버린다(E35 설계 리뷰 M2와 같은 이유) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
    val at = next.lastObservedAt
    if (at != null && now - at > transitBusStopHoldMs) {
        next = next.copy(stopIndex = null, lastObservedAt = null, pendingIndex = null, behindSince = null)
    }
    // 음수·0 정확도는 무효 신호(CLLocation 계약).
    if (!(fix.accuracy > 0 && fix.accuracy.isFinite() && fix.accuracy <= transitBusStopMaxAccuracyM)) {
        return TransitBusStopStepResult(next, TransitBusStopVerdict.inaccurate, null)
    }
    // 캐시 fix(스트림 첫 콜백)·미래 시각을 거른다 — 도보 안내와 같은 판정 함수, 창만 이 계층의 값(기본값 5초를 쓰지 않는다 — 명시).
    if (!isUsableFix(accuracy = fix.accuracy, ageSeconds = fix.ageSeconds, maxAge = transitBusStopFixMaxAgeSeconds)) {
        return TransitBusStopStepResult(next, TransitBusStopVerdict.stale, null)
    }

    // 원본 index를 유지한 채 쓸 수 있는 정류장만 겨룬다.
    val distances = leg.viaStops.map {
        if (usableStop(it)) haversineMeters(fix.lat, fix.lng, it.lat, it.lng) else Double.POSITIVE_INFINITY
    }
    var nearest = 0
    for (i in 1 until distances.size) if (distances[i] < distances[nearest]) nearest = i
    fun result(tracker: TransitBusStopTracker, verdict: TransitBusStopVerdict) = TransitBusStopStepResult(tracker, verdict, nearest)
    if (!(distances[nearest] <= transitBusStopNearRadiusM)) return result(next, TransitBusStopVerdict.offRoute)
    // 노선이 접힌 곳(회차·U턴·순환 — 길 건너 정류장)은 어느 쪽인지 가를 수 없다. 인접 정류장끼리는 경합이 아니다.
    val folded = distances.indices.any {
        kotlin.math.abs(it - nearest) >= 2 && distances[it] <= distances[nearest] + transitBusStopAmbiguityMarginM
    }
    if (folded) return result(next, TransitBusStopVerdict.ambiguous)
    if (nearest == distances.size - 1 && distances[nearest] > transitBusStopAlightRadiusM) {
        return result(next, TransitBusStopVerdict.approachingAlight)
    }

    if (next.stopIndex == nearest) {
        return result(next.copy(lastObservedAt = now, pendingIndex = null, behindSince = null), TransitBusStopVerdict.observed)
    }
    val latched = next.stopIndex
    if (latched == null || nearest > latched) {
        // 앞으로는 같은 정류장이 두 번 이어서 관측돼야 옮긴다(설계 리뷰 M1). 뒤 관측의 연속은 끊긴다.
        next = next.copy(behindSince = null)
        if (next.pendingIndex == nearest) {
            return result(next.copy(stopIndex = nearest, lastObservedAt = now, pendingIndex = null), TransitBusStopVerdict.observed)
        }
        return result(next.copy(pendingIndex = nearest), TransitBusStopVerdict.pending)
    }
    // 뒤 정류장 — 60초 동안 이어질 때만 다시 시작한다(첫 래치가 틀렸던 경우의 복구). 중간 지점의 흔들림은 사이에 끼는 같거나 앞
    // 관측이 끊는다. 뒤 관측은 래치를 확인하지 않으므로 `lastObservedAt`을 두고 간다 — 그래서 래치 나이가 30초를 넘은 뒤 시작한 뒤
    // 관측은 60초 전에 보존 창 만료가 먼저 래치를 버린다.
    next = next.copy(pendingIndex = null)
    val since = next.behindSince ?: now
    if (now - since >= transitBusStopBehindRestartMs) {
        return result(next.copy(stopIndex = nearest, lastObservedAt = now, behindSince = null), TransitBusStopVerdict.restarted)
    }
    return result(next.copy(behindSince = since), TransitBusStopVerdict.behind)
}

/** 표식 — 적용 조건·결박·보존 창 안일 때만. `now`가 관측보다 이르면(음수 경과) 보인다. */
fun transitBusStopMark(state: TransitGuideState, leg: TransitGuideLeg, tracker: TransitBusStopTracker?, now: Double): TransitBusStopMark? {
    if (!transitBusStopApplies(state, leg) || tracker == null || !isBound(tracker.legIndex, tracker.phaseGen, state)) return null
    val index = tracker.stopIndex ?: return null
    val at = tracker.lastObservedAt ?: return null
    if (now - at > transitBusStopHoldMs) return null
    return TransitBusStopMark(tracker.legIndex, tracker.phaseGen, index)
}

/** 표식이 지금 상태에서 유효한 index — 국면·구간·결박이 바뀌었으면 옛 표식은 null. */
private fun markIndex(state: TransitGuideState, leg: TransitGuideLeg, mark: TransitBusStopMark?): Int? {
    if (mark == null || !transitBusStopApplies(state, leg) || !isBound(mark.legIndex, mark.phaseGen, state) ||
        mark.stopIndex >= leg.viaStops.size
    ) {
        return null
    }
    return mark.stopIndex
}

/**
 * 경유 목록 표식의 세 번째 출처(spec §2 ⑤) — E35 `transitViaStopHereIndex`(도착 `arvlMsg3`·열차 위치)와 버스 표식 중 큰 값. 한
 * leg에서 두 출처가 겨루지 않지만(버스 ↔ 지하철) 그 사실을 가정하지 않는다.
 */
fun transitViaStopHereIndexWithBusStop(
    state: TransitGuideState,
    leg: TransitGuideLeg,
    position: TransitRidingPosition?,
    busStop: TransitBusStopMark?,
    now: Double,
): Int? {
    val train = transitViaStopHereIndex(state, leg, position, now)
    val bus = markIndex(state, leg, busStop)
    return when {
        train != null && bus != null -> maxOf(train, bus)
        train != null -> train
        else -> bus
    }
}

/**
 * 조망 후처리(spec §2 ⑥) — 버스 leg에서 `here`가 해당 없음일 때만 표식으로 바꾼다(추적 불가 지하철 leg도 같은 `bus` 사유를 받으므로
 * leg 종류를 함께 본다 — 설계 리뷰 n1). silence 행·`reboardOffered`는 불변. E35 후처리 뒤에 얹는다(서로 다른 leg 종류에서만 일한다).
 */
fun transitOverviewApplyingBusStop(
    overview: TransitOverview,
    state: TransitGuideState,
    leg: TransitGuideLeg,
    mark: TransitBusStopMark?,
): TransitOverview {
    if (overview.here != TransitOverviewHere.NotApplicable(TransitOverviewHere.NotApplicableReason.bus)) return overview
    val shown = markIndex(state, leg, mark) ?: return overview
    val rows = overview.rows.map { row -> if (row is TransitOverviewRow.Stop) row.copy(here = row.stopIndex == shown) else row }
    return overview.copy(rows = rows, here = TransitOverviewHere.Station(shown))
}

/**
 * 하차 정류장 도착 한 마디(A69 판정 ②, spec `2026-10-19-bus-alight-next-stop-design.md` §2)의 구간 기록.
 *
 * ⚠ 표시용 래치를 하차 명령으로 승격하지 않는다(설계 리뷰 H3): 래치의 "연속 두 관측"은 사이에 낀 부적격 fix와 긴 공백을 넘어 이어지는
 * 표시용 완화다. 이 문장의 실패 방향은 "너무 이르게"라 따로 센다. `reached`(관측 이력 — 늦은 「다음 정류장」을 거른다)와
 * `announced`(전달 장부 — 버려지면 앱이 되돌린다)를 가른다(H4). 결박은 (구간, 국면 세대)다 — 세대는 riding 진입·탑승 변경·구간
 * 전진에서만 바뀌고 도착 추정·재관측은 유지하므로, 한 승차 안의 이력은 남고 [탑승 변경]으로 다시 탄 버스는 새 기록이다(구현 리뷰 m2).
 */
@Serializable
data class TransitBusAlightNotice(
    val legIndex: Int,
    val phaseGen: Int,
    /** 하차 정류장 반경 안 적격 fix의 연속 수. */
    val streak: Int = 0,
    /** 마지막 적격 fix 시각(ms) — 연속이 끊기면 null. */
    val lastAt: Double? = null,
    val reached: Boolean = false,
    val announced: Boolean = false,
)

data class TransitBusAlightNoticeStepResult(val notice: TransitBusAlightNotice, val speak: Boolean)

/**
 * fix 한 건(이미 `transitBusStopStep`을 거친 결과)으로 구간 기록을 전진한다. 적격 fix = 최근접이 하차 정류장(경유 목록의 마지막)이고
 * 추적기 판정이 `pending`·`observed`(정확도·나이·노선 밖·모호·하차 반경 50m를 통과) ∧ 정확도 ≤ 35m ∧ 도착 피드가 아직 두 정거장
 * 이상 남았다고 말하지 않는다(`state.remaining`을 **읽기만** 한다 — 회차·순환 노선이 하차 정류장 50m 안을 먼저 지나는 곳에서 이르게
 * 말하고 그 뒤 신호를 모두 막지 않게, 구현 리뷰 M1). 잔여는 피드가 살아 있을 때(`signal == tracking`)만 믿는다 — 소실·폴 실패는
 * 잔여를 지우지 않아, 피드가 죽은 뒤 낡은 2가 한 마디를 승차 끝까지 막는다(안전 검토 N1). 모르면 막지 않는다. 적격 fix가 10초 안에
 * 두 번 이어지면 도착이다. 리듀서는 이 함수를 모르고, 결과는 통지만 낸다(표시 전용 계약의 의도된 예외 하나 — 판정서 2026-08-23 §3).
 */
fun transitBusAlightNoticeStep(
    prev: TransitBusAlightNotice?,
    state: TransitGuideState,
    leg: TransitGuideLeg,
    result: TransitBusStopStepResult,
    fix: TransitDeviceFix,
    now: Double,
): TransitBusAlightNoticeStepResult {
    var base = if (prev != null && prev.legIndex == state.legIndex && prev.phaseGen == state.phaseGen) {
        prev
    } else {
        TransitBusAlightNotice(legIndex = state.legIndex, phaseGen = state.phaseGen)
    }
    val qualifies = result.nearestIndex == leg.viaStops.size - 1 &&
        !(state.signal == TransitSignal.tracking && (state.remaining ?: 0) >= 2) &&
        (result.verdict == TransitBusStopVerdict.pending || result.verdict == TransitBusStopVerdict.observed) &&
        fix.accuracy <= transitBusAlightNoticeMaxAccuracyM
    if (!qualifies) return TransitBusAlightNoticeStepResult(base.copy(streak = 0, lastAt = null), false)
    val last = base.lastAt
    base = if (last != null && now - last <= transitBusAlightNoticeMaxGapMs) {
        base.copy(streak = base.streak + 1, lastAt = now)
    } else {
        base.copy(streak = 1, lastAt = now)
    }
    if (base.streak < 2) return TransitBusAlightNoticeStepResult(base, false)
    base = base.copy(reached = true)
    if (base.announced) return TransitBusAlightNoticeStepResult(base, false)
    return TransitBusAlightNoticeStepResult(base.copy(announced = true), true)
}
