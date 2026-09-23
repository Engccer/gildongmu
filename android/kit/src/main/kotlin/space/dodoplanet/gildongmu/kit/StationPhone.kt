package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSearchResult

// 역 장소 상세 개편(E44) — Kit `StationPhone.swift` 미러, spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md §3.1·§5.
// 순수 판정 + 얇은 조회 서비스. 정규식을 쓰지 않는다(문자 필터) — 약칭 클래스 금지 규칙(README §3)과 무관하게 두 엔진 차이가 0이다.

/**
 * 역 상세 레이아웃 종류(spec §3.1). `isStation`보다 좁다 — 출구 POI·시공업체·이름만 `역`으로 끝나는 장소는 null이고
 * null 장소의 상세는 개편 전 레이아웃 그대로다.
 */
enum class StationLayoutKind { subway, rail }

/**
 * Swift `category.split(separator: ">")`는 빈 조각을 버린다(`omittingEmptySubsequences` 기본값) — 자르기 **전에** 거르고,
 * 자른 뒤 빈 문자열이 된 조각(`" "`)은 남긴다(Swift와 같은 순서).
 */
fun stationLayoutKind(place: Place): StationLayoutKind? {
    if (place.id.startsWith("transit-stop:")) return StationLayoutKind.subway
    val segments = place.category.split('>').filter { it.isNotEmpty() }.map { it.trimSwiftWhitespaces() }
    val last = segments.lastOrNull()
    if ("지하철,전철" in segments && last != null && last != "지하철출구" && last != "지하철,전철") return StationLayoutKind.subway
    if ("기차역" in segments) return StationLayoutKind.rail
    return null
}

/**
 * 역 이름 비교 키(spec §5.4-1): 괄호 부기·공백·`.`·`·` 제거 뒤 끝 `역` 한 글자를 뗀다.
 * Swift `out.count > 1`은 문자(Character) 수라 코드포인트 수로 센다(UTF-16 길이가 아니다).
 */
fun stationNameKey(raw: String): String {
    val out = StringBuilder()
    var depth = 0
    for (ch in raw) {
        if (ch == '(') { depth += 1; continue }
        if (ch == ')') { depth = maxOf(0, depth - 1); continue }
        if (depth > 0 || ch == ' ' || ch == '.' || ch == '·') continue
        out.append(ch)
    }
    val s = out.toString()
    return if (s.codePointCount(0, s.length) > 1 && s.endsWith("역")) s.dropLast(1) else s
}

/** 카카오 검색어 — 괄호 부기를 뺀 역 이름에 `역`을 한 번만 붙인다(표기 구두점은 남긴다). */
fun stationPhoneQuery(raw: String): String {
    val out = StringBuilder()
    var depth = 0
    for (ch in raw) {
        if (ch == '(') { depth += 1; continue }
        if (ch == ')') { depth = maxOf(0, depth - 1); continue }
        if (depth == 0) out.append(ch)
    }
    val trimmed = out.toString().trimSwiftWhitespaces()
    return if (trimmed.endsWith("역")) trimmed else trimmed + "역"
}

/**
 * 노선 정체성(spec §5.4-2) — 웹 `subwayLineKey`와 같은 정규화(공백·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거) 뒤
 * 노선명 표의 영문 값. 미지 표기는 null.
 */
fun subwayLineIdentity(raw: String): String? {
    val s = raw.filter { it != ' ' && it != '.' }.removePrefix("수도권").removeSuffix("(급행)")
    return subwayLineIdentityTable[s]
}

/**
 * 웹 `src/lib/subway-line-names.ts` `LINE_EN` 미러(Swift `subwayLineIdentityTable`과 같은 순서) — 항목 동일은 `StationPhoneTest`가
 * 웹 원본을 읽어 강제한다(웹 ↔ Swift는 `station-phone-line-table-drift.test.ts`).
 */
