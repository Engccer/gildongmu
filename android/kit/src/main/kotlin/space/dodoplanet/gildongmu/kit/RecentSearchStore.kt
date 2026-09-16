package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.util.Locale

/** 최근 검색어 항목(검색 탭). v1은 순수 문자열 배열이었고 v2 키로 승계한다. */
@Serializable
data class RecentQuery(val text: String, val pinned: Boolean = false) {
    /** 목록 정체성 — dedupe 판정과 같은 축(고정 토글에 불변). 화면 키로 쓴다. */
    val id: String get() = text
}

/** 최근 검색 장소 항목(길찾기 endpoint 기록). 좌표 소수 4자리(≈11m) 일치 = 같은 장소. */
@Serializable
data class RecentEndpoint(val label: String, val lat: Double, val lng: Double,
    /** 고정 여부. ⚠ RecentRoute의 from/to에 실릴 때는 무의미하다. 부재(v1 데이터)는 false. */
    val pinned: Boolean = false,
) {
    /** 좌표 4자리 키 — sameCoord와 같은 축(라벨 변형·고정 토글에 불변). */
    val id: String get() = String.format(Locale.ROOT, "%.4f,%.4f", lat, lng)
}

/** 최근 조회 경로(출발·도착 쌍). null = "현재 위치" — 활성화 시점에 재측위하므로 좌표를 굳히지 않는다. */
@Serializable
data class RecentRoute(
    val from: RecentEndpoint? = null,
    val to: RecentEndpoint? = null,
    /** 경유지(N4) — 동일 판정·정체성에 포함된다. 경유지는 장소뿐이라 null = 경유지 없음. */
    val via: RecentEndpoint? = null,
    val pinned: Boolean = false,
) {
    /** 출발·도착·경유 키 — sameRoute와 같은 축(null = 현재 위치, 경유 null = 없음). */
    val id: String get() = "${from?.id ?: "cur"}>${to?.id ?: "cur"}>${via?.id ?: "-"}"
}

/** 길찾기 필드 스코프 — 출발지·도착지·경유지 기록은 분리 저장한다. */
enum class RecentEndpointScope { from, to, via;
    val rawValue: String get() = name
}

/**
 * 저장 계층 인터페이스(D5 경계). :app은 `SharedPreferences`로 구현하고 테스트는 메모리 맵.
 * 값은 JSON 문자열. `getString`의 null은 "키 부재"다 — 빈 목록("[]")과 구분된다(v2 승계 판정).
 */
interface KeyValueStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
}

/**
 * 최근 검색 기록 저장소(웹 `src/lib/recent-searches.ts` ↔ Kit `RecentSearchStore` 미러).
 * 검색어·장소(출발/도착/경유 각각)·경로 목록 분리 기록, 기기 로컬 전용. 파싱 실패는 빈 목록으로
 * 조용히 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
 *
 * 고정(pin) 불변식: 저장 배열 = [고정 블록(고정 시점 순)] + [비고정 최신순, cap 20].
 * dedupe 판정은 pinned를 보지 않는다(같은 항목의 고정본·비고정본 공존 금지).
 */
