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
        assertEquals(RecentRoute(null, home, boardStation = null, alightStation = null).id, RecentRoute(null, toggled, pinned = true, boardStation = null, alightStation = null).id)
        assertNotEquals(RecentRoute(home, null, boardStation = null, alightStation = null).id, RecentRoute(null, home, boardStation = null, alightStation = null).id)
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
    private val home = RecentEndpoint("자택", 37.5665, 126.978)
    private val school = RecentEndpoint("신명중학교", 37.529, 127.138)

    @Test fun prependAndDedupeByPair() {
        val store = RecentSearchStore(fresh())
        val a = RecentRoute(home, school, boardStation = null, alightStation = null)
        val b = RecentRoute(null, school, boardStation = null, alightStation = null)
        assertEquals(listOf(a), store.recordRoute(a))
        assertEquals(listOf(b, a), store.recordRoute(b))
        val relabeled = RecentRoute(RecentEndpoint("자택 아파트", home.lat, home.lng), school, boardStation = null, alightStation = null)
        assertEquals(listOf(relabeled, b), store.recordRoute(relabeled))
    }

    @Test fun rejectsBothCurrent() {
        val store = RecentSearchStore(fresh())
        assertEquals(emptyList(), store.recordRoute(RecentRoute(null, null, boardStation = null, alightStation = null)))
        assertEquals(emptyList(), store.routes())
    }

    @Test fun capAt20() {
        val store = RecentSearchStore(fresh())
        for (i in 0 until 25) store.recordRoute(RecentRoute(null, RecentEndpoint("t$i", 37 + i * 0.01, 127.0), boardStation = null, alightStation = null))
        assertEquals(20, store.routes().size)
    }

    @Test fun removeClearAndDecodeRecovery() {
        val kv = fresh()
        val store = RecentSearchStore(kv)
        val a = RecentRoute(home, school, boardStation = null, alightStation = null)
        val b = RecentRoute(null, school, boardStation = null, alightStation = null)
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
        assertEquals(listOf(RecentRoute(null, RecentEndpoint("학교", 37.529, 127.138), boardStation = null, alightStation = null)), RecentSearchStore(kv).routes())
    }

    @Test fun pinnedRouteStaysOnTopAcrossRecordsAndClear() {
        val store = RecentSearchStore(fresh())
        val toSchool = RecentRoute(home, school, boardStation = null, alightStation = null)
        val toWork = RecentRoute(null, RecentEndpoint("회사", 37.6, 127.0), boardStation = null, alightStation = null)
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
        store.recordRoute(RecentRoute(a, b, boardStation = null, alightStation = null))
        val list = store.recordRoute(RecentRoute(a, b, c, boardStation = null, alightStation = null))
        assertEquals(2, list.size)
        assertEquals("C", list.first().via?.label)
        assertNotEquals(RecentRoute(a, b, boardStation = null, alightStation = null).id, RecentRoute(a, b, c, boardStation = null, alightStation = null).id)
        val pinned = store.setRoutePinned(RecentRoute(a, b, c, boardStation = null, alightStation = null), true)
        assertEquals("C", pinned.first().via?.label); assertTrue(pinned.first().pinned)
        val again = store.recordRoute(RecentRoute(a, b, c, boardStation = null, alightStation = null))
        assertEquals(2, again.size); assertEquals("C", again.first().via?.label); assertTrue(again.first().pinned)
        val removed = store.removeRoute(RecentRoute(a, b, c, boardStation = null, alightStation = null))
        assertEquals(1, removed.size); assertNull(removed.first().via)
    }

    @Test fun legacyRouteWithoutViaDecodes() {
        val r = KitJson.decodeFromString(RecentRoute.serializer(), """{"from":null,"to":{"label":"B","lat":37.6,"lng":127.2}}""")
        assertNull(r.via); assertFalse(r.pinned); assertEquals("B", r.to?.label)
    }
}

