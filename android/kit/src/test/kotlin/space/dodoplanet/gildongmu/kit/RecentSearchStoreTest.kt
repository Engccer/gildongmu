package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 웹 `recent-searches.test.ts`·Kit `RecentSearchStoreTests`의 대표 케이스(기대값 재사용). 저장소는 메모리 맵.

private fun fresh() = InMemoryKeyValueStore()

class RecentQueryTest {
    @Test fun trimAndPrependAndIgnoreEmpty() {
        val store = RecentSearchStore(fresh())
        assertEquals(listOf(RecentQuery("경복궁")), store.recordQuery("  경복궁  "))
        assertEquals(listOf(RecentQuery("서울역"), RecentQuery("경복궁")), store.recordQuery("서울역"))
        assertEquals(listOf(RecentQuery("서울역"), RecentQuery("경복궁")), store.recordQuery("   "))
    }

    @Test fun dedupeMovesToTop() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b")
        assertEquals(listOf("a", "b"), store.recordQuery("a").map { it.text })
    }

    @Test fun capAt20() {
        val store = RecentSearchStore(fresh())
        for (i in 1..21) store.recordQuery("q$i")
        val list = store.queries()
        assertEquals(20, list.size)
        assertEquals("q21", list.first().text)
        assertFalse(list.map { it.text }.contains("q1"))
    }

    @Test fun removeAndClear() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b")
        assertEquals(listOf(RecentQuery("b")), store.removeQuery("a"))
        store.clearQueries()
        assertEquals(emptyList(), store.queries())
    }

    @Test fun corruptDataRecoversToEmpty() {
        val kv = fresh()
        kv.putString("recentQueries.v1", "{oops")
        assertEquals(emptyList(), RecentSearchStore(kv).queries())
        kv.putString("recentQueries.v2", "{oops")
        assertEquals(emptyList(), RecentSearchStore(kv).queries())
    }

    @Test fun migratesV1Strings() {
        val kv = fresh()
        kv.putString("recentQueries.v1", """["a","b"]""")
        val store = RecentSearchStore(kv)
        assertEquals(listOf(RecentQuery("a"), RecentQuery("b")), store.queries())
        assertEquals(listOf("c", "a", "b"), store.recordQuery("c").map { it.text })
    }

    @Test fun clearAfterMigrationDoesNotResurrectV1() {
        val kv = fresh()
        kv.putString("recentQueries.v1", """["a","b"]""")
        val store = RecentSearchStore(kv)
        assertEquals(2, store.queries().size)
        store.clearQueries() // 고정 없음 → v2에 빈 배열 저장(빈 v2 ≠ v2 부재)
        assertEquals(emptyList(), store.queries())
    }

    @Test fun pinAppendsToEndOfPinBlock() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b"); store.recordQuery("c") // [c, b, a]
        store.setQueryPinned("a", true) // [a(pin), c, b]
        assertEquals(listOf(RecentQuery("a", true), RecentQuery("b", true), RecentQuery("c")), store.setQueryPinned("b", true))
    }

    @Test fun unpinMovesToHeadOfUnpinnedBlock() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b") // [b, a]
        store.setQueryPinned("a", true) // [a(pin), b]
        assertEquals(listOf(RecentQuery("a"), RecentQuery("b")), store.setQueryPinned("a", false))
    }

    @Test fun recordingPinnedItemKeepsItsPlace() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b") // [b, a]
        store.setQueryPinned("a", true) // [a(pin), b]
        assertEquals(listOf(RecentQuery("a", true), RecentQuery("b")), store.recordQuery("a"))
        assertEquals(listOf("a", "c", "b"), store.recordQuery("c").map { it.text })
    }

    @Test fun capAppliesOnlyToUnpinned() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("keep"); store.setQueryPinned("keep", true)
        for (i in 1..21) store.recordQuery("q$i")
        val list = store.queries()
        assertEquals(21, list.size)
        assertEquals(RecentQuery("keep", true), list.first())
        assertFalse(list.map { it.text }.contains("q1"))
    }

    @Test fun clearKeepsPinned() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a"); store.recordQuery("b"); store.setQueryPinned("a", true)
        assertEquals(listOf(RecentQuery("a", true)), store.clearQueries())
        assertEquals(listOf(RecentQuery("a", true)), store.queries())
    }

    @Test fun pinUnknownItemIsNoOp() {
        val store = RecentSearchStore(fresh())
        store.recordQuery("a")
        assertEquals(listOf(RecentQuery("a")), store.setQueryPinned("ghost", true))
    }

    /** 목록 정체성(id)은 고정 토글·라벨 갱신에 불변이어야 한다 — 정체성이 바뀌면 화면이 행을 파괴+재생성해 SR 포커스가 이탈한다. */
    @Test fun listIdentityStableAcrossPinToggleAndLabelRefresh() {
        assertEquals(RecentQuery("a").id, RecentQuery("a", true).id)
        val home = RecentEndpoint("집", 37.5, 127.1)
        val toggled = RecentEndpoint("우리집", 37.50001, 127.09999, true)
        assertEquals(home.id, toggled.id)
        assertEquals(RecentRoute(null, home).id, RecentRoute(null, toggled, pinned = true).id)
        assertNotEquals(RecentRoute(home, null).id, RecentRoute(null, home).id)
    }
}

