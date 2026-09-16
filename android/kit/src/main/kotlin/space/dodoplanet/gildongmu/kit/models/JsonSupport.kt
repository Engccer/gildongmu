package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 커스텀 `KSerializer`의 필수 키 읽기(Swift `container.decode(_:forKey:)` 대응). **던지는 것은
 * `SerializationException`뿐**이라 `APIClient`가 `APIError.Decoding`으로 접고 `optional { }`이 null로
 * 접는다 — `Map.getValue`의 `NoSuchElementException`은 그 분류를 뚫어 "조회 실패"가 크래시가 된다.
 * 없는 키와 `null` 값 모두 실패다(Swift `decode`는 valueNotFound). 등록부 밖 직렬화 보조.
 */
internal fun JsonObject.required(key: String): JsonElement {
    val value = this[key]
    if (value == null || value is JsonNull) throw SerializationException("필수 키 '$key'가 없다")
    return value
}

internal fun JsonObject.requiredString(key: String): String {
    val value = required(key)
    if (value !is JsonPrimitive || !value.isString) throw SerializationException("'$key'는 문자열이어야 한다")
    return value.content
}

internal fun JsonObject.requiredInt(key: String): Int {
    val value = required(key) as? JsonPrimitive ?: throw SerializationException("'$key'는 정수여야 한다")
    return value.content.toIntOrNull() ?: throw SerializationException("'$key'는 정수여야 한다")
}

/** 선택 키의 원시값. 없거나 null이거나 객체·배열이면 null — 던지지 않는다(`jsonPrimitive`는 IllegalArgumentException을 낸다). */
internal fun JsonObject.optionalPrimitive(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

/**
 * 선택 문자열 키(Swift `decodeIfPresent(String.self)` 대응). 없거나 null이면 null, 문자열이면 그 값,
 * **객체·배열·숫자면 throw** — Swift가 typeMismatch로 실패하는 자리라 관대하게 접지 않는다(깨진 줄은 깨진 줄).
 */
internal fun JsonObject.optionalString(key: String): String? {
    val value = this[key] ?: return null
    if (value is JsonNull) return null
    val primitive = value as? JsonPrimitive ?: throw SerializationException("'$key'는 문자열이어야 한다")
    if (!primitive.isString) throw SerializationException("'$key'는 문자열이어야 한다")
    return primitive.content
}

internal fun JsonObject.requiredObject(key: String): JsonObject =
    required(key) as? JsonObject ?: throw SerializationException("'$key'는 객체여야 한다")

internal fun JsonObject.requiredArray(key: String): JsonArray =
    required(key) as? JsonArray ?: throw SerializationException("'$key'는 배열이어야 한다")

/** 디코딩 입력 자체가 객체가 아니면 실패(`decodeJsonElement()` 뒤 첫 줄). */
internal fun JsonElement.asObjectOrThrow(what: String): JsonObject =
    this as? JsonObject ?: throw SerializationException("$what: JSON 객체가 아니다")