/** Kit `RecentEndpointTests`의 로마자 표기 3케이스(2026-09-18) 미러 — 기존 저장분 null·고정 토글·재기록·경로 왕복에서 보존. */
class RecentEndpointRomanTest {
    @Test fun legacyAndAdditiveRomanizationRoundTrip() {
        val kv = fresh()
        kv.putString("recentEndpoints.to.v1", """[{"label":"경복궁","lat":37.579617,"lng":126.977041}]""")
        val store = RecentSearchStore(kv)
        val old = store.endpoints(RecentEndpointScope.to).first()
        assertNull(old.labelRoman)
        assertFalse(old.pinned)
        assertEquals("경복궁", bilingualName("en", old.label, en = null, roman = old.labelRoman).primary)
        val new = RecentEndpoint(old.label, old.lat, old.lng, labelRoman = "Gyeongbokgung")
        store.recordEndpoint(new, RecentEndpointScope.to)
        val reloaded = RecentSearchStore(kv).endpoints(RecentEndpointScope.to)
        assertEquals(listOf(new), reloaded)
        assertEquals(old.id, reloaded.first().id)
        assertTrue(kv.getString("recentEndpoints.to.v1")!!.contains(""""labelRoman":"Gyeongbokgung""""))
    }

    @Test fun romanizationSurvivesPinsAndRouteRoundTrip() {
        val kv = fresh()
        val store = RecentSearchStore(kv)
        val from = RecentEndpoint("출발", 37.5, 127.0, labelRoman = "Start")
        val to = RecentEndpoint("도착", 37.6, 127.0, labelRoman = "End")
        val via = RecentEndpoint("경유", 37.55, 127.0, labelRoman = "Via")
        for ((scope, item) in listOf(RecentEndpointScope.from to from, RecentEndpointScope.to to to, RecentEndpointScope.via to via)) {
            store.recordEndpoint(item, scope)
            for (pinned in listOf(true, false)) {
                store.setEndpointPinned(item, scope, pinned)
                val actual = store.endpoints(scope).first()
                assertEquals(item.labelRoman, actual.labelRoman)
                assertEquals(item.id, actual.id)
                assertEquals(pinned, actual.pinned)
            }
        }
        val route = RecentRoute(from, to, via, boardStation = null, alightStation = null)
        store.recordRoute(route)
        store.setRoutePinned(route, pinned = true)
        val restored = RecentSearchStore(kv).routes().first()
        assertEquals(from, restored.from); assertEquals(to, restored.to); assertEquals(via, restored.via)
        assertEquals(route.id, restored.id)
        assertTrue(restored.pinned)
        // 표기만 바뀌어도 같은 경로이며 고정 상태와 자리를 유지한다.
        val updatedTo = RecentEndpoint(to.label, to.lat, to.lng, labelRoman = "Destination")
        store.recordRoute(RecentRoute(from, updatedTo, via, boardStation = null, alightStation = null))
        assertEquals(1, store.routes().size)
        assertEquals("Destination", store.routes().first().to?.labelRoman)
        assertEquals(true, store.routes().first().pinned)
        store.setRoutePinned(route, pinned = false)
        assertEquals("Destination", store.routes().first().to?.labelRoman)
    }

    @Test fun pinnedEndpointDedupeKeepsLatestSpellingAndLegacyRouteDecodes() {
        val kv = fresh()
        val store = RecentSearchStore(kv)
        val old = RecentEndpoint("이름", 37.5, 127.0, labelRoman = "Old")
        store.recordEndpoint(old, RecentEndpointScope.to)
        store.setEndpointPinned(old, RecentEndpointScope.to, pinned = true)
        val changed = RecentEndpoint("새 이름", 37.50001, 127.0, labelRoman = "New")
        val items = store.recordEndpoint(changed, RecentEndpointScope.to)
        assertEquals(1, items.size)
        assertEquals("New", items.first().labelRoman)
        assertEquals(old.id, items.first().id)
        assertTrue(items.first().pinned)
        kv.putString("recentRoutes.v1", """[{"to":{"label":"이름","lat":37.5,"lng":127}}]""")
        val route = RecentSearchStore(kv).routes().first()
        assertNull(route.to?.labelRoman)
        assertTrue(route.from == null && route.via == null && !route.pinned)
    }
}

// Kit `RecentSearchStoreTests`의 E67 재배열 케이스(기대값 재사용, spec 2026-10-05-reorder-rotor-actions-design.md §2).
class RecentPinnedReorderTest {
    private fun seededQueries(): RecentSearchStore {
        val store = RecentSearchStore(fresh())
        for (text in listOf("y", "x", "c", "b", "a")) store.recordQuery(text)
        for (text in listOf("a", "b", "c")) store.setQueryPinned(text, pinned = true)
        return store
    }

    @Test fun reorderRebuildsPinBlockAndLeavesUnpinnedAlone() {
        val store = seededQueries()
        val moved = store.reorderPinnedQueries(listOf("c", "a", "b"))
        assertEquals(listOf("c", "a", "b", "x", "y"), moved.map { it.text })
        assertTrue(moved.take(3).all { it.pinned } && !moved[3].pinned)
        assertEquals(moved, store.queries())
    }

    /** 사용자 지정 순은 그 뒤의 쓰기(재기록·새 고정·해제·삭제·모두 지우기)를 지나도 남는다(§2.1 전수표). */
    @Test fun userOrderSurvivesEveryOtherWrite() {
        val store = seededQueries()
        store.reorderPinnedQueries(listOf("c", "a", "b"))
        assertEquals(listOf("c", "a", "b", "x", "y"), store.recordQuery("a").map { it.text })
        assertEquals(listOf("c", "a", "b", "z", "x", "y"), store.recordQuery("z").map { it.text })
        assertEquals(listOf("c", "a", "b", "x", "z", "y"), store.setQueryPinned("x", pinned = true).map { it.text })
        assertEquals(listOf("c", "b", "x", "a", "z", "y"), store.setQueryPinned("a", pinned = false).map { it.text })
        assertEquals(listOf("c", "x", "a", "z", "y"), store.removeQuery("b").map { it.text })
        assertEquals(listOf("c", "x"), store.clearQueries().map { it.text })
    }

    @Test fun reorderIgnoresStrangersAndKeepsMissingPins() {
        val store = seededQueries()
        assertEquals(listOf("b", "a", "c", "x", "y"), store.reorderPinnedQueries(listOf("x", "ghost", "b", "b")).map { it.text })
        assertEquals(listOf("b", "a", "c", "x", "y"), store.reorderPinnedQueries(emptyList()).map { it.text })
    }

    /** 화면 기준 이동(§2.2): 화면의 고정 순서가 저장과 어긋나 있어도 이동 결과는 화면 순서에 이동을 적용한 것이다. */
    @Test fun moveFollowsOnScreenPinOrder() {
        val store = RecentSearchStore(fresh())
        for (text in listOf("y", "z")) store.recordQuery(text)
        val screen = store.queries()
        store.setQueryPinned("y", pinned = true)
        store.setQueryPinned("z", pinned = true)
        assertEquals(listOf("y", "z"), store.queries().map { it.text })
        val onScreenPins = screen.map { it.text }
        assertEquals(listOf("y", "z"), store.reorderPinnedQueries(Reorder.moved(onScreenPins, 1, ReorderMove.up)).map { it.text })
        assertEquals(listOf("y", "z"), store.reorderPinnedQueries(Reorder.moved(onScreenPins, 0, ReorderMove.down)).map { it.text })
        assertEquals(listOf("z", "y"), store.reorderPinnedQueries(onScreenPins).map { it.text })
    }

    @Test fun reorderKeepsStoredValuesOverPassedOnes() {
        val store = RecentSearchStore(fresh())
        val home = RecentEndpoint("집", 37.5, 127.1)
        val work = RecentEndpoint("회사", 37.6, 127.0, labelRoman = "Hoesa")
        store.recordEndpoint(home, RecentEndpointScope.to)
        store.recordEndpoint(work, RecentEndpointScope.to)
        store.setEndpointPinned(home, RecentEndpointScope.to, pinned = true)
        store.setEndpointPinned(work, RecentEndpointScope.to, pinned = true)
        val moved = store.reorderPinnedEndpoints(listOf(RecentEndpoint("다른 이름", 37.60001, 127.0), home), RecentEndpointScope.to)
        assertEquals(
            listOf(RecentEndpoint("회사", 37.6, 127.0, pinned = true, labelRoman = "Hoesa"), RecentEndpoint("집", 37.5, 127.1, pinned = true)),
            moved,
        )
        assertEquals(emptyList(), store.endpoints(RecentEndpointScope.from))
    }

    @Test fun routeReorderUsesFullRouteIdentity() {
        val store = RecentSearchStore(fresh())
        val a = RecentEndpoint("A", 37.5, 127.1)
        val b = RecentEndpoint("B", 37.6, 127.2)
        val c = RecentEndpoint("C", 37.55, 127.15)
        val direct = RecentRoute(a, b, boardStation = null, alightStation = null)
        val viaC = RecentRoute(a, b, c, boardStation = null, alightStation = null)
        val fromHere = RecentRoute(null, b, boardStation = null, alightStation = null)
        for (route in listOf(direct, viaC, fromHere)) {
            store.recordRoute(route)
            store.setRoutePinned(route, pinned = true)
        }
        assertEquals(listOf(direct, viaC, fromHere).map { it.id }, store.routes().map { it.id })
        assertEquals(listOf(fromHere, direct, viaC).map { it.id }, store.reorderPinnedRoutes(listOf(fromHere, direct, viaC)).map { it.id })
        assertTrue(store.routes().all { it.pinned })
    }
}
