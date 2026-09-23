package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 경로 브리핑의 역 진입점 판정(E45) — Kit `TransitBriefingStationsTests` 전수 미러.
 *
 * 이 스위트가 지키는 것은 **정체성**이다 — 줄에서 들린 이름과 열리는 역이 같아야 한다. 그래서 `stops.first()`/`stops.last()` 같은
 * 위치 인덱스를 쓰면 빨개지는 fixture(역순 목록·부분 목록·같은 이름 두 번)를 함께 둔다. 조인이 실패하면 진입점은 **없다**.
 */
class TransitBriefingStationsTest {
    private fun stop(name: String, lat: Double = 37.5, lng: Double = 127.0, nameEn: String? = null) =
        TransitLegStop(name = name, lat = lat, lng = lng, nameEn = nameEn)

    private fun subway(
        line: String? = "수도권 5호선", from: String? = "천호", to: String? = "여의도",
        stops: List<TransitLegStop>? = null, fromEn: String? = null, toEn: String? = null,
    ) = TransitRouteLeg(
        mode = "subway", lineName = line, fromName = from, toName = to, stationCount = 10, minutes = 25,
        stops = stops, fromNameEn = fromEn, toNameEn = toEn,
    )

    private fun bus(from: String? = "천호역", to: String? = "강변역", stops: List<TransitLegStop>? = null) =
        TransitRouteLeg(mode = "bus", lineName = "342", fromName = from, toName = to, stationCount = 5, minutes = 12, stops = stops)

    private fun walk(to: String? = "천호", toEn: String? = null) =
        TransitRouteLeg(mode = "walk", toName = to, minutes = 3, distanceMeters = 180, toNameEn = toEn)

    /** 5호선 천호 → 여의도 정차역(일부) */
    private val line5Stops = listOf(stop("천호", lat = 37.538), stop("광나루", lat = 37.545), stop("여의도", lat = 37.521))

    private val walk0 = TransitBriefingRow.Walk(0)
    private val transit0 = TransitBriefingRow.Transit(0)
    private val alight0 = TransitBriefingRow.Alight(0)
    private fun names(out: List<TransitBriefingStation>) = out.map { it.stop.name }

    // .Transit — 구간 줄

    @Test fun `구간 줄은 승차 하차 둘을 등장 순으로 준다`() {
        val out = transitBriefingStations(listOf(subway(stops = line5Stops)), transit0)
        assertEquals(listOf("천호", "여의도"), names(out))
        assertTrue(out.all { it.lineName == "수도권 5호선" })
    }

    @Test fun `정차역 목록이 역순으로 와도 이름으로 찾는다`() {
        // 위치 인덱스(first/last)로 고르면 승차·하차가 뒤바뀐다 — 반대편 승강장 안내가 되는 자리.
        val out = transitBriefingStations(listOf(subway(stops = line5Stops.reversed())), transit0)
        assertEquals(listOf("천호", "여의도"), names(out))
        assertEquals(37.538, out.first().stop.lat)
    }

    @Test fun `첫 항목이 떨어진 부분 목록에서는 승차가 빠지고 하차만 남는다`() {
        val legs = listOf(subway(stops = listOf(stop("광나루", lat = 37.545), stop("여의도", lat = 37.521))))
        assertEquals(listOf("여의도"), names(transitBriefingStations(legs, transit0)))
    }

    @Test fun `마지막 항목이 떨어진 부분 목록에서는 하차가 빠지고 승차만 남는다`() {
        val legs = listOf(subway(stops = listOf(stop("천호", lat = 37.538), stop("광나루", lat = 37.545))))
        assertEquals(listOf("천호"), names(transitBriefingStations(legs, transit0)))
    }

    @Test fun `같은 이름이 두 번 나오면 승차는 앞에서 하차는 뒤에서 찾는다`() {
        val legs = listOf(
            subway(from = "시청", to = "시청", stops = listOf(stop("시청", lat = 37.5651), stop("을지로입구", lat = 37.566), stop("시청", lat = 37.5659))),
        )
        val out = transitBriefingStations(legs, transit0)
        // 정규화 결과가 같아 한 건으로 접힌다(규칙 5) — 접기 전에 각각 찾았는지는 좌표로 본다.
        assertEquals(1, out.size)
        assertEquals(37.5651, out.first().stop.lat)
    }