class RecentSearchStore(private val store: KeyValueStore) {
    companion object {
        const val cap = 20
        internal const val queriesKeyV1 = "recentQueries.v1"
        internal const val queriesKeyV2 = "recentQueries.v2"
        internal const val routesKey = "recentRoutes.v1"
        internal fun endpointsKey(scope: RecentEndpointScope): String = "recentEndpoints.${scope.rawValue}.v1"

        internal fun sameCoord(a: RecentEndpoint, b: RecentEndpoint): Boolean =
            String.format(Locale.ROOT, "%.4f", a.lat) == String.format(Locale.ROOT, "%.4f", b.lat) &&
                String.format(Locale.ROOT, "%.4f", a.lng) == String.format(Locale.ROOT, "%.4f", b.lng)

        /** 동일 판정: from·to·via 셋 전부(경유지 부재끼리도 동일). 웹 `sameRoute` 미러. */
        internal fun sameRoute(a: RecentRoute, b: RecentRoute): Boolean =
            sameSide(a.from, b.from) && sameSide(a.to, b.to) && sameSide(a.via, b.via)

        /** 한쪽 판정: 현재 위치(null)끼리 동일, place끼리는 좌표 4자리 일치. */
        internal fun sameSide(a: RecentEndpoint?, b: RecentEndpoint?): Boolean = when {
            a == null && b == null -> true
            a != null && b != null -> sameCoord(a, b)
            else -> false
        }

        /** 불변식 정규화: [고정(저장 순서 유지)] + [비고정(저장 순서 유지)]. 레거시·수기 데이터 방어용. */
        internal fun <T> partitionPinned(items: List<T>, isPinned: (T) -> Boolean): List<T> =
            items.filter(isPinned) + items.filter { !isPinned(it) }

        /**
         * 재기록: 같은 고정 항목이 있으면 자리 유지(최신본으로 교체 — 장소 라벨 갱신), 아니면 비고정 dup
         * 제거 후 고정 블록 바로 뒤 삽입, 비고정만 cap(웹 appendKeepingPins 미러).
         */
        internal fun <T> appendKeepingPins(
            item: T, items: List<T>,
            isSame: (T, T) -> Boolean, isPinned: (T) -> Boolean, withPinned: (T, Boolean) -> T,
        ): List<T> {
            val i = items.indexOfFirst { isPinned(it) && isSame(it, item) }
            if (i >= 0) {
                val out = items.toMutableList()
                out[i] = withPinned(item, true)
                return out
            }
            val pins = items.filter(isPinned)
            val rest = items.filter { !isPinned(it) && !isSame(it, item) }
            return pins + (listOf(withPinned(item, false)) + rest).take(cap)
        }

        /**
         * 고정 토글: 어느 방향이든 물리 위치는 두 블록의 경계(고정 = 고정 블록 맨 뒤, 해제 = 비고정 블록
         * 맨 앞 — 같은 자리다). 없는 항목은 no-op(웹 setPinnedIn 미러).
         */
        internal fun <T> setPinnedIn(
            item: T, items: List<T>, pinned: Boolean,
            isSame: (T, T) -> Boolean, isPinned: (T) -> Boolean, withPinned: (T, Boolean) -> T,
        ): List<T> {
            val idx = items.indexOfFirst { isSame(it, item) }
            if (idx < 0) return items
            val rest = items.toMutableList()
            rest.removeAt(idx)
            return rest.filter(isPinned) + listOf(withPinned(items[idx], pinned)) + rest.filter { !isPinned(it) }
        }
    }

    // MARK: 검색어

    fun queries(): List<RecentQuery> {
        // ⚠ "빈 v2"와 "v2 부재"를 구분한다 — 길이로 가르면 모두 지운 직후 v1이 부활한다.
        if (store.getString(queriesKeyV2) != null) {
            return partitionPinned(decode(queriesKeyV2, RecentQuery.serializer())) { it.pinned }
        }
        // v1(문자열 배열) 승계 — v1은 지우지 않는다(롤백 안전, 부가 기능이라 이중 보관 무해).
        return decode(queriesKeyV1, String.serializer()).map { RecentQuery(it) }
    }

    /** trim 후 기록. 빈 문자열은 무시(현재 목록 반환). */
    fun recordQuery(raw: String): List<RecentQuery> {
        val text = raw.trim()
        if (text.isEmpty()) return queries()
        return save(
            appendKeepingPins(RecentQuery(text), queries(),
                isSame = { a, b -> a.text == b.text }, isPinned = { it.pinned },
                withPinned = { q, p -> RecentQuery(q.text, p) }),
            queriesKeyV2, RecentQuery.serializer())
    }

    fun removeQuery(text: String): List<RecentQuery> =
        save(queries().filter { it.text != text }, queriesKeyV2, RecentQuery.serializer())

    /** 모두 지우기 — 고정은 보존한다(고정의 존재 이유). */
    fun clearQueries(): List<RecentQuery> =
        save(queries().filter { it.pinned }, queriesKeyV2, RecentQuery.serializer())

