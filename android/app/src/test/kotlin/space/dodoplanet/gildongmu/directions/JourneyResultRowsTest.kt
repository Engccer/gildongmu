package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.guide.TransitAboardStart
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.JourneyAboardDirection
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.EgressKind
import space.dodoplanet.gildongmu.kit.models.EgressOption
import space.dodoplanet.gildongmu.kit.models.JourneyDesignatedMissing
import space.dodoplanet.gildongmu.kit.models.JourneyEgress
import space.dodoplanet.gildongmu.kit.models.JourneyMissingSide
import space.dodoplanet.gildongmu.kit.models.JourneyResult
import space.dodoplanet.gildongmu.kit.models.JourneyStationRef
import space.dodoplanet.gildongmu.kit.models.JourneyTotals
import space.dodoplanet.gildongmu.kit.models.JourneyVariant
import space.dodoplanet.gildongmu.kit.models.JourneyVariantKind
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** B26 단계 5 묶음 C: 여정 결과 줄의 순수 문장 함수·줄 순서·안내 시작 계획을 JVM에서 잠근다(문장은 실제 카탈로그). 화면 노드는 `JourneyResultRowsA11yTest`(계측). */
class JourneyResultRowsTest {
    private val ko = CatalogStrings("ko")
    private val lang = "ko"

    private fun taxi(seconds: Int, fare: Int) = CarRouteBriefing(distanceMeters = 1000, durationSeconds = seconds, taxiFare = fare, tollFare = 0, guides = emptyList())
    private fun leg(mode: String, line: String?, from: String?, to: String?) = TransitRouteLeg(mode = mode, lineName = line, fromName = from, toName = to, minutes = 10)
    private fun route(vararg legs: TransitRouteLeg) = TransitRoute(TransitRouteSummary(20, 1500, 0, 0), legs.toList(), "k", null, null)
    private fun ref(name: String, lat: Double = 37.55, lng: Double = 126.95) = JourneyStationRef(name, RoutePoint(lat, lng))
    private fun exit(label: String, seconds: Int, fare: Int) = EgressOption(EgressKind.exit, label, "", null, RoutePoint(37.5, 127.0), taxi(seconds, fare))
    private fun stand(seconds: Int, fare: Int) = EgressOption(EgressKind.stand, "", "", null, RoutePoint(37.5, 127.0), taxi(seconds, fare))
    private fun none(seconds: Int, fare: Int) = EgressOption(EgressKind.none, "", "", null, RoutePoint(37.5, 127.0), taxi(seconds, fare))

    private fun variant(
        kind: JourneyVariantKind = JourneyVariantKind.designated,
        transit: TransitRoute = route(leg("subway", "수도권 2호선", "가나역", "다라역")),
        taxiIn: CarRouteBriefing? = null,
        boardStation: JourneyStationRef? = null,
        egress: JourneyEgress? = null,
        totals: JourneyTotals = JourneyTotals(minutes = 40, taxiFare = 5000, transitFare = 1500),
    ) = JourneyVariant(kind, boardStation, null, taxiIn, transit, egress, totals)

    private val ga = RecentStation("가나역", 37.55, 126.95, "2호선", null)
    private val da = RecentStation("다라역", 37.57, 126.97, null, null)
    private val stop = RecentStation("마바 정류장", 37.56, 126.99, null, JourneyStationKind.busStop)

