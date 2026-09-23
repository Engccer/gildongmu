package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacility
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilityGroup
import space.dodoplanet.gildongmu.nearby.NearbyKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 역 장소 상세 개편(E44 spec §3·§4·§5.5) — 레이아웃 순서·주변 앵커·전화 줄 3상태. iOS는 소스 가드(`station-detail-guard.test.ts`)가 같은 축을 잠근다. */
class PlaceLayoutTest {
    @Test fun `역 레이아웃 — 역 정보, 도착·시간표·시설, 무장애, 길찾기, 이 장소 주변(최하단)`() {
        val station = listOf(PlaceBlock.stationInfo, PlaceBlock.stationDetail, PlaceBlock.barrierFree, PlaceBlock.route, PlaceBlock.nearby)
        assertEquals(station, placeDetailBlocks(StationLayoutKind.subway))
        assertEquals(station, placeDetailBlocks(StationLayoutKind.rail))
    }

    @Test fun `역이 아닌 장소는 개편 전 순서 그대로 — 기본 정보, 길찾기, 주변, 역 섹션(드문 경우), 무장애`() {
        assertEquals(
            listOf(PlaceBlock.generalInfo, PlaceBlock.route, PlaceBlock.nearby, PlaceBlock.stationMetaSection, PlaceBlock.stationDetail, PlaceBlock.barrierFree),
            placeDetailBlocks(null),
        )
    }

    @Test fun `이 장소 주변 — 역 상세만 지하철 도착 행이 없다(판정 ④)`() {
        assertEquals(listOf(NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions), nearbyAnchorKinds(StationLayoutKind.subway))
        assertEquals(listOf(NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions), nearbyAnchorKinds(StationLayoutKind.rail))
        assertEquals(listOf(NearbyKind.subway, NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions), nearbyAnchorKinds(null))
    }

    @Test fun `전화 줄 — 자기 번호가 먼저, 대표번호는 밝히고, 실패는 없음과 가른다`() {
        assertEquals(StationPhoneRow.Call("02-6311-5471", representative = false), stationPhoneRow("02-6311-5471", null))
        // 검색 탭에서 연 코레일 구간 역도 자기 번호가 대표번호면 같은 줄 모양(어디서 열든 같은 역은 같게 읽힌다).
        assertEquals(StationPhoneRow.Call("1544-7788", representative = true), stationPhoneRow("1544-7788", StationPhoneResult.Failed))
        assertEquals(StationPhoneRow.Call("02-6110-3501", representative = false), stationPhoneRow("", StationPhoneResult.Direct("02-6110-3501")))
        assertEquals(StationPhoneRow.Call("1544-7788", representative = true), stationPhoneRow(null, StationPhoneResult.Representative("1544-7788")))
        assertEquals(StationPhoneRow.Error, stationPhoneRow(null, StationPhoneResult.Failed))
        assertEquals(StationPhoneRow.None, stationPhoneRow(null, StationPhoneResult.Unavailable))
        assertEquals(StationPhoneRow.None, stationPhoneRow(null, null)) // 모름(조회 전·조회 중)은 줄 없음
    }

    @Test fun `경유역만 조회한다 — 자기 번호 없음 ∧ 노선 힌트 ∧ transit-stop`() {
        assertTrue(needsStationPhoneLookup("transit-stop:2544", null, "수도권 7호선"))
        assertTrue(needsStationPhoneLookup("transit-stop:2544", "", "수도권 7호선"))
        assertFalse(needsStationPhoneLookup("transit-stop:2544", null, null))
        assertFalse(needsStationPhoneLookup("transit-stop:2544", "02-1", "수도권 7호선"))
        assertFalse(needsStationPhoneLookup("kakao-1", null, "수도권 7호선")) // 검색 탭 역은 카카오 POI — 다시 찾아도 같다(리뷰 L1)
    }

    @Test fun `운행 중지 수 — stopped만 센다(정상·미지 제외)`() {
        fun fac(status: String?) = SeoulMetroFacility(name = "엘리베이터", operatingStatus = status)
        val g = SeoulMetroFacilityGroup("elevator", listOf(fac("normal"), fac("stopped"), fac(null), fac("stopped"), fac("repair")))
        assertEquals(2, stoppedCount(g))
        assertEquals(0, stoppedCount(SeoulMetroFacilityGroup("elevator", emptyList())))
    }
}
