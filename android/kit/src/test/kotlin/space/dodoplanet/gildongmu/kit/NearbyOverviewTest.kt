package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.NearbyOverviewResponse
import space.dodoplanet.gildongmu.kit.models.OverviewBullet
import space.dodoplanet.gildongmu.kit.models.OverviewBusStops
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceKind
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceState
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResponse
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem
import kotlinx.serialization.SerializationException
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * "한눈에 보기" 디코딩 계약(Kit `NearbyOverviewTests`의 디코딩 부분). 문장 조립 `buildOverviewLines`는
 * `LocationNarrativeTest`, `sceneItemToPlace`는 `PlaceProjectionTest`.
 */
class NearbyOverviewTest {
    private val fixture = """
{"data":{"place":"서울특별시 강동구 길동, 천중로44길 74","radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","line":"5호선","bearing":"ne","distanceMeters":262},
  "busStops":{"state":"ok","count":5,"nearest":[{"name":"길동사거리","distanceMeters":80,"bearing":"e"},{"name":"길동역","distanceMeters":120,"bearing":"n"}]}},
 {"kind":"food","state":"ok","count":15,"countCapped":true,"nearest":[{"name":"가람식당","distanceMeters":40,"bearing":"s"},{"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
 {"kind":"cafe","state":"ok","count":3,"countCapped":false,"nearest":[{"name":"스타벅스","distanceMeters":90,"bearing":"w"},{"name":"카페 1971","distanceMeters":200,"bearing":"n"}]},
 {"kind":"kids","state":"none"},
 {"kind":"events","state":"unavailable","reason":"seoulOnly"},
 {"kind":"barrierFree","state":"failed"}
]}}"""

    private fun decode(json: String) = KitJson.decodeFromString(NearbyOverviewResponse.serializer(), json)

    @Test fun overviewDecodesEveryBulletState() {
        val data = assertNotNull(decode(fixture).data)
        assertEquals("서울특별시 강동구 길동, 천중로44길 74", data.place)
        assertEquals(1000, data.radiusMeters)
        assertEquals(6, data.bullets.size)
        val transit = assertIs<OverviewBullet.Transit>(data.bullets[0])
        assertEquals("길동", transit.station?.name)
        assertEquals("5호선", transit.station?.line)
        val bus = assertIs<OverviewBusStops.Ok>(transit.busStops)
        assertEquals(5, bus.count)
        assertEquals(listOf("길동사거리", "길동역"), bus.nearest.map { it.name })
        val food = assertIs<OverviewBullet.Place>(data.bullets[1])
        assertEquals(OverviewPlaceKind.food, food.kind)
        val foodState = assertIs<OverviewPlaceState.Ok>(food.state)
        assertEquals(15, foodState.count); assertTrue(foodState.countCapped); assertEquals(2, foodState.nearest.size)
        val cafeState = assertIs<OverviewPlaceState.Ok>(assertIs<OverviewBullet.Place>(data.bullets[2]).state)
        assertEquals(3, cafeState.count); assertFalse(cafeState.countCapped)
        assertIs<OverviewPlaceState.Empty>(assertIs<OverviewBullet.Place>(data.bullets[3]).state)
        assertIs<OverviewPlaceState.UnavailableSeoulOnly>(assertIs<OverviewBullet.Place>(data.bullets[4]).state)
        assertIs<OverviewPlaceState.Failed>(assertIs<OverviewBullet.Place>(data.bullets[5]).state)
    }

    @Test fun overviewBulletsWithUnknownKindOrStateAreDroppedNotFatal() {
        val json = """{"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"weather","state":"ok"},{"kind":"kids","state":"ok","count":1,"countCapped":false,"nearest":[]}]}}"""
        assertEquals(1, assertNotNull(decode(json).data).bullets.size)
    }

    @Test fun overviewBusStopsNullMeansBusSliceGated() {
        val json = """{"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"transit","state":"ok","station":null,"busStops":null}]}}"""
        val transit = assertIs<OverviewBullet.Transit>(assertNotNull(decode(json).data).bullets[0])
        assertNull(transit.station); assertNull(transit.busStops)
    }

    @Test fun missingRequiredKeysThrowSerializationException() {
        assertFailsWith<SerializationException> { decode("""{"data":{"place":null,"radiusMeters":1000}}""") }
        assertFailsWith<SerializationException> { decode("""{"data":{"place":null,"bullets":[]}}""") }
        assertFailsWith<SerializationException> { decode("""{"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"food"}]}}""") }
        assertFailsWith<SerializationException> { decode("""{"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"food","state":"ok"}]}}""") }
    }

    @Test fun sceneItemDecodesNewFields() {
        val item = KitJson.decodeFromString(SurroundingsSceneItem.serializer(), """{"name":"가람식당","distanceMeters":47,"road":"성내로","category":"restaurant","id":"kakao-2","lat":37.54,"lng":127.15,"categoryRaw":"음식점 > 한식","roadAddress":null}""")
        assertEquals("kakao-2", item.id); assertNull(item.roadAddress); assertNull(item.phone)
    }

    /** E65: iOS가 옵트인(`places=1`·`coords=1`)으로 받는 상세 재료가 실려도 디코딩이 깨지지 않는다(안드로이드 앱 층 이식 전). */
    @Test fun optInDetailFieldsAreToleratedUntilPorted() {
        val json = """
{"data":{"place":null,"radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","line":"5호선","bearing":"ne","distanceMeters":262,"lat":37.5378,"lng":127.1401},"busStops":null},
 {"kind":"food","state":"ok","count":1,"countCapped":false,"nearest":[{"name":"가람식당","distanceMeters":40,"bearing":"s","place":{"id":"k1","name":"가람식당","category":"음식점","address":"","roadAddress":"","lat":37.5,"lng":127.1}}]},
 {"kind":"events","state":"ok","count":1,"countCapped":false,"nearest":[{"name":"가을 음악회","distanceMeters":300,"bearing":"w","event":{"id":"seoul-1","title":"가을 음악회","category":"콘서트","place":"구민회관","district":"강동구","dateText":"2026-10-01~2026-10-31","timeText":"19:30","isFree":true,"target":"누구나","lat":37.53,"lng":127.13,"distanceMeters":300}}]}
]}}"""
        val data = assertNotNull(decode(json).data)
        assertEquals("길동", assertIs<OverviewBullet.Transit>(data.bullets[0]).station?.name)
        val food = assertIs<OverviewPlaceState.Ok>(assertIs<OverviewBullet.Place>(data.bullets[1]).state)
        assertEquals(listOf("가람식당"), food.nearest.map { it.name })
        val events = assertIs<OverviewPlaceState.Ok>(assertIs<OverviewBullet.Place>(data.bullets[2]).state)
        assertEquals(listOf("가을 음악회"), events.nearest.map { it.name })
        val subway = KitJson.decodeFromString(
            SubwayNearbyResponse.serializer(),
            """{"stations":[{"stationName":"잠실","lines":["2호선"],"distanceMeters":120,"arrivalStatus":"unknown","arrivals":[],"lat":37.5133,"lng":127.1001}]}""")
        assertEquals("잠실", subway.stations.single().stationName)
    }
}