    // ── 못 찾음 줄 ──
    @Test fun `못 찾음 줄은 갈래마다 한 줄 — 승차 하차 양쪽(정류장은 원문 그대로)`() {
        fun missing(side: JourneyMissingSide, b: RecentStation?, a: RecentStation?) =
            journeyMissingLines(JourneyResult(listOf(variant()), JourneyDesignatedMissing(side, null)), b, a, ko)
        assertEquals(listOf("가나역에서 타는 경로를 찾지 못했습니다."), missing(JourneyMissingSide.board, ga, null))
        assertEquals(listOf("다라역에서 내리는 경로를 찾지 못했습니다."), missing(JourneyMissingSide.alight, null, da))
        assertEquals(listOf("가나역에서 타는 경로를 찾지 못했습니다.", "다라역에서 내리는 경로를 찾지 못했습니다."), missing(JourneyMissingSide.both, ga, da))
        assertEquals(listOf("마바 정류장에서 타는 경로를 찾지 못했습니다.", "다라역에서 내리는 경로를 찾지 못했습니다."), missing(JourneyMissingSide.both, stop, da))
        assertEquals(listOf("마바 정류장에서 내리는 경로를 찾지 못했습니다."), missing(JourneyMissingSide.alight, null, stop))
        assertEquals(emptyList(), journeyMissingLines(JourneyResult(listOf(variant()), null), ga, da, ko))
    }

    @Test fun `동명 이역이면 못 찾음 줄에 고른 역의 노선 머리말이 붙는다`() {
        // 고른 칸(2호선 가나, 좌표 A)과 추천 경로가 타는 같은 이름의 다른 역(1호선, 좌표 B).
        val chosen = RecentStation("가나역", 37.5500, 126.9500, "2호선", null)
        val rec = variant(
            kind = JourneyVariantKind.recommended, boardStation = ref("가나역", 37.60, 127.00),
            transit = route(leg("subway", "수도권 1호선", "가나역", "다라역")),
        )
        val result = JourneyResult(listOf(rec), JourneyDesignatedMissing(JourneyMissingSide.board, null))
        assertEquals(listOf("2호선 가나역에서 타는 경로를 찾지 못했습니다."), journeyMissingLines(result, chosen, null, ko))
    }

    // ── 변형 제목 ──
    private fun heading(v: JourneyVariant, b: RecentStation?, a: RecentStation?): String {
        val result = JourneyResult(listOf(v), null)
        return journeyVariantHeading(v, b, a, space.dodoplanet.gildongmu.kit.journeyLineQualifiers(result, b, a), ko)
    }

    @Test fun `지정 경로 제목 — 승차 하차 버스 갈래`() {
        assertEquals("가나역에서 타는 경로", heading(variant(), ga, null))
        assertEquals("다라역에서 내리는 경로", heading(variant(), null, da))
        val bus = variant(transit = route(leg("bus", "100", "마바 정류장", "사아 정류장")))
        assertEquals("마바 정류장에서 버스를 타는 경로", heading(bus, stop, null))
        assertEquals("사아 정류장에서 버스에서 내리는 경로", heading(bus, null, stop))
    }

    @Test fun `추천 경로 제목 — 타는 쪽 내리는 쪽 버스 갈래`() {
        val sub = variant(kind = JourneyVariantKind.recommended, transit = route(leg("subway", "수도권 2호선", "자차역", "카타역")))
        // 승차 쪽이 지정 역과 다르면 승차 쪽 제목.
        assertEquals("자차역에서 타는 추천 경로", heading(sub, ga, null))
        // 하차 쪽만 다르면 하차 쪽 제목.
        val sameBoard = variant(kind = JourneyVariantKind.recommended, transit = route(leg("subway", "수도권 2호선", "가나역", "카타역")))
        assertEquals("카타역에서 내리는 추천 경로", heading(sameBoard, ga, da))
        val bus = variant(kind = JourneyVariantKind.recommended, transit = route(leg("bus", "100", "마바 정류장", "사아 정류장")))
        assertEquals("마바 정류장에서 버스를 타는 추천 경로", heading(bus, ga, null))
        assertEquals("사아 정류장에서 버스에서 내리는 추천 경로", heading(bus, null, da))
    }

    @Test fun `추천 제목의 동명 이역에는 노선 머리말이 붙는다`() {
        val chosen = RecentStation("가나역", 37.5500, 126.9500, "2호선", null)
        val rec = variant(
            kind = JourneyVariantKind.recommended, boardStation = ref("가나역", 37.60, 127.00),
            transit = route(leg("subway", "수도권 1호선", "가나역", "다라역")),
        )
        assertEquals("1호선 가나역에서 타는 추천 경로", heading(rec, chosen, null))
    }