    @Test fun `승차와 하차가 같은 역이면 한 건으로 접는다`() {
        val legs = listOf(subway(from = "천호", to = "천호역", stops = listOf(stop("천호", lat = 37.538))))
        assertEquals(listOf("천호"), names(transitBriefingStations(legs, transit0)))
    }

    @Test fun `부역명 괄호와 역 접미 표기 차이를 흡수한다`() {
        val legs = listOf(subway(from = "천호역", to = "여의도(한국거래소)", stops = listOf(stop("천호(풍납토성)", lat = 37.538), stop("여의도", lat = 37.521))))
        assertEquals(listOf("천호(풍납토성)", "여의도"), names(transitBriefingStations(legs, transit0)))
    }

    @Test fun `구간 줄의 이름이 빈 문자열이면 그 쪽은 진입점이 없다`() {
        assertEquals(listOf("여의도"), names(transitBriefingStations(listOf(subway(from = "", stops = line5Stops)), transit0)))
    }

    @Test fun `빈 이름끼리 조인되지 않는다`() {
        // 서버가 이름 무효 항목을 떨어뜨리지만 만약 남아도 빈 이름끼리 조인하지 않는다(spec §3.2 규칙 3).
        val legs = listOf(subway(from = "", to = "여의도", stops = listOf(stop(""), stop("여의도", lat = 37.521))))
        assertEquals(listOf("여의도"), names(transitBriefingStations(legs, transit0)))
    }

