package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.json.Json

/**
 * :kit 공용 JSON 설정(Swift `JSONDecoder()` 기본 동작의 미러).
 * - `ignoreUnknownKeys`: 서버가 필드를 늘려도 구버전 앱이 깨지지 않는다(additive 계약).
 * - `explicitNulls = false`: 없는 키는 null로 읽고, null 값은 인코딩에서 생략한다(Swift
 *   `encodeIfPresent`·서버 undefined 의미론 — `ChatRequestBody` 계약).
 */
val KitJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}
