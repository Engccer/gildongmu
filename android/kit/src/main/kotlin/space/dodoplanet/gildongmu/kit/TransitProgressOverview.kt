package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.dodoplanet.gildongmu.kit.models.asObjectOrThrow
import space.dodoplanet.gildongmu.kit.models.requiredInt
import space.dodoplanet.gildongmu.kit.models.requiredString

/**
 * 대중교통 "진행 상황 조망" 순수 계층(E15-1, spec 2026-08-23 §3) — 웹 `src/lib/transit-progress-overview.ts` ↔ Kit
 * `TransitProgressOverview.swift` 1:1 미러. 공유 fixture(`transit-progress-overview-scenarios.json`)가 디스크립터 JSON
 * 동조를 강제한다. 문자열은 만들지 않는다 — i18n 렌더는 앱 어댑터의 몫.
 *
 * 불변식(설계 리뷰 2026-08-23): "지금 여기"는 **신선한 추적 관측**에서만 나온다 — signal == tracking · 지하철 · 정규화
 * 역명 유일 매칭. 소실·실패 중에 남아 있는 `currentLocation`은 마지막 관측값이라 표식하지 않는다(한 화면이 "위치를
 * 모른다"와 "현재 위치는 X"를 동시에 주장하지 않게). 없는 표식은 거짓이 아니지만 있는 표식은 거짓일 수 있다.
 */
@Serializable(with = TransitOverviewHereSerializer::class)
sealed class TransitOverviewHere {
    data class Station(val stopIndex: Int) : TransitOverviewHere()
    data class NotApplicable(val reason: NotApplicableReason) : TransitOverviewHere()
    data class Unknown(val reason: UnknownReason) : TransitOverviewHere()

    enum class NotApplicableReason { phase, bus }

    enum class UnknownReason { noObservation, signalLost, upstreamFailed, ambiguous, arrivedUncertain }
}

private inline fun <reified E : Enum<E>> JsonObject.requiredEnum(key: String): E {
    val raw = requiredString(key)
    return enumValues<E>().firstOrNull { it.name == raw } ?: throw SerializationException("'$key' 미지 값 $raw")
}

internal object TransitOverviewHereSerializer : KSerializer<TransitOverviewHere> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("TransitOverviewHere") { element<String>("kind") }

    override fun deserialize(decoder: Decoder): TransitOverviewHere {
        val obj = (decoder as JsonDecoder).decodeJsonElement().asObjectOrThrow("TransitOverviewHere")
        return when (val kind = obj.requiredString("kind")) {
            "station" -> TransitOverviewHere.Station(obj.requiredInt("stopIndex"))
            "notApplicable" -> TransitOverviewHere.NotApplicable(obj.requiredEnum("reason"))
            "unknown" -> TransitOverviewHere.Unknown(obj.requiredEnum("reason"))
            else -> throw SerializationException("unknown here kind $kind")
        }
    }

    override fun serialize(encoder: Encoder, value: TransitOverviewHere) {
        (encoder as JsonEncoder).encodeJsonElement(
            buildJsonObject {
                when (value) {
                    is TransitOverviewHere.Station -> {
                        put("kind", "station")
                        put("stopIndex", value.stopIndex)
                    }
                    is TransitOverviewHere.NotApplicable -> {
                        put("kind", "notApplicable")
                        put("reason", value.reason.name)
                    }
                    is TransitOverviewHere.Unknown -> {
                        put("kind", "unknown")
                        put("reason", value.reason.name)
                    }
                }
            },
        )
    }
}

@Serializable
enum class TransitOverviewSilenceSignal { neverSeen, notYetVisible, signalLost, upstreamFailed }

@Serializable
enum class TransitOverviewLegStatus { done, current, upcoming }

@Serializable
enum class TransitOverviewStopRole { board, via, alight }

@Serializable(with = TransitOverviewRowSerializer::class)
sealed class TransitOverviewRow {
    data class Walk(val minutes: Int) : TransitOverviewRow()
    data class Leg(
        val legIndex: Int,
        val mode: String,
        val lineName: String,
        val boardName: String,
        val alightName: String,
        val status: TransitOverviewLegStatus,
        val stationCount: Int?,
    ) : TransitOverviewRow()
    data class Stop(val stopIndex: Int, val name: String, val role: TransitOverviewStopRole, val here: Boolean) : TransitOverviewRow()