    @Test fun `조인에 실패하면 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(from = "없는역", to = "다른역", stops = line5Stops)), transit0).isEmpty())
    }

    @Test fun `정차역 목록이 없으면 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(stops = null)), transit0).isEmpty())
        assertTrue(transitBriefingStations(listOf(subway(stops = emptyList())), transit0).isEmpty())
    }

    @Test fun `버스 구간에는 진입점이 없다`() {
        val legs = listOf(bus(stops = listOf(stop("천호역", lat = 37.538), stop("강변역", lat = 37.535))))
        assertTrue(transitBriefingStations(legs, transit0).isEmpty())
        assertTrue(transitBriefingStations(legs, alight0).isEmpty())
    }

    @Test fun `노선명이 비면 힌트는 없음이다`() {
        val out = transitBriefingStations(listOf(subway(line = "", stops = line5Stops)), transit0)
        assertEquals(2, out.size)
        assertTrue(out.all { it.lineName == null })
    }

    // .Alight — 하차 줄

    @Test fun `하차 줄은 하차역 하나를 뒤에서부터 찾는다`() {
        val out = transitBriefingStations(listOf(subway(stops = line5Stops)), alight0)
        assertEquals(listOf("여의도"), names(out))
        assertEquals("수도권 5호선", out.first().lineName)
    }

    @Test fun `하차역 이름이 중간에도 있으면 뒤엣것을 고른다`() {
        // 하차 축의 검출력은 **목록의 마지막이 하차역이 아닌** 배열에서만 생긴다(iOS 리뷰 실측 2026-09-18).
        val legs = listOf(
            subway(stops = listOf(stop("천호", lat = 37.538), stop("여의도", lat = 37.9), stop("광나루", lat = 37.545), stop("여의도", lat = 37.521))),
        )
        assertEquals(37.521, transitBriefingStations(legs, transit0).last().stop.lat)
        assertEquals(37.521, transitBriefingStations(legs, alight0).first().stop.lat)
    }

    @Test fun `하차 줄도 역순 목록에서 이름으로 찾는다`() {
        assertEquals(listOf("여의도"), names(transitBriefingStations(listOf(subway(stops = line5Stops.reversed())), alight0)))
    }

    @Test fun `하차 줄의 대상은 구간 줄의 하차 항목과 같다`() {
        val legs = listOf(
            subway(from = "시청", to = "시청", stops = listOf(stop("시청", lat = 37.5651), stop("을지로입구", lat = 37.566), stop("시청", lat = 37.5659))),
        )
        assertEquals(37.5659, transitBriefingStations(legs, alight0).first().stop.lat)
    }

    @Test fun `하차 줄의 이름이 없거나 비면 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(to = null, stops = line5Stops)), alight0).isEmpty())
        assertTrue(transitBriefingStations(listOf(subway(to = "", stops = line5Stops)), alight0).isEmpty())
    }

    // .Walk — 도보 줄

    @Test fun `도보 줄은 다음 지하철 구간의 승차역을 준다`() {
        val out = transitBriefingStations(listOf(walk(to = "천호"), subway(stops = line5Stops)), walk0)
        assertEquals(listOf("천호"), names(out))
        assertEquals("수도권 5호선", out.first().lineName)
    }

    @Test fun `도보 줄은 승차역을 앞에서부터 찾는다`() {
        // 왕복·순환 노선은 승차역 이름이 목록에 두 번 나온다 — 뒤에서 찾으면 돌아오는 쪽 승강장이 열린다.
        val legs = listOf(
            walk(to = "천호"),
            subway(from = "천호", to = "여의도", stops = listOf(stop("천호", lat = 37.538), stop("여의도", lat = 37.521), stop("천호", lat = 37.9))),
        )
        assertEquals(37.538, transitBriefingStations(legs, walk0).first().stop.lat)
    }

    @Test fun `도보가 연달아 둘이면 두 줄이 같은 역을 가리킨다`() {
        // 서버가 도보 줄의 행선지 이름을 **다음 non-walk leg**에서 복사한다 — `legs[i+1]`만 보면 한 줄에만 진입점이 생긴다.
        val legs = listOf(walk(to = "천호"), walk(to = "천호"), subway(stops = line5Stops))
        val first = transitBriefingStations(legs, walk0)
        val second = transitBriefingStations(legs, TransitBriefingRow.Walk(1))
        assertEquals(listOf("천호"), names(first))
        assertEquals(first, second)
    }

    @Test fun `다음 탑승이 버스면 도보 줄에 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(walk(to = "천호역"), bus(stops = listOf(stop("천호역", lat = 37.538)))), walk0).isEmpty())
    }

    @Test fun `마지막 도보에는 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(stops = line5Stops), walk(to = null)), TransitBriefingRow.Walk(1)).isEmpty())
    }

    @Test fun `도보 줄의 다음 구간 승차역이 정차역 목록에 없으면 진입점이 없다`() {
        val legs = listOf(walk(to = "천호"), subway(from = "천호", stops = listOf(stop("광나루"), stop("여의도"))))
        assertTrue(transitBriefingStations(legs, walk0).isEmpty())
    }

    @Test fun `도보 줄의 다음 구간 승차역 이름이 비면 진입점이 없다`() {
        // 그 경우 서버는 `toName`을 덮지 않는다 — 줄에도 역 이름이 들리지 않으므로 진입점도 없어야 한다.
        assertTrue(transitBriefingStations(listOf(walk(to = "천호"), subway(from = "", stops = line5Stops)), walk0).isEmpty())
    }

    @Test fun `도보가 아닌 구간에 도보 줄 판정을 걸면 진입점이 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(stops = line5Stops)), walk0).isEmpty())
    }

    @Test fun `범위 밖 인덱스는 진입점이 없다`() {
        val legs = listOf(subway(stops = line5Stops))
        assertTrue(transitBriefingStations(legs, TransitBriefingRow.Transit(3)).isEmpty())
        assertTrue(transitBriefingStations(legs, TransitBriefingRow.Alight(-1)).isEmpty())
        assertTrue(transitBriefingStations(emptyList(), walk0).isEmpty())
        assertTrue(transitBriefingStations(legs, TransitBriefingRow.Walk(-1)).isEmpty())
    }

    // 영문 이름은 줄이 쓴 필드에서 온다

    @Test fun `영문 이름은 정차역 목록이 아니라 그 줄이 쓴 필드에서 온다`() {
        val legs = listOf(subway(stops = listOf(stop("천호", lat = 37.538), stop("여의도", lat = 37.521)), fromEn = "Cheonho", toEn = "Yeouido"))
        assertEquals(listOf("Cheonho", "Yeouido"), transitBriefingStations(legs, transit0).map { it.nameEn })
        assertEquals("Yeouido", transitBriefingStations(legs, alight0).first().nameEn)
    }

    @Test fun `정차역 목록에 영문이 있어도 그 값을 쓰지 않는다`() {
        val legs = listOf(
            subway(
                stops = listOf(stop("천호", lat = 37.538, nameEn = "Cheon-ho"), stop("여의도", lat = 37.521, nameEn = "Yeoui-do")),
                fromEn = "Cheonho", toEn = "Yeouido",
            ),
        )
        assertEquals(listOf("Cheonho", "Yeouido"), transitBriefingStations(legs, transit0).map { it.nameEn })
    }

    @Test fun `도보 줄의 영문 이름은 그 도보 줄이 쓴 값이다`() {
        val legs = listOf(walk(to = "천호", toEn = "Cheonho"), subway(stops = line5Stops, fromEn = "Cheon-ho"))
        assertEquals("Cheonho", transitBriefingStations(legs, walk0).first().nameEn)
    }

    @Test fun `영문이 없으면 영문 이름도 없다`() {
        assertTrue(transitBriefingStations(listOf(subway(stops = line5Stops)), transit0).all { it.nameEn == null })
    }

    // 빈 이름 — 개행·유니코드 공백(Swift `.whitespacesAndNewlines`, U+200B 포함)

    private val threeRows = listOf(TransitBriefingRow.Walk(0), TransitBriefingRow.Transit(1), TransitBriefingRow.Alight(1))

    @Test fun `이름과 정차역 양쪽의 개행 공백은 세 진입점에서 조인되지 않는다`() {
        for (blank in listOf("\n", "\r\n", " \t\n ", "\u00A0\n\u3000")) {
            val legs = listOf(walk(to = blank), subway(from = blank, to = blank, stops = listOf(stop(blank))))
            for (row in threeRows) assertTrue(transitBriefingStations(legs, row).isEmpty(), "$row ${blank.codePoints().toArray().toList()}")
        }
    }

    @Test fun `빈 표시 영문과 노선 힌트는 정보 부재다`() {
        for (blank in listOf("", " \t\n", "\u00A0\u200B\u3000")) {
            val legs = listOf(walk(toEn = blank), subway(line = blank, stops = line5Stops, fromEn = blank, toEn = blank))
            for (row in threeRows) {
                val out = transitBriefingStations(legs, row)
                assertTrue(out.isNotEmpty(), "$row")
                assertTrue(out.all { it.lineName == null && it.nameEn == null }, "$row")
            }
        }
    }

    @Test fun `빈 이름은 세 진입점에서 정차역으로 추정하지 않는다`() {
        for (blank in listOf(null, "", " \t\n", "\u00A0\u200B\u3000")) {
            val legs = listOf(walk(to = blank), subway(from = blank, to = blank, stops = line5Stops))
            for (row in threeRows) assertTrue(transitBriefingStations(legs, row).isEmpty(), "$row")
        }
    }

    // 전화 3상태 → 통지·진동

    @Test fun `번호가 있으면 통지하지 않는다`() {
        assertNull(briefingPhoneAnnouncement(StationPhoneResult.Direct("02-6311-5331")))
        assertNull(briefingPhoneAnnouncement(StationPhoneResult.Representative("1544-7788")))
    }

    @Test fun `번호 없음은 없다고 말하고 주의 진동`() {
        assertEquals(BriefingPhoneAnnouncement("ios.station.phoneMissing", ResultHapticKind.attention), briefingPhoneAnnouncement(StationPhoneResult.Unavailable))
    }

    @Test fun `모름은 찾고 있다고 말하고 주의 진동`() {
        assertEquals(BriefingPhoneAnnouncement("ios.station.phonePending", ResultHapticKind.attention), briefingPhoneAnnouncement(null))
    }

    @Test fun `조회 실패는 실패로 말하고 실패 진동`() {
        assertEquals(BriefingPhoneAnnouncement("ios.station.phoneError", ResultHapticKind.failure), briefingPhoneAnnouncement(StationPhoneResult.Failed))
    }
}