class RecentEndpointTest {
    private val gyeongbok = RecentEndpoint("경복궁", 37.579617, 126.977041)

    @Test fun recordRemoveClear() {
        val store = RecentSearchStore(fresh())
        assertEquals(listOf(gyeongbok), store.recordEndpoint(gyeongbok, RecentEndpointScope.to))
        assertEquals(emptyList(), store.removeEndpoint(gyeongbok, RecentEndpointScope.to))
        store.recordEndpoint(gyeongbok, RecentEndpointScope.to)
        store.clearEndpoints(RecentEndpointScope.to)
        assertEquals(emptyList(), store.endpoints(RecentEndpointScope.to))
    }

    @Test fun coord4DigitDedupeReplacesLabel() {
        val store = RecentSearchStore(fresh())
        store.recordEndpoint(gyeongbok, RecentEndpointScope.to)
        store.recordEndpoint(RecentEndpoint("서울역", 37.5547, 126.9707), RecentEndpointScope.to)
        val next = store.recordEndpoint(RecentEndpoint("경복궁 (고궁)", 37.5796172, 126.9770413), RecentEndpointScope.to)
        assertEquals(2, next.size)
        assertEquals("경복궁 (고궁)", next.first().label)
    }

    @Test fun capAt20() {
        val store = RecentSearchStore(fresh())
        for (i in 1..21) store.recordEndpoint(RecentEndpoint("p$i", i.toDouble(), i.toDouble()), RecentEndpointScope.to)
        assertEquals(20, store.endpoints(RecentEndpointScope.to).size)
        assertEquals("p21", store.endpoints(RecentEndpointScope.to).first().label)
    }

    @Test fun fromAndToAreSeparated() {
        val store = RecentSearchStore(fresh())
        store.recordEndpoint(gyeongbok, RecentEndpointScope.from)
        assertEquals(emptyList(), store.endpoints(RecentEndpointScope.to))
        store.recordEndpoint(RecentEndpoint("서울역", 37.5547, 126.9707), RecentEndpointScope.to)
        assertEquals(listOf(gyeongbok), store.endpoints(RecentEndpointScope.from))
        store.clearEndpoints(RecentEndpointScope.from)
        assertEquals(emptyList(), store.endpoints(RecentEndpointScope.from))
        assertEquals(1, store.endpoints(RecentEndpointScope.to).size)
    }

    @Test fun legacyDataWithoutPinnedDecodesUnpinned() {
        val kv = fresh()
        kv.putString("recentEndpoints.to.v1", """[{"label":"집","lat":37.5,"lng":127.1}]""")
        assertEquals(listOf(RecentEndpoint("집", 37.5, 127.1)), RecentSearchStore(kv).endpoints(RecentEndpointScope.to))
    }

    @Test fun pinKeepsTopAndLabelRefreshKeepsPlaceAndClearKeepsPins() {
        val store = RecentSearchStore(fresh())
        val home = RecentEndpoint("집", 37.5, 127.1)
        store.recordEndpoint(home, RecentEndpointScope.to)
        store.recordEndpoint(RecentEndpoint("회사", 37.6, 127.0), RecentEndpointScope.to)
        store.setEndpointPinned(home, RecentEndpointScope.to, true)
        assertEquals(listOf("집", "회사"), store.endpoints(RecentEndpointScope.to).map { it.label })
        val relabeled = store.recordEndpoint(RecentEndpoint("우리집", 37.5, 127.1), RecentEndpointScope.to)
        assertEquals(RecentEndpoint("우리집", 37.5, 127.1, true), relabeled.first())
        for (i in 1..21) store.recordEndpoint(RecentEndpoint("p$i", i.toDouble(), i.toDouble()), RecentEndpointScope.to)
        assertEquals(21, store.endpoints(RecentEndpointScope.to).size)
        assertEquals(listOf("우리집"), store.clearEndpoints(RecentEndpointScope.to).map { it.label })
    }
}