    // ── 합계 ──
    private val withExits = variant(
        egress = JourneyEgress(listOf(exit("1", 600, 4000), exit("3", 900, 7000)), lookupFailed = null),
        totals = JourneyTotals(minutes = 40, taxiFare = 4000, transitFare = 1500),
    )

    @Test fun `합계는 기본 출구면 서버 값 그대로, 다른 출구면 택시 구간만큼 보정한다`() {
        assertEquals("총 40분, 택시 요금 약 4,000원, 대중교통 요금 1,500원", journeyTotalsLine(withExits, withExits.egress!!.options[0], false, ko, lang))
        assertEquals("총 45분, 택시 요금 약 7,000원, 대중교통 요금 1,500원", journeyTotalsLine(withExits, withExits.egress!!.options[1], false, ko, lang))
        // 출구 선택이 없으면(역 B 미지정) 보정하지 않는다.
        assertEquals("총 40분, 택시 요금 약 4,000원, 대중교통 요금 1,500원", journeyTotalsLine(withExits, null, false, ko, lang))
    }

    @Test fun `지금 탄 열차 갈래는 대중교통 요금을 말하지 않고 택시가 없으면 시간만`() {
        assertEquals("총 45분, 택시 요금 약 7,000원", journeyTotalsLine(withExits, withExits.egress!!.options[1], true, ko, lang))
        val noTaxi = variant(totals = JourneyTotals(minutes = 30, taxiFare = 0, transitFare = 1500))
        assertEquals("총 30분", journeyTotalsLine(noTaxi, null, true, ko, lang))
    }

    // ── 출구 줄 ──
    @Test fun `출구 줄 갈래 — 출구 승강장 없음 실패 버스 끝`() {
        val v = variant()
        assertEquals("1번 출구로 나가 자동차로 10분, 택시 요금 약 4,000원", egressLine(exit("1", 600, 4000), v, false, ko, lang))
        assertEquals("택시 승강장에서 택시로 5분, 택시 요금 약 3,000원", egressLine(stand(300, 3000), v, false, ko, lang))
        assertEquals("내린 역에서 자동차로 5분, 택시 요금 약 3,000원", egressLine(none(300, 3000), v, false, ko, lang))
        assertEquals("출구 정보를 불러오지 못했습니다. 내린 역에서 자동차로 5분, 택시 요금 약 3,000원", egressLine(none(300, 3000), v, true, ko, lang))
        val busEnd = variant(transit = route(leg("bus", "100", "마바 정류장", "사아 정류장")))
        // 버스로 끝나면 실패 신호가 있어도 정류장 문장(조회 자체를 하지 않는다).
        assertEquals("내린 정류장에서 자동차로 5분, 택시 요금 약 3,000원", egressLine(none(300, 3000), busEnd, true, ko, lang))
    }

    // ── 택시 앞 줄 ──
    @Test fun `택시 앞 줄 갈래 — 없음 역 정류장`() {
        assertNull(journeyTaxiInLine(variant(), ko, lang))
        assertNull(journeyTaxiInLine(variant(taxiIn = taxi(600, 4000)), ko, lang), "승차 역이 없으면 줄이 없다")
        assertEquals("자동차로 가나역까지 10분, 택시 요금 약 4,000원", journeyTaxiInLine(variant(taxiIn = taxi(600, 4000), boardStation = ref("가나역")), ko, lang))
        val bus = variant(taxiIn = taxi(600, 4000), boardStation = ref("마바 정류장"), transit = route(leg("bus", "100", "마바 정류장", "사아 정류장")))
        assertEquals("자동차로 마바 정류장까지 10분, 택시 요금 약 4,000원", journeyTaxiInLine(bus, ko, lang))
    }

    // ── 줄 순서 ──
    private fun specs(
        result: JourneyResult, b: RecentStation? = null, a: RecentStation? = null, aboard: Boolean = false,
        variantIndex: Int = 0, egressIndex: Int = 0, showStart: Boolean = true,
    ) = journeyRowSpecs(result, b, a, aboard, variantIndex, egressIndex, showStart, ko, lang)

