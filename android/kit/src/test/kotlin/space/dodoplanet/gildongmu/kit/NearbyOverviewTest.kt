package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.NearbyOverviewResponse
import space.dodoplanet.gildongmu.kit.models.OverviewBullet
import space.dodoplanet.gildongmu.kit.models.OverviewBusStops
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceKind
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceState
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * "한눈에 보기" 디코딩 계약(Kit `NearbyOverviewTests`의 디코딩 부분). 문장 조립 `buildOverviewLines`·
 * `sceneItemToPlace` 검사는 CORE(`LocationNarrative`·`PlaceProjection`) 이식 때 옮긴다.
 */
class NearbyOverviewTest {
    private val fixture = """
{"data":{"place":"서울특별시 강동구 길동, 천중로44길 74","radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","line":"5호선","bearing":"ne","distanceMeters":262},
  "busStops":{"state":"ok","count":5,"nearest":[{"name":"길동사거리","distanceMeters":80,"bearing":"e"},{"name":"길동역","distanceMeters":120,"bearing":"n"}]}},
 {"kind":"food","state":"ok","count":15,"countCapped":true,"nearest":[{"name":"봉래면옥","distanceMeters":40,"bearing":"s"},{"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
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
        assertTrue(foodState.count == 15 && foodState.countCapped && foodState.nearest.size == 2)
        val cafeState = assertIs<OverviewPlaceState.Ok>(assertIs<OverviewBullet.Place>(data.bullets[2]).state)
        assertTrue(cafeState.count == 3 && !cafeState.countCapped)
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

    @Test fun sceneItemDecodesNewFields() {
        val item = KitJson.decodeFromString(SurroundingsSceneItem.serializer(), """{"name":"봉래면옥","distanceMeters":62,"road":"명일로","category":"restaurant","id":"kakao-2","lat":37.54,"lng":127.15,"categoryRaw":"음식점 > 한식","roadAddress":null}""")
        assertEquals("kakao-2", item.id); assertNull(item.roadAddress); assertNull(item.phone)
    }
}