class RecentRouteTest {
    private val home = RecentEndpoint("자택", 37.535, 127.145)
    private val school = RecentEndpoint("신명중학교", 37.529, 127.138)

    @Test fun prependAndDedupeByPair() {
        val store = RecentSearchStore(fresh())
        val a = RecentRoute(home, school)
        val b = RecentRoute(null, school)
        assertEquals(listOf(a), store.recordRoute(a))
        assertEquals(listOf(b, a), store.recordRoute(b))
        val relabeled = RecentRoute(RecentEndpoint("자택 아파트", home.lat, home.lng), school)
        assertEquals(listOf(relabeled, b), store.recordRoute(relabeled))
    }

    @Test fun rejectsBothCurrent() {
        val store = RecentSearchStore(fresh())
        assertEquals(emptyList(), store.recordRoute(RecentRoute(null, null)))
        assertEquals(emptyList(), store.routes())
    }

    @Test fun capAt20() {
        val store = RecentSearchStore(fresh())
        for (i in 0 until 25) store.recordRoute(RecentRoute(null, RecentEndpoint("t$i", 37 + i * 0.01, 127.0)))
        assertEquals(20, store.routes().size)
    }

    @Test fun removeClearAndDecodeRecovery() {
        val kv = fresh()
        val store = RecentSearchStore(kv)
        val a = RecentRoute(home, school)
        val b = RecentRoute(null, school)
        store.recordRoute(a); store.recordRoute(b)
        assertEquals(listOf(a), store.removeRoute(b))
        store.clearRoutes()
        assertEquals(emptyList(), store.routes())
        kv.putString("recentRoutes.v1", "broken")
        assertEquals(emptyList(), store.routes())
    }

    @Test fun legacyDataWithoutPinnedDecodesUnpinned() {
        val kv = fresh()
        kv.putString("recentRoutes.v1", """[{"from":null,"to":{"label":"학교","lat":37.529,"lng":127.138}}]""")
        assertEquals(listOf(RecentRoute(null, RecentEndpoint("학교", 37.529, 127.138))), RecentSearchStore(kv).routes())
    }

    @Test fun pinnedRouteStaysOnTopAcrossRecordsAndClear() {
        val store = RecentSearchStore(fresh())
        val toSchool = RecentRoute(home, school)
        val toWork = RecentRoute(null, RecentEndpoint("회사", 37.6, 127.0))
        store.recordRoute(toSchool); store.recordRoute(toWork)
        store.setRoutePinned(toSchool, true)
        assertEquals("신명중학교", store.routes().first().to?.label)
        store.recordRoute(toWork)
        assertEquals("신명중학교", store.routes().first().to?.label)
        assertTrue(store.routes().first().pinned)
        assertEquals(1, store.clearRoutes().size)
        store.setRoutePinned(store.routes()[0], false)
        assertEquals(emptyList(), store.clearRoutes())
    }
}

class RecentRouteViaTest {
    @Test fun viaDistinguishesIdentityAndSurvivesPin() {
        val store = RecentSearchStore(fresh())
        val a = RecentEndpoint("A", 37.5, 127.1)
        val b = RecentEndpoint("B", 37.6, 127.2)
        val c = RecentEndpoint("C", 37.55, 127.15)
        store.recordRoute(RecentRoute(a, b))
        val list = store.recordRoute(RecentRoute(a, b, c))
        assertEquals(2, list.size)
        assertEquals("C", list.first().via?.label)
        assertNotEquals(RecentRoute(a, b).id, RecentRoute(a, b, c).id)
        val pinned = store.setRoutePinned(RecentRoute(a, b, c), true)
        assertTrue(pinned.first().via?.label == "C" && pinned.first().pinned)
        val again = store.recordRoute(RecentRoute(a, b, c))
        assertTrue(again.size == 2 && again.first().via?.label == "C" && again.first().pinned)
        val removed = store.removeRoute(RecentRoute(a, b, c))
        assertTrue(removed.size == 1 && removed.first().via == null)
    }

    @Test fun legacyRouteWithoutViaDecodes() {
        val r = KitJson.decodeFromString(RecentRoute.serializer(), """{"from":null,"to":{"label":"B","lat":37.6,"lng":127.2}}""")
        assertNull(r.via); assertFalse(r.pinned); assertEquals("B", r.to?.label)
    }
}
