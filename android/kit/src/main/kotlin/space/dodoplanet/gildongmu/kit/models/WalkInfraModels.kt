package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder

// 내 주변 보행 인프라 도메인 모델: 웹 /api/walk/nearby 계약 ↔ Kit `WalkInfraModels.swift` 미러.
// 두 소스(음향신호기 seed·OSM)는 서로 독립적으로 강등된다 — 両소스 전멸 시에만 서버가 503(throw).

/**
 * 소스별 3-state(웹 SourceStatus 미러): ok ≠ 미제공(unsupported, 음향신호기=서울 밖) ≠ 조회 실패(error).
 * 미지의 status는 웹 소비자와 동형으로 error 취급. `status` 판별자로 읽는 커스텀 직렬화(Swift
 * `init(from:)` 대응) — sealed 케이스는 타입이라 PascalCase다(`Ok`·`Unsupported`·`Error`).
 */
@Serializable(with = WalkSourceStatusSerializer::class)
sealed class WalkSourceStatus<T> {
    class Ok<T>(val data: T) : WalkSourceStatus<T>()
    class Unsupported<T> : WalkSourceStatus<T>()
    class Error<T> : WalkSourceStatus<T>()
}

class WalkSourceStatusSerializer<T>(private val dataSerializer: KSerializer<T>) : KSerializer<WalkSourceStatus<T>> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("WalkSourceStatus") {
        element<String>("status")
        element("data", dataSerializer.descriptor, isOptional = true)
    }

    override fun deserialize(decoder: Decoder): WalkSourceStatus<T> {
        val input = decoder as JsonDecoder
        val obj = input.decodeJsonElement().asObjectOrThrow("WalkSourceStatus")
        // 판별자 부재는 깨진 응답(throw), 미지 값은 웹 소비자와 동형으로 error.
        return when (obj.requiredString("status")) {
            "ok" -> WalkSourceStatus.Ok(input.json.decodeFromJsonElement(dataSerializer, obj.required("data")))
            "unsupported" -> WalkSourceStatus.Unsupported()
            else -> WalkSourceStatus.Error()
        }
    }

    override fun serialize(encoder: Encoder, value: WalkSourceStatus<T>) {
        throw UnsupportedOperationException("WalkSourceStatus는 디코딩 전용이다(서버 응답 모델)")
    }
}

/** 음향신호기 지점 하나(≈11m 격자 군집 대표점). bearing은 8방위 소문자 키. */
@Serializable
data class AudioSignalSite(val distanceMeters: Int, val bearing: String, val deviceCount: Int)

/** 반경 300m 음향신호기 요약. deviceCount는 sites(최대 5) 절단 전 총수(침묵 절단 금지). */
@Serializable
data class NearbyAudioSignals(
    val deviceCount: Int,
    val sites: List<AudioSignalSite>,
    /** 서울시 자료 기준일(예 "2026-05-28") — 출처 인용문에 표기 */
    val baseDate: String,
)

/** OSM 보행 feature 하나. crossingSignal "yes"/"no"/"unknown", hostFeature는 판별 가능할 때만. 신규 값에 깨지지 않도록 String. */
@Serializable
data class WalkFeature(
    val osmId: String,
    val crossing: Boolean,
    val crossingSignal: String,
    val tactilePaving: Boolean,
    val hostFeature: String? = null,
    val distanceMeters: Int,
    val bearing: String,
)

/** OSM 데이터 묶음. crossingTotal·tactileTotal은 cap(각 10) 전 실개수 — "N곳 중 가까운 M곳"의 근거. */
@Serializable
data class OsmWalkData(
    val features: List<WalkFeature>,
    val totalCount: Int,
    val listedCount: Int,
    val truncated: Boolean,
    val crossingTotal: Int,
    val tactileTotal: Int,
) {
    /** 횡단보도 projection(거리순 유지). 웹 WalkInfraPanel filter 미러. */
    val crossings: List<WalkFeature> get() = features.filter { it.crossing }

    /** 비-crossing 점자블록 projection(crossing이면서 tactile인 점은 횡단보도 쪽). */
    val tactiles: List<WalkFeature> get() = features.filter { !it.crossing && it.tactilePaving }
}

/** /api/walk/nearby 응답 본문. 両소스 전멸이면 이 응답 대신 503(throw)이다. */
@Serializable
data class WalkInfrastructure(
    val audioSignals: WalkSourceStatus<NearbyAudioSignals>,
    val osm: WalkSourceStatus<OsmWalkData>,
)

@Serializable
internal data class WalkInfraEnvelope(val walk: WalkInfrastructure)
