package space.dodoplanet.gildongmu.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import java.net.HttpURLConnection
import java.net.URL

/**
 * `HttpTransport`의 안드로이드 구현([3] 실행 계층). :kit `APIClient`가 URL 조립·상태 분류·디코딩을 맡고
 * 여기는 바이트를 오갈 뿐이다. 타임아웃 만료는 `SocketTimeoutException`(IOException)이고 그 밖의 실패도
 * `APIClient`가 전부 `APIError.Network`로 접는다(인터페이스 계약).
 */
class HttpUrlConnectionTransport : HttpTransport {
    override suspend fun get(url: String, timeoutMs: Long?): HttpResponse = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "application/json")
            val timeout = (timeoutMs ?: DEFAULT_TIMEOUT_MS).toInt()
            connection.connectTimeout = timeout
            connection.readTimeout = timeout
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { it.readBytes().decodeToString() } ?: ""
            HttpResponse(status, body)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** iOS URLSession 기본값과 같은 60초. 보조 요청은 호출부가 예산을 명시한다(`APIClient.get` KDoc). */
        const val DEFAULT_TIMEOUT_MS = 60_000L
    }
}