    /** 현재 구간 정차역 정보 없음 — 탑승 leg에 정차역 0개는 없으므로 빈 목록은 언제나 정보 없음. */
    data object StopsUnavailable : TransitOverviewRow()
    data class Silence(val signal: TransitOverviewSilenceSignal) : TransitOverviewRow()
}

internal object TransitOverviewRowSerializer : KSerializer<TransitOverviewRow> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("TransitOverviewRow") { element<String>("kind") }

    override fun deserialize(decoder: Decoder): TransitOverviewRow {
        val obj = (decoder as JsonDecoder).decodeJsonElement().asObjectOrThrow("TransitOverviewRow")
        return when (val kind = obj.requiredString("kind")) {
            "walk" -> TransitOverviewRow.Walk(obj.requiredInt("minutes"))
            "leg" -> TransitOverviewRow.Leg(
                legIndex = obj.requiredInt("legIndex"),
                mode = obj.requiredString("mode"),
                lineName = obj.requiredString("lineName"),
                boardName = obj.requiredString("boardName"),
                alightName = obj.requiredString("alightName"),
                status = obj.requiredEnum("status"),
                stationCount = obj["stationCount"]?.takeIf { it !is JsonNull }?.let { obj.requiredInt("stationCount") },
            )
            "stop" -> TransitOverviewRow.Stop(
                stopIndex = obj.requiredInt("stopIndex"),
                name = obj.requiredString("name"),
                role = obj.requiredEnum("role"),
                here = (obj["here"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
                    ?: throw SerializationException("'here'는 불리언이어야 한다"),
            )
            "stopsUnavailable" -> TransitOverviewRow.StopsUnavailable
            "silence" -> TransitOverviewRow.Silence(obj.requiredEnum("signal"))
            else -> throw SerializationException("unknown row kind $kind")
        }
    }

    override fun serialize(encoder: Encoder, value: TransitOverviewRow) {
        (encoder as JsonEncoder).encodeJsonElement(
            buildJsonObject {
                when (value) {
                    is TransitOverviewRow.Walk -> {
                        put("kind", "walk")
                        put("minutes", value.minutes)
                    }
                    is TransitOverviewRow.Leg -> {
                        put("kind", "leg")
                        put("legIndex", value.legIndex)
                        put("mode", value.mode)
                        put("lineName", value.lineName)
                        put("boardName", value.boardName)
                        put("alightName", value.alightName)
                        put("status", value.status.name)
                        // 웹 JSON은 null을 명시한다 — 생략하면 fixture 대조가 키 유무로 갈린다.
                        put("stationCount", value.stationCount)
                    }
                    is TransitOverviewRow.Stop -> {
                        put("kind", "stop")
                        put("stopIndex", value.stopIndex)
                        put("name", value.name)
                        put("role", value.role.name)
                        put("here", value.here)
                    }
                    TransitOverviewRow.StopsUnavailable -> put("kind", "stopsUnavailable")
                    is TransitOverviewRow.Silence -> {
                        put("kind", "silence")
                        put("signal", value.signal.name)
                    }
                }
            },
        )
    }
}

@Serializable
data class TransitOverviewOrdinal(val n: Int, val count: Int)

@Serializable
data class TransitOverview(
    val legOrdinal: TransitOverviewOrdinal,
    val rows: List<TransitOverviewRow>,
    val here: TransitOverviewHere,
    /** 침묵 탈출구(탑승 변경) 행 — riding ∧ 비-tagoBus ∧ 침묵 신호(시트 술어 + 침묵). */
    val reboardOffered: Boolean,
    val alternativesOffered: Boolean,
)

/** silence 행·탈출구가 공유하는 신호 집합 — 같은 집합이라 탈출구는 언제나 silence 바로 뒤다. */
val transitOverviewSilenceSignals: Set<TransitSignal> = setOf(
    TransitSignal.notYetVisible, TransitSignal.neverSeen, TransitSignal.signalLost, TransitSignal.upstreamFailed,
)

/** 정규화 역명 매칭이 정확히 1건일 때만 인덱스 — 동명 정차(순환·반복)는 모호(null). */
fun uniqueViaStopIndex(leg: TransitGuideLeg, currentLocation: String?): Int? {
    if (currentLocation == null) return null
    val target = normalizeStopName(currentLocation)
    if (target.isEmpty()) return null
    val matches = leg.viaStops.indices.filter { normalizeStopName(leg.viaStops[it].name) == target }
    return if (matches.size == 1) matches[0] else null
}

fun transitOverviewHere(state: TransitGuideState, leg: TransitGuideLeg): TransitOverviewHere {
    when (state.phase) {
        TransitPhase.waiting, TransitPhase.boarding, TransitPhase.done ->
            return TransitOverviewHere.NotApplicable(TransitOverviewHere.NotApplicableReason.phase)
        TransitPhase.arrived -> return if (state.arrivedCertain) {
            TransitOverviewHere.NotApplicable(TransitOverviewHere.NotApplicableReason.phase)
        } else {
            TransitOverviewHere.Unknown(TransitOverviewHere.UnknownReason.arrivedUncertain)
        }
        TransitPhase.riding -> Unit
    }
    if (leg.trackMode != TransitTrackMode.subway) return TransitOverviewHere.NotApplicable(TransitOverviewHere.NotApplicableReason.bus)
    when (state.signal) {
        TransitSignal.signalLost -> return TransitOverviewHere.Unknown(TransitOverviewHere.UnknownReason.signalLost)
        TransitSignal.upstreamFailed -> return TransitOverviewHere.Unknown(TransitOverviewHere.UnknownReason.upstreamFailed)
        TransitSignal.tracking -> Unit
        else -> return TransitOverviewHere.Unknown(TransitOverviewHere.UnknownReason.noObservation)
    }
    uniqueViaStopIndex(leg, state.currentLocation)?.let { return TransitOverviewHere.Station(it) }
    // 관측은 있는데 매칭이 0건(노선 밖 표기)이거나 2건 이상(동명)이다.
    val cur = state.currentLocation
    val anyMatch = cur != null && normalizeStopName(cur).let { target -> leg.viaStops.any { normalizeStopName(it.name) == target } }
    return TransitOverviewHere.Unknown(if (anyMatch) TransitOverviewHere.UnknownReason.ambiguous else TransitOverviewHere.UnknownReason.noObservation)
}

private fun silenceSignal(state: TransitGuideState): TransitOverviewSilenceSignal? {
    if (state.phase != TransitPhase.riding || state.signal !in transitOverviewSilenceSignals) return null
    return TransitOverviewSilenceSignal.entries.firstOrNull { it.name == state.signal.name }
}

fun transitProgressOverview(state: TransitGuideState, route: TransitGuideRoute): TransitOverview {
    val count = route.legs.size
    val current = minOf(state.legIndex, maxOf(count - 1, 0))
    val leg = route.legs.getOrNull(current)
    val here = leg?.let { transitOverviewHere(state, it) }
        ?: TransitOverviewHere.NotApplicable(TransitOverviewHere.NotApplicableReason.phase)
    val silence = silenceSignal(state)
    val rows = ArrayList<TransitOverviewRow>()
    for ((i, l) in route.legs.withIndex()) {
        val walk = l.walkBeforeMinutes
        if (walk != null && walk > 0) rows.add(TransitOverviewRow.Walk(walk))
        val status = when {
            state.phase == TransitPhase.done || i < current -> TransitOverviewLegStatus.done
            i == current -> TransitOverviewLegStatus.current
            else -> TransitOverviewLegStatus.upcoming
        }
        rows.add(TransitOverviewRow.Leg(i, l.mode, l.lineName, l.boardName, l.alightName, status, l.stationCount))
        if (status != TransitOverviewLegStatus.current) continue
        if (silence != null) rows.add(TransitOverviewRow.Silence(silence))
        if (l.viaStops.isEmpty()) {
            rows.add(TransitOverviewRow.StopsUnavailable)
            continue
        }
        for ((si, s) in l.viaStops.withIndex()) {
            val role = when (si) {
                0 -> TransitOverviewStopRole.board
                l.viaStops.size - 1 -> TransitOverviewStopRole.alight
                else -> TransitOverviewStopRole.via
            }
            val isHere = here is TransitOverviewHere.Station && here.stopIndex == si
            rows.add(TransitOverviewRow.Stop(si, s.name, role, isHere))
        }
    }
    val walkAfter = route.walkAfterMinutes
    if (walkAfter != null && walkAfter > 0) rows.add(TransitOverviewRow.Walk(walkAfter))
    val reboardOffered = state.phase == TransitPhase.riding &&
        leg?.trackMode != null && leg.trackMode != TransitTrackMode.tagoBus &&
        silence != null
    return TransitOverview(
        legOrdinal = TransitOverviewOrdinal(current + 1, count),
        rows = rows,
        here = here,
        reboardOffered = reboardOffered,
        alternativesOffered = state.phase != TransitPhase.done,
    )
}
