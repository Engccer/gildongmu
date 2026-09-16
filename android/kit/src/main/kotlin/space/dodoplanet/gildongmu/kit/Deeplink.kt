package space.dodoplanet.gildongmu.kit

// 네이버·카카오 지도 앱 딥링크 빌더. 웹 `src/lib/deeplink.ts`·`deeplink-kakao.ts` ↔ Kit `Deeplink.swift` 미러.
// 실주행 내비는 네이티브 지도 앱에 위임한다(spec §4). 권역 밖 목적지는 null(`isInKorea` 판정).
//
// 반환은 `String`이다(Swift `URL?`) — :kit에 `android.net.Uri`가 없어 :app이 `Uri.parse`로 연다.
// 쿼리 인코딩은 Swift `URLComponents.queryItems`와 같은 허용 집합을 쓴다: `ep=37.4979,127.0276`처럼
// 쉼표는 그대로 둔다(웹 `URLSearchParams`는 `%2C` — 지도 앱은 둘 다 읽는다, Swift가 정본).

/** 길찾기 이동 수단. rawValue는 nmap route 경로 세그먼트와 일치(publicTransit만 "public"). */
enum class RouteMode(val rawValue: String) {
    walk("walk"),
    publicTransit("public"),
    car("car"),
    bike("bike");

    /** kakaomap://route 의 by 파라미터(공식: car, publictransit, foot, bicycle) */
    internal val kakaoBy: String
        get() = when (this) {
            walk -> "foot"
            publicTransit -> "publictransit"
            car -> "car"
            bike -> "bicycle"
        }

    /** map.kakao.com/link/by/{수단} 경로 세그먼트 */
    internal val kakaoWebBy: String
        get() = when (this) {
            walk -> "walk"
            publicTransit -> "traffic"
            car -> "car"
            bike -> "bicycle"
        }

    companion object {
        fun fromRawValue(raw: String): RouteMode? = entries.firstOrNull { it.rawValue == raw }
    }
}

data class RouteDestination(val lat: Double, val lng: Double, val name: String)

/** 네이버 지도 길찾기 딥링크. 출발지 생략 = 앱이 현재 위치 출발(웹 계약 동일). appname은 nmap 스킴 필수 파라미터. */
fun buildNaverRouteDeeplink(mode: RouteMode, dest: RouteDestination, appname: String): String? {
    if (!isInKorea(dest.lat, dest.lng)) return null
    return "nmap://route/${mode.rawValue}?" + queryString(
        "dlat" to dest.lat.toString(),
        "dlng" to dest.lng.toString(),
        "dname" to dest.name,
        "appname" to appname,
    )
}

/** 카카오맵 길찾기 딥링크. 출발지(sp) 생략 = 현재 위치 출발. */
fun buildKakaoRouteDeeplink(mode: RouteMode, dest: RouteDestination): String? {
    if (!isInKorea(dest.lat, dest.lng)) return null
    return "kakaomap://route?" + queryString("ep" to "${dest.lat},${dest.lng}", "by" to mode.kakaoBy)
}

/** 카카오맵 장소 상세 딥링크. 호출 측이 Place.id의 "kakao-" 접두를 제거해 전달한다. */
fun buildKakaoPlaceDeeplink(kakaoPlaceId: String): String =
    "kakaomap://place?" + queryString("id" to kakaoPlaceId)

/** 길찾기 웹 URL: 카카오맵 미설치 폴백(웹 계약: /link/by/{수단}/{이름},{위도},{경도}). */
fun buildKakaoWebRouteUrl(mode: RouteMode, dest: RouteDestination): String? {
    if (!isInKorea(dest.lat, dest.lng)) return null
    val name = percentEncode(dest.name, URL_PATH_ALLOWED)
    return "https://map.kakao.com/link/by/${mode.kakaoWebBy}/$name,${dest.lat},${dest.lng}"
}

private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

/** Foundation `.urlQueryAllowed`에서 `&`·`=`을 뺀 집합 — `URLComponents.queryItems`가 이름·값에 쓰는 규칙. */
private const val URL_QUERY_ITEM_ALLOWED = UNRESERVED + "!$'()*+,;:@/?"

/** Foundation `.urlPathAllowed`(`;`는 없다 — 쿼리 집합과 다르다). */
private const val URL_PATH_ALLOWED = UNRESERVED + "!$&'()*+,=:@/"

private const val HEX = "0123456789ABCDEF"

private fun queryString(vararg items: Pair<String, String>): String =
    items.joinToString("&") { (name, value) ->
        percentEncode(name, URL_QUERY_ITEM_ALLOWED) + "=" + percentEncode(value, URL_QUERY_ITEM_ALLOWED)
    }

/** UTF-8 바이트 단위 퍼센트 인코딩. `allowed`에 든 ASCII만 그대로 둔다. */
private fun percentEncode(value: String, allowed: String): String {
    val out = StringBuilder()
    for (byte in value.encodeToByteArray()) {
        val b = byte.toInt() and 0xFF
        if (b < 0x80 && b.toChar() in allowed) out.append(b.toChar())
        else out.append('%').append(HEX[b shr 4]).append(HEX[b and 0x0F])
    }
    return out.toString()
}
