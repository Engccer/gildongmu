package space.dodoplanet.gildongmu.directions

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.KitJson

/**
 * `DirectionsEndpoint`(:kit, 직렬화 없음)의 저장용 미러(spec §7). 프로세스 재생성 뒤 폼 필드 셋만 복원하는
 * `SavedStateHandle` 값이다 — 결과·최근 목록 메모리는 복원하지 않는다(§2). `KitJson`(`explicitNulls=false`)이라
 * `labelRoman` null은 키 자체가 빠진다.
 */
@Serializable
sealed class EndpointJson {
    @Serializable
    data object Current : EndpointJson()

    @Serializable
    data class Place(val label: String, val lat: Double, val lng: Double, val labelRoman: String? = null) : EndpointJson()
}

fun DirectionsEndpoint.toJson(): String = KitJson.encodeToString(
    EndpointJson.serializer(),
    when (this) {
        DirectionsEndpoint.Current -> EndpointJson.Current
        is DirectionsEndpoint.Place -> EndpointJson.Place(label, lat, lng, labelRoman)
    },
)

/** 부재·깨진 값은 null(필드 비움) — 복원은 부가 기능이라 본 기능을 막지 않는다. */
fun endpointFromJson(json: String?): DirectionsEndpoint? {
    if (json.isNullOrEmpty()) return null
    val decoded = try {
        KitJson.decodeFromString(EndpointJson.serializer(), json)
    } catch (_: SerializationException) {
        return null
    } catch (_: IllegalArgumentException) {
        return null
    }
    return when (decoded) {
        EndpointJson.Current -> DirectionsEndpoint.Current
        is EndpointJson.Place -> DirectionsEndpoint.Place(decoded.label, decoded.lat, decoded.lng, decoded.labelRoman)
    }
}
