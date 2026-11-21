package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import space.dodoplanet.gildongmu.kit.CarAction
import space.dodoplanet.gildongmu.kit.WalkAction

/**
 * 전방 호환 열거형 디코딩(Swift `flatMap(init(rawValue:))` 대응): **모르는 문자열은 디코딩 실패가
 * 아니라 null**이다 — 서버가 값을 늘려도 구버전 앱이 브리핑 전체를 잃지 않는다. 미러 파일이 아니라
 * Kotlin 직렬화 보조라 등록부 밖이다.
 */
@OptIn(ExperimentalSerializationApi::class)
internal abstract class LenientEnumSerializer<T : Any>(name: String, private val parse: (String) -> T?) : KSerializer<T?> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(name, PrimitiveKind.STRING).nullable

    override fun deserialize(decoder: Decoder): T? {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        if (element is JsonNull) return null
        return parse(element.jsonPrimitive.content)
    }

    override fun serialize(encoder: Encoder, value: T?) {
        if (value == null) encoder.encodeNull() else encoder.encodeString(value.toString())
    }
}

internal object LenientCarActionSerializer : LenientEnumSerializer<CarAction>("CarAction", CarAction::fromRawValue)
internal object LenientWalkActionSerializer : LenientEnumSerializer<WalkAction>("WalkAction", WalkAction::fromRawValue)

/**
 * 최근 경로 역 칸의 지정 종류(Swift `try? decodeIfPresent(JourneyStationKind.self)`): 모르는 원시값은 null — 한 항목의 종류 때문에
 * 경로 목록 전체 디코딩이 실패해 고정 경로까지 사라지는 일을 막는다. 저장 포맷은 원시값(`"stop"`)이다.
 */
@OptIn(ExperimentalSerializationApi::class)
internal object LenientJourneyStationKindSerializer :
    LenientEnumSerializer<space.dodoplanet.gildongmu.kit.JourneyStationKind>("JourneyStationKind", space.dodoplanet.gildongmu.kit.JourneyStationKind::fromRawValue) {
    /** 생성 인자에 기본값이 없어(안전 인자) 키 부재가 이 함수까지 온다 — `explicitNulls = false`의 부재 = null 표식을 먼저 본다. */
    override fun deserialize(decoder: Decoder): space.dodoplanet.gildongmu.kit.JourneyStationKind? {
        if (!decoder.decodeNotNullMark()) return decoder.decodeNull()
        return super.deserialize(decoder)
    }

    override fun serialize(encoder: Encoder, value: space.dodoplanet.gildongmu.kit.JourneyStationKind?) {
        if (value == null) encoder.encodeNull() else encoder.encodeString(value.rawValue)
    }
}
