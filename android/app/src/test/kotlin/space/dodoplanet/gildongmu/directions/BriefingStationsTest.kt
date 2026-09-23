package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.Fixtures
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

    @Test fun `전화 액션은 역마다 언제나 하나다(상태와 무관한 상시 노출)`() {
        val actions = briefingStationActions(listOf(subway()), TransitBriefingRow.Transit(0), DataLocale.ko)
        assertEquals(actions.size, briefingRotorOrder(actions).count { it.second == BriefingRotorKind.call })
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
        assertTrue(Regex("""onOpenStation = \{ stop, lineName -> navController\.navigate\(PlaceDetailRoute\.ofTransitStop\(""").containsMatchIn(code("nav/AppRoot.kt")))
    }

    @Test fun `작업 메뉴는 순서 함수 결과를 거르지 않고 그대로 싣는다`() {
        val src = code("directions/BriefingStations.kt")
        assertTrue(src.contains("val custom = briefingRotorOrder(actions).map {"))
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

    @Test fun `전화는 단일 창구를 지나고 통지는 화면 통지 창구로 간다`() {
        val src = code("directions/BriefingStations.kt")
        assertTrue(src.contains("callStationPhone(store, station.stop"))
        assertFalse(src.contains("ACTION_DIAL"))
        assertTrue(code("directions/DirectionsScreen.kt").contains("BriefingStationEntry(it, vm::announceResult)"))
    }
}