    private fun kinds(rows: List<JourneyRowSpec>) = rows.map { it::class.simpleName }

    @Test fun `줄 순서 — 못 찾음 변형 선택 제목 합계 택시 구간 출구 시작`() {
        val designated = variant(taxiIn = taxi(600, 4000), boardStation = ref("가나역"), egress = withExits.egress)
        val rec = variant(kind = JourneyVariantKind.recommended, egress = withExits.egress)
        val result = JourneyResult(listOf(designated, rec), JourneyDesignatedMissing(JourneyMissingSide.board, null))
        assertEquals(
            listOf("Missing", "VariantChoice", "VariantChoice", "VariantHeading", "Totals", "TaxiIn", "TransitLegs", "EgressChoice", "EgressChoice", "Start"),
            kinds(specs(result, b = ga, a = da)),
        )
    }

    @Test fun `변형이 하나면 변형 선택·제목 없이 합계부터`() {
        val rows = specs(JourneyResult(listOf(variant()), null))
        assertEquals(listOf("Totals", "TransitLegs", "Start"), kinds(rows))
        assertTrue((rows[0] as JourneyRowSpec.Totals).landing, "제목이 없으면 합계가 착지 대상")
        // 못 찾음 줄이 있으면 첫 못 찾음 줄이 착지 대상이고 합계는 아니다.
        val missing = specs(JourneyResult(listOf(variant()), JourneyDesignatedMissing(JourneyMissingSide.both, null)), b = ga, a = da)
        assertEquals(listOf("Missing", "Missing", "Totals", "TransitLegs", "Start"), kinds(missing))
        assertEquals(listOf(true, false), missing.filterIsInstance<JourneyRowSpec.Missing>().map { it.landing })
        assertEquals(false, (missing[2] as JourneyRowSpec.Totals).landing)
    }

    @Test fun `변형 선택은 고른 쪽만 selected이고 고른 변형의 제목·합계·출구를 그린다`() {
        val d = variant(egress = JourneyEgress(listOf(exit("1", 600, 4000)), null), totals = JourneyTotals(40, 4000, 1500))
        val r = variant(kind = JourneyVariantKind.recommended, transit = route(leg("subway", "수도권 2호선", "자차역", "카타역")), egress = JourneyEgress(listOf(exit("2", 300, 3000), exit("4", 600, 5000)), null), totals = JourneyTotals(25, 3000, 1500))
        val result = JourneyResult(listOf(d, r), null)
        val first = specs(result, b = ga)
        assertEquals(listOf(true, false), first.filterIsInstance<JourneyRowSpec.VariantChoice>().map { it.selected })
        assertEquals(listOf("가나역에서 타는 경로", "자차역에서 타는 추천 경로"), first.filterIsInstance<JourneyRowSpec.VariantChoice>().map { it.text })
        assertEquals("가나역에서 타는 경로", first.filterIsInstance<JourneyRowSpec.VariantHeading>().single().text)
        // 둘째 변형을 고르면(뷰모델이 출구 인덱스를 0으로 돌려놓는다) 그 변형의 출구 둘이 선택지가 되고 첫 출구가 선택이다.
        val second = specs(result, b = ga, variantIndex = 1, egressIndex = 0)
        assertEquals(listOf(false, true), second.filterIsInstance<JourneyRowSpec.VariantChoice>().map { it.selected })
        assertEquals("자차역에서 타는 추천 경로", second.filterIsInstance<JourneyRowSpec.VariantHeading>().single().text)
        assertEquals(listOf(true, false), second.filterIsInstance<JourneyRowSpec.EgressChoice>().map { it.selected })
        assertEquals("총 25분, 택시 요금 약 3,000원, 대중교통 요금 1,500원", second.filterIsInstance<JourneyRowSpec.Totals>().single().text)
        // 둘째 출구를 고르면 선택이 옮겨가고 합계가 보정된다.
        val picked = specs(result, b = ga, variantIndex = 1, egressIndex = 1)
        assertEquals(listOf(false, true), picked.filterIsInstance<JourneyRowSpec.EgressChoice>().map { it.selected })
        assertEquals("총 30분, 택시 요금 약 5,000원, 대중교통 요금 1,500원", picked.filterIsInstance<JourneyRowSpec.Totals>().single().text)
        // 낡은 인덱스는 범위 안으로 보정한다.
        assertEquals(listOf(false, true), specs(result, b = ga, variantIndex = 9, egressIndex = 9).filterIsInstance<JourneyRowSpec.EgressChoice>().map { it.selected })
    }

