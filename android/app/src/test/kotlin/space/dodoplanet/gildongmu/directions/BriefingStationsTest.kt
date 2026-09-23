package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.TransitBriefingRow
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 경로 브리핑 역 작업 메뉴(E45) — 라벨 이름의 언어(줄 언어), 메뉴 순서(역별 묶음·등장 순), 배선 소스 가드.
 * 뷰 계층은 JVM 레인이 없어 배선을 소스로 잠근다(iOS `briefing-station-entry-guard.test.ts` 대응).
 */
class BriefingStationsTest {
    private val stops = listOf(
        TransitLegStop(name = "여의도", lat = 37.521, lng = 126.92),
        TransitLegStop(name = "광나루", lat = 37.545, lng = 127.1),
        TransitLegStop(name = "천호", lat = 37.538, lng = 127.12),
    )

    private fun subway(fromEn: String? = "Cheonho", toEn: String? = "Yeouido", lineEn: String? = "Line 5") = TransitRouteLeg(
        mode = "subway", lineName = "수도권 5호선", lineNameEn = lineEn, fromName = "천호", fromNameEn = fromEn,
        toName = "여의도", toNameEn = toEn, stationCount = 10, minutes = 25, stops = stops,
    )

    @Test fun `라벨 이름은 그 줄의 언어다`() {
        val legs = listOf(subway())
        assertEquals(listOf("천호", "여의도"), briefingStationActions(legs, TransitBriefingRow.Transit(0), DataLocale.ko).map { it.name })
        assertEquals(listOf("Cheonho", "Yeouido"), briefingStationActions(legs, TransitBriefingRow.Transit(0), DataLocale.en).map { it.name })
        assertEquals(listOf("Yeouido"), briefingStationActions(legs, TransitBriefingRow.Alight(0), DataLocale.en).map { it.name })
    }

    @Test fun `줄이 한국어로 떨어지면 라벨도 한국어다(한 줄 안 혼용 금지)`() {
        // 하차 영문이 없으면 그 구간 줄 전체가 한국어 — 승차 영문이 있어도 라벨은 한국어다.
        val legs = listOf(subway(toEn = null))
        assertEquals(listOf("천호", "여의도"), briefingStationActions(legs, TransitBriefingRow.Transit(0), DataLocale.en).map { it.name })
    }

    @Test fun `대상 역과 노선 힌트는 조인 결과 그대로다(역순 목록)`() {
        val out = briefingStationActions(listOf(subway()), TransitBriefingRow.Transit(0), DataLocale.ko)
        assertEquals(listOf(37.538, 37.521), out.map { it.stop.lat })
        assertTrue(out.all { it.lineName == "수도권 5호선" })
    }

    @Test fun `작업 메뉴는 역별로 묶어 등장 순이다 — 뒤집지 않는다`() {
        val actions = briefingStationActions(listOf(subway()), TransitBriefingRow.Transit(0), DataLocale.ko)
        assertEquals(
            listOf("천호" to BriefingRotorKind.open, "천호" to BriefingRotorKind.call, "여의도" to BriefingRotorKind.open, "여의도" to BriefingRotorKind.call),
            briefingRotorOrder(actions).map { (a, kind) -> a.name to kind },
        )
    }

    @Test fun `작업 메뉴 길이는 전화 상태와 무관하게 역마다 둘이고 라벨만 갈린다(상시 노출)`() {
        val actions = briefingStationActions(listOf(subway()), TransitBriefingRow.Transit(0), DataLocale.ko)
        val ko = CatalogStrings("ko")
        for (state in listOf(null, StationPhoneResult.Unavailable, StationPhoneResult.Failed, StationPhoneResult.Direct("02"), StationPhoneResult.Representative("1544"))) {
            val labels = briefingCustomActions(actions, { state }, ko, onOpen = {}, onCall = {}).map { it.label }
            val call = { name: String -> if (state is StationPhoneResult.Representative) "$name 대표번호로 전화 걸기" else "${name}에 전화 걸기" }
            assertEquals(listOf("천호 상세 보기", call("천호"), "여의도 상세 보기", call("여의도")), labels, "$state")
        }
    }

    @Test fun `작업 메뉴 실행은 그 역을 넘긴다`() {
        val actions = briefingStationActions(listOf(subway()), TransitBriefingRow.Transit(0), DataLocale.ko)
        val opened = mutableListOf<String>(); val called = mutableListOf<String>()
        val custom = briefingCustomActions(actions, { null }, CatalogStrings("ko"), onOpen = { opened += it.name }, onCall = { called += it.name })
        custom.forEach { assertTrue(it.action()) }
        assertEquals(listOf("천호", "여의도"), opened)
        assertEquals(listOf("천호", "여의도"), called)
    }

    // 배선 소스 가드

