package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.PlaceSort
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Kit `SearchServiceTests` 미러. 경로별 스텁 응답. */
class SearchServiceTest {
    private fun service(handler: (path: String) -> HttpResponse): Pair<SearchService, StubTransport> {
        val transport = StubTransport { url -> handler(pathOf(url)) }
        return SearchService(APIClient("https://example.test", transport)) to transport
    }

    private val emptyPlaces = HttpResponse(200, """{"places":[],"provider":"none","query":"q"}""")
    private val emptyAddresses = HttpResponse(200, """{"addresses":[],"query":"q"}""")
    private val emptyWeb = HttpResponse(200, """{"web":[]}""")
    private val oneWeb = HttpResponse(200, """{"web":[{"title":"t","url":"https://x","snippet":"s","date":null}]}""")
    private val notFound = HttpResponse(404, "")

    @Test fun orderedSectionsSortsByCountDesc() {
        val outcome = SearchOutcome(
            places = SectionState.Loaded(emptyList()),
            addresses = SectionState.Loaded(listOf(JusoAddress("r", "r1", "j", "e", "04524", ""))),
            web = SectionState.Loaded(emptyList()),
        )
        val sections = outcome.orderedSections
        assertEquals(1, sections.size)
        assertEquals(1, assertIs<SearchSection.Addresses>(sections[0]).count)
    }

    @Test fun webFallbackOnlyWhenBothEmpty() = runTest {
        val (svc, _) = service { path -> when (path) { "/api/places" -> emptyPlaces; "/api/address/search" -> emptyAddresses; "/api/search/web" -> oneWeb; else -> notFound } }
        val outcome = svc.search("q", null, null, "ko")
        assertEquals(1, outcome.orderedSections.size)
        assertEquals(1, assertIs<SearchSection.Web>(outcome.orderedSections[0]).count)
    }

    @Test fun reviewSortSendsSortParamOnlyToPlacesAndKeepsProvider() = runTest {
        val (svc, transport) = service { path -> when (path) {
            "/api/places" -> HttpResponse(200, """{"places":[],"provider":"naver-local","query":"q"}""")
            "/api/address/search" -> emptyAddresses
            "/api/search/web" -> emptyWeb
            else -> notFound
        } }
        val outcome = svc.search("q", null, null, "ko", sort = PlaceSort.review)
        val placesUrl = transport.seenUrls.first { pathOf(it) == "/api/places" }
        val addressUrl = transport.seenUrls.first { pathOf(it) == "/api/address/search" }
        assertTrue(queryOf(placesUrl).contains("sort=review"))
        assertFalse(queryOf(addressUrl).contains("sort="))
        assertEquals("naver-local", outcome.placesProvider)

        transport.seenUrls.clear()
        val plain = svc.search("q", null, null, "ko")
        assertFalse(queryOf(transport.seenUrls.first { pathOf(it) == "/api/places" }).contains("sort="))
        assertEquals("naver-local", plain.placesProvider)
    }

    @Test fun sectionFailureIsIsolated() = runTest {
        val (svc, _) = service { path -> when (path) {
            "/api/places" -> HttpResponse(502, """{"error":"실패"}""")
            "/api/address/search" -> HttpResponse(200, """{"addresses":[{"roadAddr":"세종대로 110","roadAddrPart1":"세종대로 110","jibunAddr":"태평로1가","engAddr":"110 Sejong-daero","zipNo":"04524","bdNm":""}],"query":"q"}""")
            else -> notFound
        } }
        val outcome = svc.search("q", null, null, "ko")
        assertEquals(1, outcome.orderedSections.size)
        assertFalse(outcome.allFailed)
    }

    @Test fun partialFailureIsVisiblePerSection() = runTest {
        val (svc, _) = service { path -> when (path) { "/api/places" -> HttpResponse(502, """{"error":"실패"}"""); "/api/address/search" -> emptyAddresses; "/api/search/web" -> emptyWeb; else -> notFound } }
        val outcome = svc.search("q", null, null, "ko")
        assertTrue(outcome.places.isFailed)
        assertFalse(outcome.addresses.isFailed)
        assertFalse(outcome.allFailed)
    }

    @Test fun totalFailureIsSignaledNotSilenced() = runTest {
        val (svc, _) = service { HttpResponse(502, """{"error":"실패"}""") }
        val outcome = svc.search("q", null, null, "ko")
        assertTrue(outcome.allFailed)
        assertTrue(outcome.orderedSections.isEmpty())
    }

