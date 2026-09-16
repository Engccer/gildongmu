package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer
import space.dodoplanet.gildongmu.kit.models.APIErrorBody
import java.io.IOException
import java.net.URLEncoder

/**
 * 라우트 오류 분류. Kit `APIError` 미러. 3-state 불변식의 전송 계층 받침대: "빈 결과"는 성공
 * 디코딩의 빈 배열이고, 여기의 오류는 전부 "조회 실패"다.
 */
sealed class APIError(message: String?, cause: Throwable? = null) : Exception(message, cause) {
    class BadStatus(val code: Int, val serverMessage: String?) : APIError("HTTP $code: ${serverMessage ?: ""}")
    class Decoding(cause: Throwable) : APIError(cause.message, cause)
    class Network(cause: Throwable) : APIError(cause.message, cause)

    /** 좌표가 대한민국 서비스 커버리지 밖(서버가 `{"outOfCoverage":true}` 마커로 응답). */
    object OutOfCoverage : APIError("outOfCoverage")

    /**
     * 한국 **안**이지만 그 도메인 데이터가 그 지역에 없음(따릉이·문화행사 = 서울 전용, 버스 = TAGO
     * 미보유 시군). `OutOfCoverage`와 층이 다르다: 그 메뉴 하나만 무용하고 나머지 기능은 정상이다.
     * ⚠ 빈 결과로 흡수 금지, 사유도 뭉개지 말 것.
     */
    class UnavailableHere(val reason: UnavailableHereReason) : APIError("unavailableHere: $reason")
}

/** 서비스 지역 미제공 사유. 서버 문자열과 1:1이고, **모르는 값은 사유가 아니라 부재로 다룬다**. */
enum class UnavailableHereReason {
    seoulOnly, noBusData;

    companion object {
        fun fromRawValue(raw: String): UnavailableHereReason? = entries.firstOrNull { it.name == raw }
    }
}

/** 전송 응답. 본문은 UTF-8 문자열(라우트는 전부 JSON). */
data class HttpResponse(val status: Int, val body: String)

/**
 * 실행 계층 인터페이스(D5 경계). :kit은 URL 조립·상태 분류·마커 감지·디코딩(판정)만 하고,
 * 실제 전송은 :app이 안드로이드 방식(`HttpURLConnection`)으로 구현한다. 테스트는 스텁.
 *
 * 예외 계약: 구현이 던지는 것은 무엇이든 `APIClient`가 `APIError.Network`로 접는다 — `IOException`,
 * `withTimeout`의 `TimeoutCancellationException`, 그 밖의 런타임 예외 전부(Swift가 `session.data` 실패
 * 전부를 `.network`로 감싸는 것과 같다). 바깥 코루틴의 취소(`CancellationException`)만 그대로 통과한다.
 * `timeoutMs`는 밀리초다(Swift `timeout`은 초 — 호출부가 Kotlin뿐이라 단위만 다르다).
 */
interface HttpTransport {
    suspend fun get(url: String, timeoutMs: Long?): HttpResponse
}

/**
 * Vercel `/api/...` 소비 전용 최소 클라이언트. Kit `APIClient` 미러. base URL 주입(디버그 로컬 dev 지원).
 */
class APIClient(val baseURL: String, val transport: HttpTransport) {
    /**
     * `timeoutMs`를 주면 그 안에 끝나지 않는 요청을 포기한다(null이면 전송 구현 기본값).
     * ⚠ 조회 흐름 중간에 직렬로 끼는 보조 요청은 예산을 명시해야 한다 — 상한이 없으면 upstream이
     * 느려질 때 본 조회 전체가 그만큼 멈추고, 시각장애 사용자에게 그 침묵은 고장과 구분되지 않는다.
     */
    suspend fun <T> get(
        path: String,
        query: List<QueryItem>,
        deserializer: DeserializationStrategy<T>,
        timeoutMs: Long? = null,
    ): T {
        val response = try {
            transport.get(url(path, query), timeoutMs)
        } catch (e: TimeoutCancellationException) {
            // `withTimeout`은 자기 호출자에게만 던진다 — 바깥 취소와 혼동되지 않아 Network로 접어도 안전하다.
            throw APIError.Network(e)
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw APIError.Network(e)
        } catch (e: RuntimeException) {
            throw APIError.Network(e)
        }
        if (response.status !in 200..299) {
            val message = runCatching { KitJson.decodeFromString(APIErrorBody.serializer(), response.body).error }.getOrNull()
            throw APIError.BadStatus(response.status, message)
        }
        val element = try {
            KitJson.parseToJsonElement(response.body)
        } catch (e: SerializationException) {
            throw APIError.Decoding(e)
        }
        coverageMarker(element)?.let { throw it }
        return try {
            KitJson.decodeFromJsonElement(deserializer, element)
        } catch (e: SerializationException) {
            throw APIError.Decoding(e)
        } catch (e: IllegalArgumentException) {
            throw APIError.Decoding(e)
        }
    }

    suspend inline fun <reified T> get(path: String, query: List<QueryItem>, timeoutMs: Long? = null): T =
        get(path, query, serializer<T>(), timeoutMs)

    /** 절대 URL 조립. 값은 RFC 3986 퍼센트 인코딩(공백은 `%20` — Swift `URLQueryItem`과 같은 모양). */
    fun url(path: String, query: List<QueryItem>): String {
        val base = baseURL.trimEnd('/') + path
        if (query.isEmpty()) return base
        return base + "?" + query.joinToString("&") { (name, value) -> encode(name) + "=" + encode(value) }
    }

    // ⚠ `URLEncoder.encode(String, Charset)` 오버로드는 Android API 33에서 추가됐다 — minSdk 31·32 기기에서
    // NoSuchMethodError. :kit은 JVM 테스트라 어느 게이트도 못 잡으므로 API 1 오버로드(`"UTF-8"`)만 쓴다.
    private fun encode(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20").replace("%7E", "~")

    /** 서버 커버리지 마커 감지. 정상 페이로드엔 이 필드가 없어 오탐 불가(값 비교까지 한다). */
    private fun coverageMarker(element: JsonElement): APIError? {
        val obj = runCatching { element.jsonObject }.getOrNull() ?: return null
        // 불리언 타입만 마커다(Swift `OutOfCoverageMarker: Bool`) — 문자열 "true"는 마커가 아니다.
        val marker = obj["outOfCoverage"] as? JsonPrimitive
        if (marker != null && !marker.isString && marker.booleanOrNull == true) return APIError.OutOfCoverage
        val reason = (obj["unavailableHere"] as? JsonPrimitive)?.contentOrNull?.let(UnavailableHereReason::fromRawValue)
        return reason?.let { APIError.UnavailableHere(it) }
    }
}

/**
 * Swift `try?` 대응 — 조회 실패(`APIError`)만 null로 접는다. 취소는 통과시킨다. 서비스들이 공유하는
 * 관용구다(`SearchService`·CORE의 `NearbyService`·`StationService`·`RouteService`…가 각자 복사하지 않는다).
 * ⚠ `runCatching`은 취소까지 삼키므로 suspend 블록 안에서 쓰지 않는다.
 */
internal suspend fun <T> optional(block: suspend () -> T): T? = try {
    block()
} catch (_: APIError) {
    null
}
