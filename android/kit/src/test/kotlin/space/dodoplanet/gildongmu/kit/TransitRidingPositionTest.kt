package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** E35 승차 중 현재역 — Kit `TransitRidingPositionTests` 미러. 공유 fixture `transit-riding-position-cases.json` 전 케이스를 돈다. */
class TransitRidingPositionTest {
    @Serializable
    private data class FixtureLock(val mode: String, val routeId: String, val direction: String, val vehicleId: String)

    @Serializable
    private data class FixtureState(
        val legIndex: Int,
        val phase: String,
        val phaseGen: Int,
        val signal: String,
        val lock: FixtureLock? = null,
        val currentLocation: String? = null,
    )

    @Serializable
    private data class FixtureLeg(val trackMode: String? = null, val viaStops: List<String>? = null, val minutes: Int? = null)

    @Serializable
    private data class FixtureOutcome(val kind: String, val station: String? = null, val dataAgeSeconds: Int? = null, val lineEmpty: Boolean? = null)

    @Serializable
    private data class Case(
        val name: String,
        val fn: String,
        val state: FixtureState,
        val leg: FixtureLeg? = null,
        val position: TransitRidingPosition? = null,
        val requested: TransitPositionBinding? = null,
        val pending: TransitPositionBinding? = null,
        val outcome: FixtureOutcome? = null,
        val now: Double? = null,
        val overview: TransitOverview? = null,
        val expected: JsonElement? = null,
    )

    @Serializable
    private data class CaseFile(val leg: FixtureLeg, val cases: List<Case>)

    private fun makeLeg(base: FixtureLeg, override: FixtureLeg?): TransitGuideLeg {
        val trackMode = override?.trackMode ?: base.trackMode
        val names = override?.viaStops ?: base.viaStops ?: emptyList()
        return TransitGuideLeg(
            mode = if (trackMode == "subway") "subway" else "bus", lineName = "수도권 5호선",
            trackMode = trackMode?.let { tm -> TransitTrackMode.entries.firstOrNull { it.name == tm } },
            boardName = names.firstOrNull() ?: "", alightName = names.lastOrNull() ?: "",
            boardStop = null, alightStop = null,
            viaStops = names.map { TransitLegStop(name = it, lat = 37.5, lng = 127.0) },
            stationCount = null, routeId = null, wayCode = null, walkBeforeMinutes = null,
            minutes = override?.minutes ?: base.minutes,
        )
    }

    private fun makeState(s: FixtureState, route: TransitGuideRoute): TransitGuideState = initTransitGuide(route, 0.0).copy(
        legIndex = s.legIndex,
        phase = TransitPhase.entries.firstOrNull { it.name == s.phase } ?: fail("미지 phase ${s.phase}"),
        phaseGen = s.phaseGen,
        signal = TransitSignal.entries.firstOrNull { it.name == s.signal } ?: fail("미지 signal ${s.signal}"),
        lock = s.lock?.let { l ->
            TransitLock(
                mode = TransitTrackMode.entries.firstOrNull { it.name == l.mode } ?: fail("미지 mode ${l.mode}"),
                routeId = l.routeId, direction = l.direction, vehicleId = l.vehicleId,
            )
        },
        currentLocation = s.currentLocation,
    )

    private fun makeOutcome(o: FixtureOutcome): TransitPositionOutcome = when (o.kind) {
        "found" -> TransitPositionOutcome.Found(o.station ?: fail("station"), o.dataAgeSeconds)
        "notFound" -> TransitPositionOutcome.NotFound(o.lineEmpty ?: fail("lineEmpty"))
        "unsupported" -> TransitPositionOutcome.Unsupported
        "failed" -> TransitPositionOutcome.Failed
        else -> fail("미지 outcome ${o.kind}")
    }

    private fun JsonElement?.isNullExpected(): Boolean = this == null || this is JsonNull

    @Test fun `공유 fixture 전 케이스`() {
        val file = Fixtures.sharedJson("transit-riding-position-cases.json", CaseFile.serializer())
        assertTrue(file.cases.size >= 60)
        var ran = 0
        for (c in file.cases) {
            val leg = makeLeg(file.leg, c.leg)
            val state = makeState(c.state, TransitGuideRoute(legs = listOf(leg), walkAfterMinutes = null))
            val now = c.now ?: 0.0
            val exp = c.expected
            val expectedInt by lazy { if (exp.isNullExpected()) null else (exp as JsonPrimitive).int }
            when (c.fn) {
                "lookupDue" -> assertEquals((exp as JsonPrimitive).boolean, transitPositionLookupDue(state, leg, c.position), c.name)
                "step" -> {
                    val out = transitRidingPositionStep(
                        c.position, state, leg, c.requested ?: fail("requested"), makeOutcome(c.outcome ?: fail("outcome")), now,
                    )
                    val expected = if (exp.isNullExpected()) null else space.dodoplanet.gildongmu.kit.KitJson.decodeFromJsonElement(TransitRidingPosition.serializer(), exp!!)
                    assertEquals(expected, out, c.name)
                }
                "shown" -> assertEquals(expectedInt, transitPositionShownIndex(state, c.position, now), c.name)
                "viaHere" -> assertEquals(expectedInt, transitViaStopHereIndex(state, leg, c.position, now), c.name)
                "statusIndex" -> assertEquals(expectedInt, transitPositionStatusIndex(state, c.position, now), c.name)
                "overview" -> {
                    val out = transitOverviewApplyingPosition(c.overview ?: fail("overview"), state, c.position, now)
                    assertEquals(KitJson.decodeFromJsonElement(TransitOverview.serializer(), exp!!), out, c.name)
                }
                "neverSeenDeferred" -> {
                    val expected = if (exp.isNullExpected()) null else KitJson.decodeFromJsonElement(TransitPositionBinding.serializer(), exp!!)
                    assertEquals(expected, transitNeverSeenWarningDeferred(state, c.position, now), c.name)
                }
                "neverSeenPending" -> {
                    val verdict = transitNeverSeenPendingStep(c.pending ?: fail("pending"), state, c.position, now)
                    assertEquals((exp as JsonPrimitive).content, verdict.name, c.name)
                }
                else -> fail("unknown fn ${c.fn}")
            }
            ran++
        }
        assertEquals(file.cases.size, ran)
    }