internal val subwayLineIdentityTable: Map<String, String> = mapOf(
    "1호선" to "Line 1",
    "2호선" to "Line 2",
    "3호선" to "Line 3",
    "4호선" to "Line 4",
    "5호선" to "Line 5",
    "6호선" to "Line 6",
    "7호선" to "Line 7",
    "8호선" to "Line 8",
    "9호선" to "Line 9",
    "도시철도7호선" to "Line 7",
    "광역철도8호선" to "Line 8",
    "도시철도9호선" to "Line 9",
    "서울도시철도9호선" to "Line 9",
    "경의중앙선" to "Gyeongui-Jungang Line",
    "경의중앙" to "Gyeongui-Jungang Line",
    "중앙선" to "Jungang Line",
    "경춘선" to "Gyeongchun Line",
    "경춘" to "Gyeongchun Line",
    "수인분당선" to "Suin-Bundang Line",
    "수인분당" to "Suin-Bundang Line",
    "분당선" to "Bundang Line",
    "수인선" to "Suin Line",
    "신분당선" to "Shinbundang Line",
    "신분당" to "Shinbundang Line",
    "경강선" to "Gyeonggang Line",
    "경강" to "Gyeonggang Line",
    "서해선" to "Seohae Line",
    "서해" to "Seohae Line",
    "우이신설선" to "Ui-Sinseol Line",
    "우이신설" to "Ui-Sinseol Line",
    "신림선" to "Sillim Line",
    "신림" to "Sillim Line",
    "경량도시철도신림선" to "Sillim Line",
    "공항철도" to "AREX",
    "공항" to "AREX",
    "공항선" to "AREX",
    "인천국제공항선" to "AREX",
    "GTX-A" to "GTX-A",
    "GTX-A선" to "GTX-A",
    "김포도시철도" to "Gimpo Goldline",
    "김포골드라인" to "Gimpo Goldline",
    "의정부" to "Uijeongbu LRT",
    "의정부경전철" to "Uijeongbu LRT",
    "에버라인" to "EverLine",
    "용인에버라인" to "EverLine",
    "진접선" to "Jinjeop Line",
    "경부선" to "Gyeongbu Line",
    "경원선" to "Gyeongwon Line",
    "경인선" to "Gyeongin Line",
    "안산과천선" to "Ansan-Gwacheon Line",
    "일산선" to "Ilsan Line",
    "장항선" to "Janghang Line",
    "인천지하철1호선" to "Incheon Line 1",
    "인천지하철2호선" to "Incheon Line 2",
    "인천1호선" to "Incheon Line 1",
    "인천2호선" to "Incheon Line 2",
    "자기부상철도" to "Incheon Airport Maglev",
    "부산도시철도1호선" to "Busan Line 1",
    "부산도시철도2호선" to "Busan Line 2",
    "부산도시철도3호선" to "Busan Line 3",
    "부산경량도시철도4호선" to "Busan Line 4",
    "부산1호선" to "Busan Line 1",
    "부산2호선" to "Busan Line 2",
    "부산3호선" to "Busan Line 3",
    "부산4호선" to "Busan Line 4",
    "부산김해경전철" to "Busan-Gimhae LRT",
    "동해선" to "Donghae Line",
    "동해" to "Donghae Line",
    "대구도시철도1호선" to "Daegu Line 1",
    "대구도시철도2호선" to "Daegu Line 2",
    "대구도시철도3호선" to "Daegu Line 3",
    "대구1호선" to "Daegu Line 1",
    "대구2호선" to "Daegu Line 2",
    "대구3호선" to "Daegu Line 3",
    "대경선" to "Daegyeong Line",
    "대전도시철도1호선" to "Daejeon Line 1",
    "대전1호선" to "Daejeon Line 1",
    "광주도시철도1호선" to "Gwangju Line 1",
    "광주1호선" to "Gwangju Line 1",
)

/** 전국 대표번호(15xx·16xx·18xx 8자리) 판별(판정 ⑥). */
fun isRepresentativePhone(phone: String): Boolean {
    val digits = phone.filter { it in '0'..'9' }
    if (digits.length != 8) return false
    return digits.take(2) in setOf("15", "16", "18")
}

