package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.BarrierFreePlace
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.EventsNearbyResponse
import space.dodoplanet.gildongmu.kit.models.KidsPlace
import space.dodoplanet.gildongmu.kit.models.NearbyOverviewResponse
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.WhereAmIAddress
import space.dodoplanet.gildongmu.kit.models.WhereAmIData
import space.dodoplanet.gildongmu.kit.models.WhereAmIStation
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Place 합성 헬퍼 계약 — Kit `PlaceProjectionTests` 미러(웹 `nearby-place.ts`·`where-am-i-place.ts` 필드 매핑).
 * category는 채팅 프롬프트 라우팅 키(isStation 판정)이므로 각 소스를 정확히 검증한다. foundation.json 유예분
 * `KakaoCategoryTests.projectionsCarryCategoryEnAndKeepRawCategory`·`NearbyOverviewTests.sceneItemToPlace*`도 여기.
 */
class PlaceProjectionTest {
    @Test fun nightClinicToPlaceMapsKindAsCategory() {
        val clinic = NightClinic(
            id = "hpid-1", name = "길동소아과의원", address = "서울 강동구 길동",
            phone = "02-1234-5678", kind = "의원", emergencyClass = "응급의료기관 이외",
            directions = "", lat = 37.5384, lng = 127.1428, distanceMeters = 320,
            hours = emptyList(), openStatus = NightClinic.OpenStatus("open", 900, 1800), designated = true,
        )
        val place = nightClinicToPlace(clinic)
        assertEquals("hpid-1", place.id)
        assertEquals("길동소아과의원", place.name)
        assertEquals("의원", place.category)
        // dutyAddr은 도로명 주소(명부 153건 전수 확인) — 지번 슬롯에 넣으면 "지번 주소 …"로 낭독한다.
        assertEquals("서울 강동구 길동", place.roadAddress)
        assertEquals("", place.address)
        assertEquals(37.5384, place.lat); assertEquals(127.1428, place.lng)
        assertEquals("02-1234-5678", place.phone)
        assertNull(place.link)
        assertEquals(320.0, place.distanceMeters)
    }

    @Test fun nightClinicToPlaceEmptyPhoneBecomesNil() {
        val clinic = NightClinic(
            id = "hpid-2", name = "굽은다리소아과", address = "", phone = "", kind = "병원",
            emergencyClass = "", directions = "", lat = 37.53, lng = 127.14, distanceMeters = 500,
            hours = emptyList(), openStatus = NightClinic.OpenStatus("unknown", null, null), designated = false,
        )
        assertNull(nightClinicToPlace(clinic).phone)
    }

    @Test fun kidsPlaceToPlaceMapsCategoryAndFallsBackRoadAddress() {
        val kids = KidsPlace(
            id = "kakao-1", name = "길동키즈카페", category = "가정,생활 > 유아용품 > 키즈카페",
            kind = "kidscafe", indoorOutdoor = "indoor", distanceMeters = 150,
            address = "서울 강동구 길동 1", roadAddress = null, lat = 37.539, lng = 127.143,
            phone = "02-999-9999", link = "https://place.map.kakao.com/1",
        )
        val place = kidsPlaceToPlace(kids)
        assertEquals("kakao-1", place.id)
        assertEquals("길동키즈카페", place.name)
        assertEquals("가정,생활 > 유아용품 > 키즈카페", place.category)
        assertEquals("서울 강동구 길동 1", place.address)
        // roadAddress null이면 빈 문자열로 폴백(웹 `k.roadAddress ?? ""` 동형).
        assertEquals("", place.roadAddress)
        assertEquals(37.539, place.lat); assertEquals(127.143, place.lng)
        assertEquals("02-999-9999", place.phone)
        assertEquals("https://place.map.kakao.com/1", place.link)
        assertEquals(150.0, place.distanceMeters)
    }

    @Test fun surroundingPlaceToPlaceUsesCategoryRawNotCategoryKey() {
        val p = SurroundingPlace(
            id = "kakao-2", name = "길동역 2번 출구", category = "subway",
            categoryRaw = "교통,수송 > 지하철,전철 > 지하철역", distanceMeters = 80,
            bearing = "n", lat = 37.5385, lng = 127.1432, phone = null, link = null,
        )
        val place = surroundingPlaceToPlace(p)
        assertEquals("kakao-2", place.id)
        assertEquals("길동역 2번 출구", place.name)
        // category 키("subway")가 아니라 categoryRaw 전체 계층을 써야 isStation 판정이 된다.
        assertEquals("교통,수송 > 지하철,전철 > 지하철역", place.category)
        assertEquals("", place.address); assertEquals("", place.roadAddress)
        assertEquals(37.5385, place.lat); assertEquals(127.1432, place.lng)
        assertEquals(80.0, place.distanceMeters)
    }