    private fun env(json: String) = KitJson.decodeFromString(TransitPositionEnvelope.serializer(), json)

    @Test fun `조회 봉투 소비 형태`() {
        fun o(json: String) = TransitPositionService.outcome(env(json))
        assertEquals(
            TransitPositionOutcome.Found("길동", 40),
            o("""{"status":"found","station":"길동","trainStatus":"3","dataStamp":"2026-09-23 14:49:20","dataAgeSeconds":40}"""),
        )
        assertEquals(TransitPositionOutcome.Found("길동", null), o("""{"status":"found","station":"길동","dataAgeSeconds":null}"""))
        assertEquals(TransitPositionOutcome.Failed, o("""{"status":"found","station":""}"""))
        assertEquals(TransitPositionOutcome.NotFound(false), o("""{"status":"notFound","total":33}"""))
        assertEquals(TransitPositionOutcome.NotFound(true), o("""{"status":"notFound","total":0}"""))
        assertEquals(TransitPositionOutcome.Unsupported, o("""{"status":"unsupported"}"""))
        assertEquals(TransitPositionOutcome.Failed, o("""{"status":"weird"}"""))
        // 비-200 분류(설계 리뷰 m4, 웹 positionOutcomeFromHttpStatus 미러).
        assertEquals(TransitPositionOutcome.Failed, TransitPositionService.outcome(APIError.BadStatus(429, null)))
        assertEquals(TransitPositionOutcome.Failed, TransitPositionService.outcome(APIError.BadStatus(502, null)))
        assertEquals(TransitPositionOutcome.Unsupported, TransitPositionService.outcome(APIError.BadStatus(400, null)))
        assertEquals(TransitPositionOutcome.Failed, TransitPositionService.outcome(APIError.Network(java.io.IOException("timeout"))))
    }

    @Test fun `조회 요청은 경로와 쿼리와 8초 예산을 싣는다`() = runTest {
        var seenUrl = ""
        var budget: Long? = null
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                budget = timeoutMs
                seenUrl = url
                return HttpResponse(200, """{"status":"unsupported"}""")
            }
        }
        val envelope = TransitPositionService(APIClient("https://example.test", transport)).lookup("수도권 5호선", "5105")
        assertEquals("unsupported", envelope.status)
        assertEquals("/api/transit/position", pathOf(seenUrl))
        assertEquals(listOf("line" to "수도권 5호선", "train" to "5105"), queryItemsOf(seenUrl))
        assertEquals(8000L, budget)
    }

    /** 유휴 정지(E48 잔여 ⑥): 추적 중이 아닌 riding에서만 래치를 만료시키고 결박·조회 수는 남긴다. */
    @Test fun `유휴 정지는 추적 중이 아닌 riding의 래치만 만료`() {
        val leg = makeLeg(FixtureLeg("subway", listOf("천호", "강동", "길동", "굽은다리"), 10), null)
        var state = initTransitGuide(TransitGuideRoute(legs = listOf(leg), walkAfterMinutes = null), 0.0).copy(
            phase = TransitPhase.riding,
            lock = TransitLock(TransitTrackMode.subway, "1005", "하행", "5123"),
        )
        val position = TransitRidingPosition.of(TransitPositionBinding(0, state.phaseGen, "5123"))
            .copy(stopIndex = 2, lastFoundAt = 1_000.0, lookups = 4, behind = 1)

        state = state.copy(signal = TransitSignal.notYetVisible)
        val expired = transitRidingPositionOnIdlePause(position, state) ?: fail("만료 결과가 없다")
        assertTrue(expired.stopIndex == null && expired.lastFoundAt == null && expired.behind == 0)
        assertTrue(expired.lookups == 4 && expired.binding == position.binding)
        // 만료 뒤에는 시계가 창 안이어도 표식이 없다.
        assertNull(transitPositionShownIndex(state, expired, 1_001.0))

        for (signal in listOf(TransitSignal.neverSeen, TransitSignal.signalLost, TransitSignal.upstreamFailed)) {
            assertNull(transitRidingPositionOnIdlePause(position, state.copy(signal = signal))?.stopIndex, "$signal")
        }

        state = state.copy(signal = TransitSignal.tracking)
        assertEquals(position, transitRidingPositionOnIdlePause(position, state))
        assertNull(transitRidingPositionOnIdlePause(null, state))
        assertEquals(position, transitRidingPositionOnIdlePause(position, null))
    }
}