    fun setQueryPinned(text: String, pinned: Boolean): List<RecentQuery> =
        save(
            setPinnedIn(RecentQuery(text), queries(), pinned,
                isSame = { a, b -> a.text == b.text }, isPinned = { it.pinned },
                withPinned = { q, p -> RecentQuery(q.text, p) }),
            queriesKeyV2, RecentQuery.serializer())

    // MARK: 장소 (출발지·도착지·경유지 스코프 분리)

    fun endpoints(scope: RecentEndpointScope): List<RecentEndpoint> =
        partitionPinned(decode(endpointsKey(scope), RecentEndpoint.serializer())) { it.pinned }

    /** 좌표 4자리 dedupe — 같은 장소의 라벨 변형은 최신 라벨로 교체한다(고정 항목은 자리 유지, 비고정은 끌어올림). */
    fun recordEndpoint(endpoint: RecentEndpoint, scope: RecentEndpointScope): List<RecentEndpoint> =
        save(
            appendKeepingPins(endpoint, endpoints(scope),
                isSame = ::sameCoord, isPinned = { it.pinned },
                withPinned = { e, p -> RecentEndpoint(e.label, e.lat, e.lng, p) }),
            endpointsKey(scope), RecentEndpoint.serializer())

    fun removeEndpoint(endpoint: RecentEndpoint, scope: RecentEndpointScope): List<RecentEndpoint> =
        save(endpoints(scope).filter { !sameCoord(it, endpoint) }, endpointsKey(scope), RecentEndpoint.serializer())

    /** 모두 지우기 — 고정은 보존한다. */
    fun clearEndpoints(scope: RecentEndpointScope): List<RecentEndpoint> =
        save(endpoints(scope).filter { it.pinned }, endpointsKey(scope), RecentEndpoint.serializer())

    fun setEndpointPinned(endpoint: RecentEndpoint, scope: RecentEndpointScope, pinned: Boolean): List<RecentEndpoint> =
        save(
            setPinnedIn(endpoint, endpoints(scope), pinned,
                isSame = ::sameCoord, isPinned = { it.pinned },
                withPinned = { e, p -> RecentEndpoint(e.label, e.lat, e.lng, p) }),
            endpointsKey(scope), RecentEndpoint.serializer())

    // MARK: 경로 (출발·도착 쌍)

    fun routes(): List<RecentRoute> =
        partitionPinned(decode(routesKey, RecentRoute.serializer())) { it.pinned }

    /** 쌍 단위 dedupe 끌어올림(고정 쌍은 자리 유지). 양측 null(현재 위치→현재 위치)은 재조회 의미가 없어 무기록. */
    fun recordRoute(route: RecentRoute): List<RecentRoute> {
        if (route.from == null && route.to == null) return routes()
        return save(
            appendKeepingPins(route, routes(),
                isSame = ::sameRoute, isPinned = { it.pinned },
                withPinned = { r, p -> RecentRoute(r.from, r.to, r.via, p) }),
            routesKey, RecentRoute.serializer())
    }

    fun removeRoute(route: RecentRoute): List<RecentRoute> =
        save(routes().filter { !sameRoute(it, route) }, routesKey, RecentRoute.serializer())

    /** 모두 지우기 — 고정은 보존한다. */
    fun clearRoutes(): List<RecentRoute> =
        save(routes().filter { it.pinned }, routesKey, RecentRoute.serializer())

    fun setRoutePinned(route: RecentRoute, pinned: Boolean): List<RecentRoute> =
        save(
            setPinnedIn(route, routes(), pinned,
                isSame = ::sameRoute, isPinned = { it.pinned },
                withPinned = { r, p -> RecentRoute(r.from, r.to, r.via, p) }),
            routesKey, RecentRoute.serializer())

    // MARK: 내부

    private fun <T> decode(key: String, element: KSerializer<T>): List<T> {
        val raw = store.getString(key) ?: return emptyList()
        return try {
            KitJson.decodeFromString(ListSerializer(element), raw)
        } catch (_: SerializationException) {
            emptyList()
        } catch (_: IllegalArgumentException) {
            emptyList()
        }
    }

    private fun <T> save(items: List<T>, key: String, element: KSerializer<T>): List<T> {
        store.putString(key, KitJson.encodeToString(ListSerializer(element), items))
        return items
    }
}
