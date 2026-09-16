package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.AddressMatch
import space.dodoplanet.gildongmu.kit.models.AddressSearchResponse
import space.dodoplanet.gildongmu.kit.models.GeocodeResponse
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSearchResult
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import space.dodoplanet.gildongmu.kit.models.ReverseGeocodeResponse
import space.dodoplanet.gildongmu.kit.models.WebSearchResponse
import space.dodoplanet.gildongmu.kit.models.WebSearchResult

/**
 * 섹션 하나의 3-state: 성공(빈 배열 포함)과 조회 실패를 분리한다. "0건"과 "실패"를 뭉개지
 * 않는 3-state 불변식의 타입 표현(뷰가 섹션별로 실패를 낭독 가능). Kit `SectionState` 미러.
 */
sealed class SectionState<out T> {
    abstract val items: List<T>
    val isFailed: Boolean get() = this is Failed

    data class Loaded<T>(override val items: List<T>) : SectionState<T>()
    data object Failed : SectionState<Nothing>() {
        override val items: List<Nothing> get() = emptyList()
    }
}

/** 검색 결과 섹션 하나. 순서는 `SearchOutcome.orderedSections`가 정한다. */
sealed class SearchSection {
    abstract val count: Int

    data class Places(val items: List<Place>) : SearchSection() { override val count get() = items.size }
    data class Addresses(val items: List<JusoAddress>) : SearchSection() { override val count get() = items.size }
    data class Web(val items: List<WebSearchResult>) : SearchSection() { override val count get() = items.size }
}

/** 한 검색의 최종 산출. */
data class SearchOutcome(
    val places: SectionState<Place>,
    val addresses: SectionState<JusoAddress>,
    val web: SectionState<WebSearchResult>,
    /**
     * 장소 섹션에 답한 provider(`PlaceSearchResult.provider`, 실패면 null). 앱은 서버 키를 모르므로
     * "merged"·"naver-local"이 곧 네이버 키 보유의 유일한 관측 채널이다(리뷰순 토글 노출 조건).
     */
    val placesProvider: String? = null,
) {
    /** 정본 두 트랙(장소·주소) 호출이 모두 실패했는가. 빈 결과의 성공 응답은 false. */
    val allFailed: Boolean get() = places.isFailed && addresses.isFailed

    /** 빈 섹션 제외 + 건수 내림차순(웹 orderResultSections 미러, 안정 정렬). */
    val orderedSections: List<SearchSection>
        get() = listOf(SearchSection.Places(places.items), SearchSection.Addresses(addresses.items), SearchSection.Web(web.items))
            .filter { it.count > 0 }
            .sortedByDescending { it.count }
}

/**
 * 검색 오케스트레이션. 웹 runQuerySearch ↔ Kit `SearchService` 미러: 장소+주소 병렬, 웹은 둘 다
 * 0건일 때만, 섹션 실패는 `SectionState.Failed`로 격리. 좌표는 있으면 그대로 API로 전달해
 * 서버(카카오 정확도순+근접 블렌딩)가 정렬을 담당한다. 클라 재정렬은 하지 않는다.
 */
