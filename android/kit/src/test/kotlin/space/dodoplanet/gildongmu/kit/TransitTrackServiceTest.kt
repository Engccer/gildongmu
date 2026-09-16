package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 추적 폴링 쿼리 계약. Kit 테스트는 없고 iOS 쪽은 웹 소스 가드(`transit-display-guard.test.ts`)가 `lang` 이름을 잠그는데, 그 가드는
 * Swift만 읽는다 — Kotlin 쪽 오타(`"language"`)는 서버가 조용히 무시해 en 실시간 줄만 한국어로 떨어지므로 여기서 잠근다.
 */
class TransitTrackServiceTest {
    private val body = """{"mode":"subway","status":"empty"}"""

    /** 한 호출이 실은 쿼리 (이름, 값) — 순서 그대로. */
    private suspend fun queryItems(call: suspend (TransitTrackService) -> TransitTrackEnvelope): List<QueryItem> {
        var seen = ""
        val service = TransitTrackService(
            stubbedClient { url ->
                assertEquals("/api/transit/track", pathOf(url))
                seen = url
                HttpResponse(200, body)
            },
        )
        call(service)
        return queryItemsOf(seen)
    }

    /**
     * Swift 인스턴스 `public func`별 `URLQueryItem(name:value:)` — 값이 보간 없는 문자열 리터럴이면 그 값, 아니면 null. 본문의 끝은
     * 가시성·static과 무관하게 다음 `func` 선언이라 사이에 낀 private 헬퍼의 쿼리가 앞 함수로 귀속되지 않는다.
     */
    private fun swiftQueryItems(): Map<String, List<Pair<String, String?>>> {
        val source = SwiftSource.read("TransitTrackService.swift")
        val decls = Regex("""^[ \t]*(?:[a-z]+[ \t]+)*func ([A-Za-z]+)\(""", RegexOption.MULTILINE).findAll(source).toList()
        return decls.indices.filter { decls[it].value.trimStart().startsWith("public func ") }.associate { i ->
            val body = source.substring(decls[i].range.last, decls.getOrNull(i + 1)?.range?.first ?: source.length)
            val items = Regex("""URLQueryItem\(name: "([A-Za-z]+)", value: (?:"([^"\\]*)"|[^\r\n]*)\)""").findAll(body)
                .map { it.groupValues[1] to it.groups[2]?.value }.toList()
            decls[i].groupValues[1] to items
        }
    }

    private suspend fun queryItemsForSwiftFunc(swiftName: String): List<QueryItem> = when (swiftName) {
        "seoulWait" -> queryItems { it.seoulWait("123", "r", "en") }
        "seoulRide" -> queryItems { it.seoulRide("r", "b", "a", "en") }
        "resolveTagoStop" -> queryItems { it.resolveTagoStop(36.35, 127.38) }
        "tagoTrack" -> queryItems { it.tagoTrack("c", "n", "10", "en") }
        "subwayTrack" -> queryItems { it.subwayTrack("천호", "1005", "en") }
        else -> fail("Kotlin 미러에 없는 Swift 메서드: $swiftName")
    }

    @Test fun `메서드별 쿼리 이름·순서·고정 값은 Swift 원본과 같다`() = runTest {
        val swift = swiftQueryItems()
        assertEquals(setOf("seoulWait", "seoulRide", "resolveTagoStop", "tagoTrack", "subwayTrack"), swift.keys)
        for ((name, expected) in swift) {
            assertTrue(expected.isNotEmpty(), name) // 선언 모양이 바뀌어 대조가 공회전하는 것을 막는다
            val actual = queryItemsForSwiftFunc(name)
            assertEquals(expected.map { it.first }, actual.map { it.first }, name)
            for ((i, item) in expected.withIndex()) item.second?.let { assertEquals(it, actual[i].second, "$name.${item.first}") }
        }
    }

    /** `lang`은 추적 4메서드에만 — 정류소 해석은 표시 문장이 없어 싣지 않는다(Swift 주석). */
    @Test fun `추적 4메서드는 lang을 같은 이름으로 싣고 정류소 해석은 싣지 않는다`() = runTest {
        assertEquals("en", queryItems { it.seoulWait("123", "r", "en") }.toMap()["lang"])
        assertEquals("en", queryItems { it.subwayTrack("천호", "1005", "en") }.toMap()["lang"])
        assertEquals(null, queryItems { it.resolveTagoStop(36.35, 127.38) }.toMap()["lang"])
    }

    @Test fun `응답 상태를 폴 입력으로 접는다`() {
        assertEquals(TransitTrackPoll.Empty, TransitTrackService.poll(TransitTrackEnvelope("subway", "empty")))
        assertEquals(TransitTrackPoll.Ok(emptyList()), TransitTrackService.poll(TransitTrackEnvelope("subway", "ok")))
        assertEquals(TransitTrackPoll.Unsupported, TransitTrackService.poll(TransitTrackEnvelope("subway", "unsupported")))
    }
}