    @Test fun coordinatesArePassedToPlacesQuery() = runTest {
        val (svc, transport) = service { path -> when (path) { "/api/places" -> emptyPlaces; "/api/address/search" -> emptyAddresses; "/api/search/web" -> emptyWeb; else -> notFound } }
        svc.search("q", 37.5547, 126.9707, "ko")
        val q = queryOf(transport.seenUrls.first { pathOf(it) == "/api/places" })
        assertTrue(q.contains("lat=37.5547") && q.contains("lng=126.9707") && q.contains("lang=ko"), q)
    }

    @Test fun includeWebFalseSkipsWebFallback() = runTest {
        val (svc, transport) = service { path -> when (path) { "/api/places" -> emptyPlaces; "/api/address/search" -> emptyAddresses; "/api/search/web" -> oneWeb; else -> notFound } }
        val outcome = svc.search("q", null, null, "ko", includeWeb = false)
        assertTrue(outcome.orderedSections.isEmpty())
        assertTrue(outcome.web.items.isEmpty())
        assertTrue(transport.seenUrls.none { pathOf(it) == "/api/search/web" })
    }

    @Test fun geocodeDecodesMatches() = runTest {
        val (svc, _) = service { path -> if (path == "/api/geocode") HttpResponse(200, """{"matches":[{"addressName":"서울 강동구 천호대로 1077","roadAddress":"서울 강동구 천호대로 1077","jibunAddress":null,"postalCode":"05340","lat":37.5385,"lng":127.1237}],"query":"천호대로 1077"}""") else notFound }
        val matches = svc.geocode("천호대로 1077")
        assertEquals(1, matches.size)
        assertEquals(37.5385, matches.first().lat)
    }

    @Test fun geocodeFailureThrows() = runTest {
        val (svc, _) = service { HttpResponse(502, """{"error":"주소 변환에 실패했습니다."}""") }
        assertFailsWith<APIError> { svc.geocode("천호대로 1077") }
    }

    @Test fun reverseGeocodeDecodesAddress() = runTest {
        val (svc, _) = service { path -> if (path == "/api/geocode/reverse") HttpResponse(200, """{"address":"서울 강동구 천호대로 1077"}""") else notFound }
        val response = svc.reverseGeocode(37.5385, 127.1237, "ko")
        assertEquals("서울 강동구 천호대로 1077", response.address)
        assertNull(response.english)
    }

    @Test fun reverseGeocodeEnCarriesEnglish() = runTest {
        val (svc, transport) = service { HttpResponse(200, """{"address":"서울 강동구 천호대로 1077","addressEn":"1077 Cheonho-daero, Gangdong-gu, Seoul"}""") }
        val response = svc.reverseGeocode(37.5385, 127.1237, "en")
        assertTrue(queryOf(transport.seenUrls.single()).contains("lang=en"))
        assertEquals("1077 Cheonho-daero, Gangdong-gu, Seoul", response.english)
        val (roman, _) = service { HttpResponse(200, """{"address":"서울 강동구 길동 123","addressRoman":"Seoul Gangdong-gu Gil-dong 123"}""") }
        assertEquals("Seoul Gangdong-gu Gil-dong 123", roman.reverseGeocode(37.5385, 127.1237, "en").english)
    }

    @Test fun reverseGeocodeNoMatchIsNull() = runTest {
        val (svc, _) = service { HttpResponse(200, """{"address":null}""") }
        assertNull(svc.reverseGeocode(37.5385, 127.1237, "ko").address)
    }

    @Test fun destinationEntranceDecodesMatch() = runTest {
        val (svc, transport) = service { HttpResponse(200, """{"entrance":{"name":"신명중학교 정문","lat":37.5416844,"lng":127.1489539,"meters":56}}""") }
        val match = svc.destinationEntrance("신명중학교", 37.5414909, 127.1495375, 37.5352, 127.1441)
        assertEquals("신명중학교 정문", match?.name)
        assertEquals(56.0, match?.meters)
        val q = queryOf(transport.seenUrls.single())
        assertTrue(q.contains("fromLat=37.5352") && q.contains("fromLng=127.1441"), q)
    }

    @Test fun destinationEntranceOmitsOriginWhenUnknown() = runTest {
        val (svc, transport) = service { HttpResponse(200, """{"entrance":null}""") }
        assertNull(svc.destinationEntrance("천호역", 37.5385, 127.1239, null, null))
        assertFalse(queryOf(transport.seenUrls.single()).contains("fromLat"))
    }

    @Test fun destinationEntranceFailureIsNull() = runTest {
        val (svc, _) = service { HttpResponse(502, """{"error":"실패"}""") }
        assertNull(svc.destinationEntrance("신명중학교", 37.5414909, 127.1495375, null, null))
    }
}
