package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.ReverseGeocodeResponse

/** iOS 미러: 측위 시작부터 주소 커밋까지 하나의 요청이 소유한다. 호출자는 같은 스레드에서 사용한다. */
class DirectionsAddressState {
    class Request internal constructor(val language: String)
    data class Address(val original: String?, val english: String?)

    var address = Address(null, null)
        private set
    var hasLoaded = false
        private set
    var isLoading = false
        private set
    private var latest: Request? = null

    fun begin(language: String): Request = Request(language).also {
        latest = it
        isLoading = true
    }

    fun accepts(request: Request, language: String, isCancelled: Boolean): Boolean =
        !isCancelled && latest == request && request.language == language

    fun finish(request: Request): Boolean {
        if (latest != request) return false
        isLoading = false
        return true
    }

    fun cancel() {
        latest = null
        isLoading = false
    }

    fun commit(response: ReverseGeocodeResponse?, request: Request, language: String, isCancelled: Boolean): Boolean {
        if (!accepts(request, language, isCancelled)) return false
        address = Address(response?.address, if (response?.address == null) null else response.english)
        hasLoaded = true
        finish(request)
        return true
    }
}