/** 조회 결과 3상태(spec §5.5) — 번호는 직통/대표번호로 갈린다. `Failed`는 서비스만 낸다. */
sealed class StationPhoneResult {
    data class Direct(val phone: String) : StationPhoneResult()
    data class Representative(val phone: String) : StationPhoneResult()
    data object Unavailable : StationPhoneResult()
    data object Failed : StationPhoneResult()
}

/** 동명이역 차단 상한(spec §5.4-3). */
const val stationPhoneMaxMeters: Double = 1_000.0

/** 역무실 POI 이름 접미(판정 ⑦). 앞 공백까지가 표기다 — "…역 3호선 역무실". */
internal const val stationOfficeNameSuffix = " 역무실"

/**
 * 후보 선택(spec §5.4): 역 키·노선 키 일치 ∧ 1,000m 이내인 지하철역 POI 중 번호 있는 것의 최근접.
 * 다른 노선 번호로 떨어지지 않는다(리뷰 M1).
 * 판정 ⑦(위원장 2026-09-17) — 같은 역·같은 노선의 "… 역무실" POI가 번호를 가지면 그것이 먼저다(환승역 역 POI가 다른 노선
 * 역무실 번호를 갖는 경우, 게이트 사례 가락시장 3호선). 역무실 POI는 분류로 거르지 않는다.
 */
fun pickStationPhone(places: List<Place>, stationName: String, lat: Double, lng: Double, lineName: String): StationPhoneResult {
    val key = stationNameKey(stationName)
    val line = subwayLineIdentity(lineName)
    if (key.isEmpty() || line == null) return StationPhoneResult.Unavailable
    var office: Pair<String, Double>? = null
    var station: Pair<String, Double>? = null
    for (place in places) {
        if (place.id.startsWith("transit-stop:")) continue
        // 역무실 POI는 접미를 뗀 이름으로 역 POI와 같은 이름·노선·거리·번호 규칙을 지난다.
        val isOffice = place.name.endsWith(stationOfficeNameSuffix)
        if (!isOffice && stationLayoutKind(place) != StationLayoutKind.subway) continue
        val label = if (isOffice) place.name.dropLast(stationOfficeNameSuffix.length) else place.name
        val space = label.lastIndexOf(' ')
        if (space < 0) continue
        val head = label.substring(0, space)
        val tail = label.substring(space + 1)
        if (stationNameKey(head) != key || subwayLineIdentity(tail) != line) continue
        val meters = haversineMeters(lat, lng, place.lat, place.lng)
        val phone = place.phone?.trimSwiftWhitespaces()
        if (meters > stationPhoneMaxMeters || phone.isNullOrEmpty()) continue
        if (isOffice) {
            if (office == null || meters < office.second) office = phone to meters
        } else if (station == null || meters < station.second) {
            station = phone to meters
        }
    }
    val best = (office ?: station)?.first ?: return StationPhoneResult.Unavailable
    return if (isRepresentativePhone(best)) StationPhoneResult.Representative(best) else StationPhoneResult.Direct(best)
}

/** 경유역 전화번호 조회(spec §5.3): `/api/places` 장소 트랙만(주소·유료 웹검색 호출 없음), 3초 상한, 언어는 항상 ko. */
class StationPhoneService(private val client: APIClient) {
    suspend fun lookup(stationName: String, lat: Double, lng: Double, lineName: String): StationPhoneResult {
        val query = listOf(
            "query" to stationPhoneQuery(stationName),
            "lat" to lat.toString(),
            "lng" to lng.toString(),
            "lang" to "ko",
        )
        return try {
            val result = client.get<PlaceSearchResult>("/api/places", query, timeoutMs = requestTimeoutMs)
            pickStationPhone(result.places, stationName, lat, lng, lineName)
        } catch (_: APIError) {
            // 바깥 취소는 `APIClient`가 통과시켜 여기 오지 않는다(`runCatching` 금지 — 취소를 삼킨다).
            StationPhoneResult.Failed
        }
    }

    companion object {
        /** Swift `timeout: 3`(초) 미러. */
        const val requestTimeoutMs = 3_000L
    }
}