    @Test fun `출구가 하나면 평문 줄이고 없으면 줄이 없다`() {
        val one = variant(egress = JourneyEgress(listOf(exit("1", 600, 4000)), null))
        val rows = specs(JourneyResult(listOf(one), null))
        assertEquals(listOf("Totals", "TransitLegs", "EgressPlain", "Start"), kinds(rows))
        assertEquals(listOf("Totals", "TransitLegs", "Start"), kinds(specs(JourneyResult(listOf(variant()), null))))
    }

    @Test fun `안내 시작 라벨 — 일반은 제목을 싣고 지금 탄 열차는 이름 없는 안내 시작`() {
        val result = JourneyResult(listOf(variant()), null)
        assertEquals("가나역에서 타는 경로 안내 시작", (specs(result, b = ga).last() as JourneyRowSpec.Start).label)
        assertEquals("안내 시작", (specs(result, b = ga, aboard = true).last() as JourneyRowSpec.Start).label)
    }

    @Test fun `도착지가 현재 위치면 안내 시작 줄이 없다`() {
        val rows = specs(JourneyResult(listOf(variant()), null), showStart = false)
        assertTrue(rows.none { it is JourneyRowSpec.Start })
        assertIs<JourneyRowSpec.TransitLegs>(rows.last())
    }

    // ── 도착지·계획 ──
    @Test fun `도착지 판정 — 승격본이 먼저, 장소면 그 좌표, 현재 위치면 없음`() {
        val place = space.dodoplanet.gildongmu.kit.DirectionsEndpoint.Place("라마역", 37.5, 127.0)
        assertEquals(JourneyDestination("라마역", BeaconDest(37.5, 127.0)), journeyDestinationOf(DirectionsUiState(to = place)))
        assertEquals(
            JourneyDestination("승격", BeaconDest(37.6, 127.1)),
            journeyDestinationOf(DirectionsUiState(to = place, promotedDestination = PromotedDestination("승격", 37.6, 127.1))),
        )
        assertNull(journeyDestinationOf(DirectionsUiState(to = space.dodoplanet.gildongmu.kit.DirectionsEndpoint.Current)))
        assertNull(journeyDestinationOf(DirectionsUiState(to = null)))
    }

    @Test fun `계획 인자 — 변형·출구·도착지·지금 탄 열차 방향`() {
        val dest = JourneyDestination("라마역", BeaconDest(37.5, 127.0))
        val egress = withExits.egress!!.options[1]
        val plain = journeyPlanFor(withExits, egress, dest, aboardOrigin = null)
        assertEquals(withExits, plain.variant)
        assertEquals(egress, plain.egress)
        assertEquals("라마역", plain.destLabel)
        assertEquals(BeaconDest(37.5, 127.0), plain.dest)
        assertNull(plain.aboard)
        assertNull(journeyPlanFor(withExits, null, dest, null).egress)
        val direction = JourneyAboardDirection(direction = "상행", name = "구로방면", terminals = listOf("구로"))
        // 방면을 아직 못 골랐으면 종전 대기 시작(null), 골랐으면 서버 원문 방향.
        assertNull(journeyPlanFor(withExits, null, dest, AboardOrigin(ga, "2호선", direction = null)).aboard)
        assertEquals(TransitAboardStart("상행"), journeyPlanFor(withExits, null, dest, AboardOrigin(ga, "2호선", direction)).aboard)
    }
}