    private val dir = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private fun code(path: String) = dir.resolve(path).readText().lines().filterNot { it.trim().startsWith("//") || it.trim().startsWith("*") }.joinToString("\n")

    @Test fun `진입점 옵트인은 기본값이 없고 켜는 소비자는 길찾기 탭 하나다`() {
        val rows = code("directions/RouteRows.kt")
        assertTrue(Regex("""stationEntry: BriefingStationEntry\?,""").containsMatchIn(rows), "기본값 없는 인자")
        assertFalse(Regex("""stationEntry: BriefingStationEntry\?\s*=""").containsMatchIn(rows))
        val callers = dir.walkTopDown().filter { it.isFile && it.extension == "kt" }
            .flatMap { f -> Regex("""TransitOutcomeRows\(""").findAll(f.readText()).map { f.name } }
            .filterNot { it == "RouteRows.kt" }.toList()
        assertEquals(listOf("DirectionsScreen.kt"), callers)
        assertTrue(code("directions/DirectionsScreen.kt").contains("stationEntry = stationEntry,"))
        // 앱 루트가 길찾기 탭에만 push 경로를 넘긴다.
        assertTrue(code("nav/AppRoot.kt").contains("navController.navigate(PlaceDetailRoute.ofTransitStop(stop, lineName = lineName))"))
    }

    @Test fun `작업 메뉴는 순수 함수 결과를 거르지 않고 그대로 싣는다`() {
        val src = code("directions/BriefingStations.kt")
        assertTrue(src.contains("): List<CustomAccessibilityAction> = briefingRotorOrder(actions).map {"))
        assertTrue(src.contains("val custom = briefingCustomActions("))
        // 줄에 싣는 것은 정확히 그 목록이다(뒤에서 거르면 상시 노출이 깨진다) — 착지 요청자도 같은 줄에.
        assertTrue(src.contains("TextRow(text, tag, spoken = spoken, actions = custom, focus = entry.rowFocus(tag))"))
        assertEquals(1, Regex("""actions = custom""").findAll(src).count())
        assertFalse(Regex("""briefingRotorOrder\(actions\)\s*\.(filter|reversed|asReversed)""").containsMatchIn(src))
        assertFalse(Regex("""\.reversed\(\)|asReversed""").containsMatchIn(src), "안드로이드는 선언 순서 그대로 노출한다")
    }

    @Test fun `저장소는 하위 컴포저블만 관찰하고 이 줄의 역만 조회한다`() {
        for (f in listOf("directions/RouteRows.kt", "directions/DirectionsScreen.kt")) {
            assertFalse(code(f).contains("StationPhoneStore"), "$f 가 저장소를 읽으면 번호 도착마다 브리핑 전체가 다시 그려진다")
        }
        val src = code("directions/BriefingStations.kt")
        assertFalse(src.contains(".stops"), "leg.stops 전체를 조회에 넘기지 않는다(spec §5.2)")
        assertFalse(src.contains("transitStationMentions"), "브리핑은 문장 스캔이 아니라 구조로 확정한다")
    }

    @Test fun `역 상세 왕복은 펼침을 보존하고 그 줄로 돌아온다`() {
        val screen = code("directions/DirectionsScreen.kt")
        assertTrue(screen.contains("rememberSaveable(saver = FormUiState.Saver)"), "push 왕복에 펼침이 초기화되면 방금 쓴 줄이 사라진다")
        assertTrue(screen.contains("open(stop, lineName, STATION_RETURN_PREFIX + rowTag)"))
        assertTrue(screen.contains("formState.stationRowFocus[key.removePrefix(STATION_RETURN_PREFIX)]"))
        assertTrue(code("nav/AppRoot.kt").contains("onOpenStation = { stop, lineName, returnKey -> rf.slot.remember(returnKey);"))
    }

    @Test fun `펼침 상태는 저장·복원으로 왕복한다`() {
        val before = FormUiState(setOf("r2"), walkExpandedOverride = false, shortestExpanded = true, seenResultsRevision = 3)
        val saved = with(FormUiState.Saver) { androidx.compose.runtime.saveable.SaverScope { true }.save(before) }!!
        val after = FormUiState.Saver.restore(saved)!!
        assertEquals(setOf("r2"), after.expandedAlts)
        assertEquals(false, after.walkExpandedOverride)
        assertEquals(true, after.shortestExpanded)
        assertEquals(3, after.seenResultsRevision)
    }

    @Test fun `전화는 단일 창구를 지나고 통지는 화면 통지 창구로 간다`() {
        val src = code("directions/BriefingStations.kt")
        assertTrue(src.contains("callStationPhone(store, a.stop"))
        assertFalse(src.contains("ACTION_DIAL"))
        assertTrue(code("directions/DirectionsScreen.kt").contains("announce = vm::announceResult,"))
    }
}