    @Test fun whereAmIToPlaceCategoryAlwaysEmptyToAvoidStationMisclassification() {
        val data = WhereAmIData(
            address = WhereAmIAddress(road = "천호대로 1042", jibun = "길동 247"),
            region = "서울특별시 강동구 길동",
            nearestStation = WhereAmIStation(name = "길동", line = "5호선", bearing = "n", distanceMeters = 336),
            landmarks = emptyList(),
        )
        val place = whereAmIToPlace(data, lat = 37.53842, lng = 127.14281, lang = "ko")
        // nearestStation이 있어도 category는 항상 빈 문자열(isStation false 고정).
        assertEquals("", place.category)
        assertEquals("서울특별시 강동구 길동", place.name)
        assertEquals("길동 247", place.address)
        assertEquals("천호대로 1042", place.roadAddress)
        assertEquals("where-am-i-37.53842-127.14281", place.id)
        // 소수점이 `,`인 기본 로케일에서도 id는 `.`이다(Locale.ROOT의 검출력).
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            assertEquals("where-am-i-37.53842-127.14281", whereAmIToPlace(data, lat = 37.53842, lng = 127.14281, lang = "ko").id)
        } finally {
            Locale.setDefault(saved)
        }
        assertEquals(37.53842, place.lat); assertEquals(127.14281, place.lng)
        assertNull(place.phone); assertNull(place.link); assertNull(place.distanceMeters)
    }

    @Test fun whereAmIToPlaceNameFallsBackRoadThenJibunThenDefault() {
        val roadOnly = WhereAmIData(address = WhereAmIAddress(road = "천호대로 1042", jibun = null), region = null, nearestStation = null, landmarks = emptyList())
        assertEquals("천호대로 1042", whereAmIToPlace(roadOnly, 0.0, 0.0, "ko").name)
        val jibunOnly = WhereAmIData(address = WhereAmIAddress(road = null, jibun = "길동 247"), region = null, nearestStation = null, landmarks = emptyList())
        assertEquals("길동 247", whereAmIToPlace(jibunOnly, 0.0, 0.0, "ko").name)
        val none = WhereAmIData(address = null, region = null, nearestStation = null, landmarks = emptyList())
        assertEquals("현재 위치", whereAmIToPlace(none, 0.0, 0.0, "ko").name)
    }

    @Test fun barrierFreePlaceToPlaceMapsRoadAddressSlot() {
        val bf = BarrierFreePlace(
            contentId = "130183", name = "서울도서관", category = "",
            address = "서울특별시 중구 세종대로 110 (태평로1가)", lat = 37.5666, lng = 126.9784, distanceMeters = 34,
        )
        val place = barrierFreePlaceToPlace(bf)
        assertEquals("130183", place.id)
        assertEquals("서울도서관", place.name)
        assertEquals("", place.category)
        // TourAPI addr1은 도로명 주소(fixture 실측) — 지번 슬롯이면 상세가 "지번 주소 …"로 오낭독.
        assertEquals("서울특별시 중구 세종대로 110 (태평로1가)", place.roadAddress)
        assertEquals("", place.address)
        assertNull(place.phone); assertNull(place.link)
        assertEquals(34.0, place.distanceMeters)
    }

    @Test fun cultureEventToPlaceUsesTitleAndLeavesAddressEmpty() {
        val event = CultureEvent(
            id = "seoul-158804", title = "백제왕성 달빛 캠프", category = "교육/체험",
            place = "서울백제어린이박물관 주변 잔디밭", district = "송파구",
            dateText = "2026-04-17~2026-11-27", timeText = "17:30 ~ 20:00",
            isFree = true, fee = null, target = "유아·어린이 동반 30가족",
            link = "https://culture.seoul.go.kr/x?cultcode=158804",
            lat = 37.523991, lng = 127.124412, distanceMeters = 2310,
        )
        val place = cultureEventToPlace(event)
        // 상세 제목은 개최 장소가 아니라 행사명이다(목록에서 고른 것이 행사이므로).
        assertEquals("백제왕성 달빛 캠프", place.name)
        assertEquals("교육/체험", place.category)
        // ⚠ 주소 슬롯은 비운다 — `place`는 시설 설명이라 넣으면 도로명 주소로 낭독된다.
        assertEquals("", place.address); assertEquals("", place.roadAddress)
        assertEquals(37.523991, place.lat); assertEquals(127.124412, place.lng)
        assertEquals("https://culture.seoul.go.kr/x?cultcode=158804", place.link)
        assertEquals(2310.0, place.distanceMeters)
    }

    /** 라우트 실응답 모양(무료 행사는 fee 키 자체가 없다) — 엄격 디코딩 방어. */
    @Test fun cultureEventDecodesRouteResponseShape() {
        val json = """{"events":[{"id":"seoul-1","title":"행사","category":"전시/미술","place":"장소","district":"중구","dateText":"2026-08-01~2026-08-31","timeText":"10:00","isFree":true,"target":"누구나","lat":37.5,"lng":127.0,"distanceMeters":120}],"total":84}"""
        val decoded = KitJson.decodeFromString(EventsNearbyResponse.serializer(), json)
        assertEquals(84, decoded.total)
        assertEquals(1, decoded.events.size)
        assertNull(decoded.events[0].fee); assertNull(decoded.events[0].link)
    }

    @Test fun guideDestinationPlaceKeepsCoordsAndLabelWithEmptyCategory() {
        val place = guideDestinationPlace(BeaconDest(lat = 37.5361, lng = 127.1462), label = "오아시스마켓")
        assertEquals("오아시스마켓", place.name)
        assertEquals(37.5361, place.lat); assertEquals(127.1462, place.lng)
        // category 빈 문자열 고정 — 라벨만으로 역 프롬프트 버킷을 판정하지 않는다.
        assertEquals("", place.category)
        // 주소는 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
        assertEquals("", place.address); assertEquals("", place.roadAddress)
        assertEquals("guide-dest:37.5361,127.1462", place.id)
    }

    /** 둘러보기 앵커: 위치 문장 재료가 있으면 그것과 그 로마자, 없으면 "현재 위치"와 로마자 없음(Kit 테스트 없음, 웹 동형 보강). */
    @Test fun overviewAnchorPlaceFallsBackToReadyLabel() {
        fun overview(place: String?) = assertNotNull(
            KitJson.decodeFromString(
                NearbyOverviewResponse.serializer(),
                """{"data":{"place":${place?.let { "\"$it\"" } ?: "null"},"placeRoman":"Gil-dong","radiusMeters":1000,"bullets":[]}}""",
            ).data,
        )
        val named = overviewAnchorPlace(overview("서울특별시 강동구 길동"), 37.53842, 127.14281, "ko")
        assertEquals("서울특별시 강동구 길동", named.name)
        assertEquals("Gil-dong", named.nameRoman)
        assertEquals("where-am-i-37.53842-127.14281", named.id)
        assertEquals("", named.category)
        val empty = overviewAnchorPlace(overview(""), 37.5, 127.1, "ko")
        assertEquals("현재 위치", empty.name)
        assertNull(empty.nameRoman)
    }

    // 대중교통 경유역 → Place · 상태 문장 역 언급 (E33)

    private fun viaStop(name: String, en: String? = null, id: String? = null, lat: Double = 37.5, lng: Double = 127.1) =
        TransitLegStop(name = name, stationId = id, lat = lat, lng = lng, nameEn = en)

    @Test fun transitStopPlaceKeepsKoreanNameAsJoinKeyAndPassesIsStation() {
        val place = transitStopPlace(viaStop("천호(풍납토성)", en = "Cheonho", id = "0554", lat = 37.5386, lng = 127.1236))
        assertEquals("transit-stop:0554", place.id)
        // 조인 키는 한국어 원문 — 역 섹션 조회가 이 값으로 돈다.
        assertEquals("천호(풍납토성)", place.name)
        assertEquals("Cheonho", place.nameRoman)
        assertTrue(isStation(place))
        assertEquals(37.5386, place.lat); assertEquals(127.1236, place.lng)
        // 소스에 없는 값은 비운다.
        assertTrue(place.address == "" && place.roadAddress == "" && place.phone == null && place.link == null)
    }

    @Test fun transitStopPlaceFallsBackToCoordinateIdAndNilRoman() {
        val place = transitStopPlace(viaStop("여의도", en = "", id = "", lat = 37.5216, lng = 126.9243))
        assertEquals("transit-stop:37.5216,126.9243", place.id)
        // 빈 영문은 부재다(빈 문자열 병기 금지).
        assertNull(place.nameRoman)
    }

    @Test fun transitStationMentionsMatchBothLabelsInAppearanceOrder() {
        val stops = listOf(viaStop("천호(풍납토성)", en = "Cheonho"), viaStop("여의도", en = "Yeouido"), viaStop("신촌", en = "Sinchon"))
        // ko 문장: 등장 순, 같은 역 두 번은 한 번.
        assertEquals(listOf(1), transitStationMentions("5호선 탑승 중, 여의도에서 하차합니다. 다음 역 여의도.", stops))
        assertEquals(listOf(0, 1), transitStationMentions("천호(풍납토성)에서 5호선 탑승 기다리는 중. 하차: 여의도.", stops))
        // en 문장·혼합 문장(조각별 언어가 갈린 줄) 모두 잡는다.
        assertEquals(listOf(1), transitStationMentions("Riding Line 5, get off at Yeouido.", stops))
        assertEquals(listOf(1, 0), transitStationMentions("Riding Line 5, get off at Yeouido. 다음 역 여의도. Cheonho 출발.", stops))
        // 언급 없음.
        assertEquals(emptyList(), transitStationMentions("남은 정거장 3개.", stops))
    }

    @Test fun transitStationMentionsPrefersLongerNameLikeChatMentions() {
        val stops = listOf(viaStop("신촌"), viaStop("신촌(경의중앙선)"))
        assertEquals(listOf(1), transitStationMentions("다음 역 신촌(경의중앙선).", stops))
    }

    // foundation.json 유예분

    /** Kit `NearbyOverviewTests.sceneItemToPlaceCarriesCoordinatesAndRawCategory`. */
    @Test fun sceneItemToPlaceCarriesCoordinatesAndRawCategory() {
        val item = SurroundingsSceneItem(
            name = "서울신명초등학교", distanceMeters = 75, road = null, category = "school",
            id = "kakao-1", lat = 37.5415, lng = 127.1503, categoryRaw = "교육,학문 > 학교 > 초등학교",
            roadAddress = "서울특별시 강동구 명일로24길 33", phone = "02-000-0000", link = "https://place.map.kakao.com/1",
        )
        val place = sceneItemToPlace(item)
        assertEquals("kakao-1", place.id)
        assertEquals("서울신명초등학교", place.name)
        assertEquals("교육,학문 > 학교 > 초등학교", place.category)
        assertEquals("서울특별시 강동구 명일로24길 33", place.roadAddress)
        assertTrue(place.lat == 37.5415 && place.lng == 127.1503)
        assertEquals("02-000-0000", place.phone)
        assertEquals(75.0, place.distanceMeters)
    }

    /** Kit `KakaoCategoryTests.projectionsCarryCategoryEnAndKeepRawCategory`(A28 — 영문은 나르기만, 판정은 원문). */
    @Test fun projectionsCarryCategoryEnAndKeepRawCategory() {
        val kids = KidsPlace(
            id = "kakao-1", name = "키즈카페", category = "가정,생활 > 유아 > 놀이시설 > 키즈카페",
            categoryEn = "Home & Living > Kids > Play Facility > Kids Cafe", kind = "kidscafe", indoorOutdoor = "indoor",
            distanceMeters = 150, address = "", roadAddress = null, lat = 37.5, lng = 127.1, phone = null, link = null,
        )
        val kp = kidsPlaceToPlace(kids)
        assertEquals("가정,생활 > 유아 > 놀이시설 > 키즈카페", kp.category)
        assertEquals("Home & Living > Kids > Play Facility > Kids Cafe", kp.categoryEn)

        val around = SurroundingPlace(
            id = "kakao-3", name = "강동역 3번출구", category = "subway", categoryRaw = "교통,수송 > 지하철,전철 > 수도권5호선",
            categoryEn = "Transportation > Subway > Line 5", distanceMeters = 30, bearing = "n", lat = 37.5, lng = 127.1,
            phone = null, link = null,
        )
        val ap = surroundingPlaceToPlace(around)
        assertEquals("교통,수송 > 지하철,전철 > 수도권5호선", ap.category)
        assertEquals("Transportation > Subway > Line 5", ap.categoryEn)
        // 역 판정은 원문 축 — 영문이 실려도 결과 불변.
        assertTrue(isStation(ap))

        val item = SurroundingsSceneItem(
            name = "CU", distanceMeters = 40, road = null, category = "convenience", id = "kakao-4", lat = 37.5, lng = 127.1,
            categoryRaw = "가정,생활 > 편의점 > CU", categoryEn = "Home & Living > Convenience Store > CU",
            roadAddress = null, phone = null, link = null,
        )
        val sp = sceneItemToPlace(item)
        assertEquals("가정,생활 > 편의점 > CU", sp.category)
        assertEquals("Home & Living > Convenience Store > CU", sp.categoryEn)
        assertFalse(isStation(sp))
    }
}
