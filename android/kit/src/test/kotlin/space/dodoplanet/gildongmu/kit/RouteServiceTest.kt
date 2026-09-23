package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 경로 조회 쿼리 계약 — Kit `RouteServiceQueryTests`의 RouteService 부분 + `RouteModelsTests.routeServiceWalk*`
 * (foundation.json 유예분) 미러. 옵트인 파라미터는 켜면 명시하고, 끄면 키 자체를 생략해 기존 요청과
 * byte-identical이어야 한다(서버 zod가 허용 값 밖을 400으로 거부 — 조용한 강등 금지 계약).
 */
class RouteServiceTest {
    private val nullResult = HttpResponse(200, """{"result":null}""")
    private val carBody = HttpResponse(200, """{"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[]}""")

    private fun service(response: HttpResponse): Pair<RouteService, StubTransport> {
        val transport = StubTransport { response }
        return RouteService(APIClient("https://example.test", transport)) to transport
    }

    @Test fun walkAccessibleRequestsAccessibleTrue() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = true, lang = DataLocale.ko, via = null)
        assertTrue(t.lastQuery().has("accessible", "true"))
    }

    /** E16 축3: ko는 파라미터를 생략해 기존 요청과 byte-identical이고, 비-ko만 `lang`을 싣는다. */
    @Test fun walkSendsLangOnlyForNonKorean() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.en, via = null)
        assertTrue(t.lastQuery().has("lang", "en"))
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, via = null)
        assertFalse(t.lastQuery().hasName("lang"))
    }

    /** 대조: 기본 모드는 accessible·includeGeometry·variant 파라미터를 보내지 않는다(기존 요청 byte-identical). */
    @Test fun walkDefaultOmitsOptInParams() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, via = null)
        val q = t.lastQuery()
        assertFalse(q.hasName("accessible"))
        assertFalse(q.hasName("includeGeometry"))
        assertFalse(q.hasName("variant"))
        assertEquals(listOf("origin" to "37.5,127.0", "dest" to "37.6,127.1"), q)
    }

    /** 실시간 상세 안내용 기하 옵트인(웹 `?includeGeometry=1` 계약). 서버가 "1"만 허용한다. */
    @Test fun walkIncludeGeometryRequestsFlagOne() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, includeGeometry = true, via = null)
        assertTrue(t.lastQuery().has("includeGeometry", "1"))
    }

    /** M3 전환·재조회의 accessible 보존 게이트(spec §3.2 — A4 회귀 축). variant가 붙어도 accessible이 탈락하지 않는다. */
    @Test fun walkVariantKeepsAccessible() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = true, lang = DataLocale.ko, includeGeometry = true, variant = WalkRouteVariant.shortest, via = null)
        val q = t.lastQuery()
        assertTrue(q.has("variant", "shortest"))
        assertTrue(q.has("accessible", "true"))
        assertTrue(q.has("includeGeometry", "1"))
    }

    /** 대안 병렬 조회도 accessible을 보존하고 alternatives=1을 명시한다(spec §3.1). 기하는 싣지 않는다(조합 400). */
    @Test fun walkAlternativesKeepsAccessible() = runTest {
        val (svc, t) = service(HttpResponse(200, """{"result":null,"shortest":null}"""))
        val alt = svc.walkAlternatives(37.5, 127.0, 37.6, 127.1, accessible = true, lang = DataLocale.ko, via = null)
        val q = t.lastQuery()
        assertTrue(q.has("alternatives", "1"))
        assertTrue(q.has("accessible", "true"))
        assertFalse(q.hasName("includeGeometry"))
        assertNull(alt.result); assertNull(alt.shortest)
    }

    /**
     * 줄 목록(E42)은 `lines=1` 단독 옵트인 — 계단 회피·경로 축·기하·alternatives와 조합하면 서버 400이다.
     * 모르는 종류의 줄은 이름을 지어 붙이지 않고 뺀다(`stepFree` 원시 문자열 규율 동형).
     */
    @Test fun walkLinesIsSoloOptInAndDropsUnknownKinds() = runTest {
        val body = """{"lines":[{"kind":"scenic","route":{"distanceMeters":900,"durationSeconds":700,"steps":[]}},""" +
            """{"kind":"shortest","route":{"distanceMeters":850,"durationSeconds":720,"steps":[]}},""" +
            """{"kind":"broad","route":{"distanceMeters":880,"durationSeconds":780,"steps":[]}}]}"""
        val (svc, t) = service(HttpResponse(200, body))
        val lines = svc.walkLines(37.5, 127.0, 37.6, 127.1, lang = DataLocale.ko, via = null)
        assertEquals(listOf(WalkLineKind.shortest, WalkLineKind.broad), lines.map { it.lineKind })
        val q = t.lastQuery()
        assertTrue(q.has("lines", "1"))
        for (name in listOf("accessible", "variant", "includeGeometry", "alternatives", "lang")) assertFalse(q.hasName(name), name)
    }

    /** 기하 응답의 `kind`(E42)는 받은 경로의 성질 — 원시 문자열로 받아 모르는 값·부재는 null. */
    @Test fun walkBriefingKindDecodesLeniently() {
        fun decode(kind: String?): WalkRouteBriefing {
            val tail = kind?.let { ""","kind":"$it"""" } ?: ""
            return KitJson.decodeFromString(WalkRouteBriefing.serializer(), """{"distanceMeters":1,"durationSeconds":1,"steps":[]$tail}""")
        }
        assertEquals(WalkLineKind.broad, decode("broad").lineKind)
        assertNull(decode("scenic").lineKind)
        assertNull(decode(null).lineKind)
    }

    /** 줄 종류의 안내 요청 축(E42): 최단→variant, 계단 회피→accessible, 큰길·추천→기본. */
    @Test fun walkLineKindProjectsGuideRequestAxis() {
        assertTrue(WalkLineKind.shortest.variant == WalkRouteVariant.shortest && !WalkLineKind.shortest.isAccessible)
        assertTrue(WalkLineKind.accessible.variant == null && WalkLineKind.accessible.isAccessible)
        assertTrue(WalkLineKind.broad.variant == null && !WalkLineKind.broad.isAccessible)
        assertTrue(WalkLineKind.recommended.variant == null && !WalkLineKind.recommended.isAccessible)
    }

    /** 경유지(N4): `via`는 "위도,경도" 한 파라미터. null이면 키 자체를 생략. */
    @Test fun walkViaSendsLatLngPair() = runTest {
        val (svc, t) = service(nullResult)
        svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, via = RoutePoint(37.55, 127.05))
        assertTrue(t.lastQuery().has("via", "37.55,127.05"))
    }

    @Test fun carViaNilOmitsParam() = runTest {
        val (svc, t) = service(carBody)
        svc.car(37.5, 127.0, 37.6, 127.1, lang = "ko", via = null)
        assertFalse(t.lastQuery().hasName("via"))
    }

    /** A26: 자동차도 walk와 같은 규율 — ko는 파라미터를 생략하고 비-ko만 싣는다. */
    @Test fun carSendsLangOnlyForNonKorean() = runTest {
        val (svc, t) = service(carBody)
        svc.car(37.5, 127.0, 37.6, 127.1, lang = "en", via = null)
        assertTrue(t.lastQuery().has("lang", "en"))
        svc.car(37.5, 127.0, 37.6, 127.1, lang = "ko", includeGeometry = true, via = RoutePoint(37.55, 127.05))
        val q = t.lastQuery()
        assertFalse(q.hasName("lang"))
        assertTrue(q.has("includeGeometry", "1"))
        assertTrue(q.has("via", "37.55,127.05"))
    }

    /** E27: 대중교통 `lang` — 비-ko만 싣는다. includeStops도 옵트인. */
    @Test fun transitLangEnRequestsLangParam() = runTest {
        val (svc, t) = service(nullResult)
        svc.transit(37.5, 127.0, 37.6, 127.1, includeStops = true, lang = "en")
        assertTrue(t.lastQuery().has("lang", "en"))
        assertTrue(t.lastQuery().has("includeStops", "1"))
        svc.transit(37.5, 127.0, 37.6, 127.1, lang = "ko")
        assertFalse(t.lastQuery().hasName("lang"))
        assertFalse(t.lastQuery().hasName("includeStops"))
    }

    /** 404 게이트는 여기서 흡수하지 않고 그대로 throw(게이트 판정은 DirectionsOutcomeClassifier). */
    @Test fun routeServiceWalkThrowsBadStatusOn404() = runTest {
        val (svc, _) = service(HttpResponse(404, """{"error":"도보 길찾기는 API 키 등록 후 사용할 수 있습니다."}"""))
        val error = assertFailsWith<APIError.BadStatus> {
            svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, via = null)
        }
        assertEquals(404, error.code)
    }

    @Test fun routeServiceWalkNullResultReturnsNilNotThrow() = runTest {
        val (svc, _) = service(nullResult)
        assertNull(svc.walk(37.5, 127.0, 37.6, 127.1, accessible = false, lang = DataLocale.ko, via = null))
        assertNull(svc.transit(37.5, 127.0, 37.6, 127.1, lang = "ko"))
    }

    @Test fun enumRawValuesMatchServerQuery() {
        assertEquals("shortest", WalkRouteVariant.shortest.rawValue)
        assertEquals(listOf("ko", "en"), DataLocale.entries.map { it.rawValue })
        assertEquals(DataLocale.en, DataLocale.fromRawValue("en"))
        assertNull(DataLocale.fromRawValue("ja"))
    }
}