class SearchService(val client: APIClient) {
    /**
     * `includeWeb=false`는 길찾기 필드 후보 검색용(좌표가 필요해 웹 결과가 무의미, 유료 폴백 회피).
     * `sort=review`는 장소 트랙만 네이버 리뷰순으로 바꾼다. 미지정(accuracy)이면 sort 파라미터를 붙이지 않는다.
     */
    suspend fun search(
        query: String,
        lat: Double?,
        lng: Double?,
        lang: String,
        includeWeb: Boolean = true,
        sort: PlaceSort = PlaceSort.accuracy,
    ): SearchOutcome = coroutineScope {
        val coordQuery = ArrayList<QueryItem>()
        coordQuery.add("query" to query)
        if (lat != null && lng != null) {
            coordQuery.add("lat" to lat.toString())
            coordQuery.add("lng" to lng.toString())
        }
        val placesQuery = coordQuery + ("lang" to lang)
        val placesQueryWithSort = if (sort == PlaceSort.review) placesQuery + ("sort" to "review") else placesQuery
        val placesTask = async { optional { client.get<PlaceSearchResult>("/api/places", placesQueryWithSort) } }
        val addressTask = async { optional { client.get<AddressSearchResponse>("/api/address/search", listOf("query" to query)) } }

        val placesResult = placesTask.await()
        val places: SectionState<Place> = placesResult?.let { SectionState.Loaded(it.places) } ?: SectionState.Failed
        val addresses: SectionState<JusoAddress> = addressTask.await()?.let { SectionState.Loaded(it.addresses) } ?: SectionState.Failed

        // 웹 폴백: 정본 두 트랙이 모두 빈 결과일 때만(실패도 빈 결과로 취급, 기존 의미 유지).
        var web: SectionState<WebSearchResult> = SectionState.Loaded(emptyList())
        if (includeWeb && places.items.isEmpty() && addresses.items.isEmpty()) {
            val webResponse = optional { client.get<WebSearchResponse>("/api/search/web", listOf("query" to query)) }
            web = webResponse?.let { SectionState.Loaded(it.web) } ?: SectionState.Failed
        }
        SearchOutcome(places, addresses, web, placesProvider = placesResult?.provider)
    }

    /** 주소 → 좌표(카카오 지오코딩 프록시 `/api/geocode`). 실패는 throw(호출자가 coordError 통지, 3-state). */
    suspend fun geocode(query: String, limit: Int = 1): List<AddressMatch> {
        val response = client.get<GeocodeResponse>("/api/geocode", listOf("query" to query, "limit" to limit.toString()))
        return response.matches
    }

    /**
     * 좌표 → 대표 주소(역지오코딩 `/api/geocode/reverse`). 매칭 없음은 `address` null(정보 없음),
     * 실패는 throw. `lang`은 **기본값 없는 필수 인자**다 — en이면 서버가 공식 영문 또는 로마자를 함께 싣는다(E28).
     */
    suspend fun reverseGeocode(lat: Double, lng: Double, lang: String): ReverseGeocodeResponse =
        client.get("/api/geocode/reverse", listOf("lat" to lat.toString(), "lng" to lng.toString(), "lang" to lang))

    /**
     * 목적지 출입구 승격 조회(A11, `/api/places/entrance`). 어느 출입구인지는 **서버가 정한다** — 여기서는
     * 좌표 하나를 받아 그대로 목적지로 삼는다. 실패·부재 모두 null(둘 다 "대표 좌표로 안내"라는 같은 행동).
     */
    suspend fun destinationEntrance(
        name: String, lat: Double, lng: Double, fromLat: Double?, fromLng: Double?,
    ): EntranceMatch? {
        val query = ArrayList<QueryItem>()
        query.add("name" to name)
        query.add("lat" to lat.toString())
        query.add("lng" to lng.toString())
        if (fromLat != null && fromLng != null) {
            query.add("fromLat" to fromLat.toString())
            query.add("fromLng" to fromLng.toString())
        }
        // 웹 `fetchEntrance`와 같은 2초 예산. 대부분의 목적지는 출입구가 없어 이 왕복은 이득 없이
        // 본 조회 앞에 붙는 지연이고, 상한이 없으면 길찾기 조회 전체가 멈춘다.
        val response = optional { client.get<EntranceResponse>("/api/places/entrance", query, timeoutMs = 2_000) }
        return response?.entrance
    }

}

/** 승격된 출입구. `meters`는 대표 좌표에서의 거리(= 승격 폭). */
@Serializable
data class EntranceMatch(val name: String, val lat: Double, val lng: Double, val meters: Double)

@Serializable
internal data class EntranceResponse(val entrance: EntranceMatch? = null)
