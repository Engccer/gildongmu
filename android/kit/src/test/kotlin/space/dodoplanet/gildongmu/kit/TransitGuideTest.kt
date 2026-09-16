package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.QuickExitDoor
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import java.util.regex.Pattern
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 대중교통 상태 머신 — Kit `TransitGuideTests` 미러. 웹 정본과 같은 공유 fixture(`transit-guide-scenarios.json`·
 * `subway-riding-message-cases.json`)를 읽어 같은 전이·이벤트를 단언한다.
 */
class TransitGuideTest {
    @Serializable
    private data class FixtureFile(
        val routes: Map<String, TransitGuideRoute>,
        /** A25 승차 전 도보 판정 기대값(routes 이름 → 대상 | null). */
        val prewalk: Map<String, TransitPrewalkTarget?>,
        val locks: Map<String, TransitLock>,
        val scenarios: List<Scenario>,
    ) {
        @Serializable
        data class Scenario(val name: String, val route: String, val steps: List<Step>)

        /** `expect`는 "명시 null"과 "미지정"을 갈라야 해서 JSON 객체 그대로 받는다(Swift `T??` 대응). */
        @Serializable
        data class Step(val at: Double, val input: Input, val expect: JsonObject)

        @Serializable
        data class Input(val kind: String, val lock: String? = null, val seq: Int? = null, val phaseGen: Int? = null, val poll: Poll? = null)

        @Serializable
        data class Poll(val kind: String, val items: List<TransitTrackItem>? = null)
    }

    private val fixture by lazy { Fixtures.sharedJson("transit-guide-scenarios.json", FixtureFile.serializer()) }

    private fun route(name: String) = fixture.routes[name] ?: fail("route 미정의: $name")
    private fun lock(name: String) = fixture.locks[name] ?: fail("lock 미정의: $name")

    private fun toInput(raw: FixtureFile.Input): TransitGuideInput = when (raw.kind) {
        "board" -> TransitGuideInput.Board(lock(raw.lock ?: fail("board에 lock 없음")))
        "boardAboard" -> TransitGuideInput.BoardAboard(lock(raw.lock ?: fail("boardAboard에 lock 없음")))
        "declareArrived" -> TransitGuideInput.DeclareArrived
        "confirmBoarded" -> TransitGuideInput.ConfirmBoarded
        "restoreBoarding" -> TransitGuideInput.RestoreBoarding
        "changeBoarding" -> TransitGuideInput.ChangeBoarding
        "advance" -> TransitGuideInput.Advance
        "poll" -> {
            val poll = raw.poll ?: fail("poll 입력에 poll 없음")
            TransitGuideInput.Poll(
                raw.seq ?: fail("poll 입력에 seq 없음"),
                raw.phaseGen ?: fail("poll 입력에 phaseGen 없음"),
                when (poll.kind) {
                    "ok" -> TransitTrackPoll.Ok(poll.items ?: emptyList())
                    "empty" -> TransitTrackPoll.Empty
                    "unsupported" -> TransitTrackPoll.Unsupported
                    "failed" -> TransitTrackPoll.Failed
                    else -> fail("미지 poll ${poll.kind}")
                },
            )
        }
        else -> fail("미지 입력 ${raw.kind}")
    }

    // JSON 값 읽기: 키가 없으면 "미지정"(검사 안 함), JsonNull이면 "명시 null".
    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
    private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

    @Test fun `공유 시나리오 표`() {
        assertTrue(fixture.scenarios.size >= 40) // 공회전 방지
        for (scenario in fixture.scenarios) {
            val route = route(scenario.route)
            var state = initTransitGuide(route, 0.0)
            for ((i, step) in scenario.steps.withIndex()) {
                val result = transitGuideStep(state, toInput(step.input), route, step.at)
                state = result.state
                val ctx = "${scenario.name} step $i"
                val ex = step.expect
                ex.str("phase")?.let { assertEquals(it, state.phase.rawValue, "$ctx phase") }
                ex.str("signal")?.let { assertEquals(it, state.signal.rawValue, "$ctx signal") }
                ex.int("legIndex")?.let { assertEquals(it, state.legIndex, "$ctx legIndex") }
                if ("remaining" in ex) assertEquals(ex.int("remaining"), state.remaining, "$ctx remaining")
                if ("dataAgeSeconds" in ex) assertEquals(ex.int("dataAgeSeconds"), state.dataAgeSeconds, "$ctx dataAgeSeconds")
                ex.int("ridingPolls")?.let { assertEquals(it, state.ridingPolls, "$ctx ridingPolls") }
                if ("previousLock" in ex) {
                    val expected = ex.str("previousLock")?.let { lock(it) }
                    assertEquals(expected, state.previousLock, "$ctx previousLock")
                }
                if ("event" in ex) {
                    val evJson = ex["event"]
                    if (evJson is JsonNull) {
                        assertNull(result.event, "$ctx event null")
                    } else {
                        val e = evJson as? JsonObject ?: fail("$ctx event 형식")
                        assertEquals(e.str("kind"), transitEventKind(result.event), "$ctx event.kind")
                        assertEventFields(ctx, e, result.event)
                    }
                }
            }
        }
    }

    private fun assertEventFields(ctx: String, e: JsonObject, event: TransitGuideEvent?) {
        when (event) {
            is TransitGuideEvent.Boarded -> {
                e.int("legIndex")?.let { assertEquals(it, event.legIndex, "$ctx event.legIndex") }
                e.str("cause")?.let { assertEquals(it, event.cause.rawValue, "$ctx event.cause") }
            }
            is TransitGuideEvent.VehicleSelected -> e.int("legIndex")?.let { assertEquals(it, event.legIndex, "$ctx event.legIndex") }
            is TransitGuideEvent.Approaching -> {
                if ("remaining" in e) assertEquals(e.int("remaining"), event.remaining, "$ctx event.remaining")
                if ("messageEn" in e) assertEquals(e.str("messageEn"), event.messageEn, "$ctx event.messageEn")
            }
            is TransitGuideEvent.Countdown -> {
                e.int("remaining")?.let { assertEquals(it, event.remaining, "$ctx event.remaining") }
                if ("currentLocation" in e) assertEquals(e.str("currentLocation"), event.currentLocation, "$ctx event.currentLocation")
                if ("messageEn" in e) assertEquals(e.str("messageEn"), event.messageEn, "$ctx event.messageEn")
                if ("currentLocationEn" in e) assertEquals(e.str("currentLocationEn"), event.currentLocationEn, "$ctx event.currentLocationEn")
            }
            is TransitGuideEvent.TrackingStarted -> {
                e.int("remaining")?.let { assertEquals(it, event.remaining, "$ctx event.remaining") }
                if ("messageEn" in e) assertEquals(e.str("messageEn"), event.messageEn, "$ctx event.messageEn")
            }
            is TransitGuideEvent.Arrived -> e.bool("certain")?.let { assertEquals(it, event.certain, "$ctx event.certain") }
            is TransitGuideEvent.LegAdvanced -> {
                e.int("legIndex")?.let { assertEquals(it, event.legIndex, "$ctx event.legIndex") }
                e.bool("final")?.let { assertEquals(it, event.final, "$ctx event.final") }
            }
            else -> Unit
        }
    }

    // === fixture 밖 단위 검증(웹 unit 테스트 미러) ===

    private fun step(state: TransitGuideState, input: TransitGuideInput, route: TransitGuideRoute, now: Double) =
        transitGuideStep(state, input, route, now)

    private fun poll(seq: Int, phaseGen: Int, poll: TransitTrackPoll) = TransitGuideInput.Poll(seq, phaseGen, poll)

    /** A41 웹 미러: riding 첫 조회 15초 → 미등장 60초(M2), 서울버스 0을 본 뒤 추정 도착은 60초·signalLost 없음(M1). */
    @Test fun `A41 서울버스 폴 주기와 조용한 추정 도착`() {
        val route = route("seoulBusSingle")
        val lock = lock("seoulBusV1")
        fun bus(remaining: Int, message: String) = TransitTrackItem(
            vehicleId = lock.vehicleId, direction = "", message = message, remainingStops = remaining,
            destinationName = null, express = false, arrivalCode = null,
        )
        var state = initTransitGuide(route, 0.0)
        state = step(state, TransitGuideInput.Board(lock), route, 0.0).state
        state = step(state, TransitGuideInput.ConfirmBoarded, route, 0.0).state
        assertEquals(15_000, transitPollIntervalMs(state))
        state = step(state, poll(1, 2, TransitTrackPoll.Empty), route, 1.0).state
        assertEquals(1, state.ridingPolls)
        assertEquals(60_000, transitPollIntervalMs(state))
        state = step(state, poll(2, 2, TransitTrackPoll.Ok(listOf(bus(0, "곧 도착")))), route, 2.0).state
        assertEquals(15_000, transitPollIntervalMs(state))
        state = step(state, poll(3, 2, TransitTrackPoll.Ok(emptyList())), route, 3.0).state
        val r = step(state, poll(4, 2, TransitTrackPoll.Ok(emptyList())), route, 4.0)
        assertEquals(TransitGuideEvent.Arrived(certain = false), r.event)
        assertEquals(60_000, transitPollIntervalMs(r.state))
        var s = r.state
        for (seq in 5..8) {
            val next = step(s, poll(seq, 2, TransitTrackPoll.Ok(emptyList())), route, seq.toDouble())
            assertNull(next.event, "seq $seq")
            assertEquals(TransitSignal.tracking, next.state.signal, "seq $seq")
            s = next.state
        }
        // 경계: 0을 **못 본**(잔여 1 소실) 추정 도착은 종전대로 15초 폴 + signalLost 경고(한정자 `ladderAnnounced == 0`).
        var g = initTransitGuide(route, 0.0)
        g = step(g, TransitGuideInput.Board(lock), route, 0.0).state
        g = step(g, TransitGuideInput.ConfirmBoarded, route, 0.0).state
        g = step(g, poll(1, 2, TransitTrackPoll.Ok(listOf(bus(1, "3분후[1번째 전]")))), route, 1.0).state
        g = step(g, poll(2, 2, TransitTrackPoll.Ok(emptyList())), route, 2.0).state
        val guess = step(g, poll(3, 2, TransitTrackPoll.Ok(emptyList())), route, 3.0)
        assertEquals(TransitGuideEvent.Arrived(certain = false), guess.event)
        assertEquals(15_000, transitPollIntervalMs(guess.state))
        assertEquals(TransitGuideEvent.SignalLost, step(guess.state, poll(4, 2, TransitTrackPoll.Ok(emptyList())), route, 4.0).event)
    }

    @Test fun `적응형 폴 주기`() {
        val route = route("subwaySingle")
        val lock = lock("subway5696")
        var state = initTransitGuide(route, 0.0)
        assertEquals(20_000, transitPollIntervalMs(state))
        state = step(state, TransitGuideInput.Board(lock), route, 0.0).state
        // boarding(차량 선택 뒤 승차 정류소 대기)은 waiting과 같은 엔드포인트라 같은 주기.
        assertEquals(20_000, transitPollIntervalMs(state))
        state = step(state, TransitGuideInput.ConfirmBoarded, route, 0.0).state
        // A41 M2: riding 첫 조회 한 번만 15초(ridingPolls 0).
        assertEquals(15_000, transitPollIntervalMs(state))
        fun item(message: String, remaining: Int, code: String) = TransitTrackItem(
            vehicleId = "5696", direction = "하행", message = message, remainingStops = remaining,
            destinationName = "하남검단산", express = false, arrivalCode = code,
        )
        state = step(state, poll(1, 2, TransitTrackPoll.Ok(listOf(item("[9]번째 전역", 9, "99")))), route, 1.0).state
        // §12 개정: 추적 중이면 원거리도 15초(원거리 30초 폐지).
        assertEquals(15_000, transitPollIntervalMs(state))
        state = step(state, poll(2, 2, TransitTrackPoll.Ok(listOf(item("[3]번째 전역", 3, "99")))), route, 2.0).state
        assertEquals(15_000, transitPollIntervalMs(state))
        // advance는 arrived에서만 유효(리듀서 가드) — 도착 관측 후 전환.
        state = step(state, poll(3, 2, TransitTrackPoll.Ok(listOf(item("여의도 도착", 0, "1")))), route, 3.0).state
        state = step(state, TransitGuideInput.Advance, route, 4.0).state
        assertEquals(TransitPhase.done, state.phase)
        assertEquals(0, transitPollIntervalMs(state))
        assertEquals(0, transitPollIntervalMs(initTransitGuide(route("untrackableSubway"), 0.0)))
    }

    /** A37 ②·A34 ①: 확정 도착(선언)·비관측 잠금 riding은 폴 없음, 지방버스 근사는 종전. */
    @Test fun `확정 도착과 비관측 잠금은 폴 주기 0`() {
        val route = route("subwaySingle")
        var state = step(initTransitGuide(route, 0.0), TransitGuideInput.BoardAboard(lock("subway5696")), route, 0.0).state
        assertEquals(TransitPhase.riding, state.phase)
        assertEquals(15_000, transitPollIntervalMs(state)) // riding 첫 조회(A41 M2), 그 뒤 미등장 60초
        state = step(state, TransitGuideInput.DeclareArrived, route, 1.0).state
        assertTrue(state.phase == TransitPhase.arrived && state.arrivedCertain)
        assertEquals(0, transitPollIntervalMs(state))
        val unobserved = step(initTransitGuide(route, 0.0), TransitGuideInput.Board(lock("subwayApproxDown")), route, 0.0).state
        assertEquals(TransitPhase.riding, unobserved.phase)
        assertEquals(0, transitPollIntervalMs(unobserved))
        val tago = route("tagoBusSingle")
        val tagoState = step(initTransitGuide(tago, 0.0), TransitGuideInput.Board(lock("tagoApprox")), tago, 0.0).state
        assertEquals(15_000, transitPollIntervalMs(tagoState))
    }

    @Test fun `비관측 잠금 판별과 이미 탑승 후보 필터`() {
        assertTrue(transitLockIsUnobserved(lock("subwayApproxDown")))
        assertTrue(transitLockIsUnobserved(TransitLock(mode = TransitTrackMode.seoulBus, routeId = "1", direction = "", vehicleId = "")))
        assertFalse(transitLockIsUnobserved(lock("tagoApprox")))
        assertFalse(transitLockIsUnobserved(lock("subway5696")))
        val codes = listOf("0", "1", "2", "3", "4", "5", "99", null)
        val items = codes.mapIndexed { i, code ->
            TransitTrackItem(vehicleId = "v$i", direction = "하행", message = "", remainingStops = null, destinationName = null, express = false, arrivalCode = code)
        }
        assertEquals(listOf("0", "1", "2", "3", "4", "5"), transitAboardCandidates(items).map { it.arrivalCode })
    }

    /** N3 ①: boarding 국면의 수동 진행 수단은 "관측이 끝났다"에만 선다. 웹 `boardingObservationLost` 미러. */
    @Test fun `boarding 관측 종료 진리표`() {
        assertTrue(transitBoardingObservationLost(TransitSignal.signalLost))
        assertTrue(transitBoardingObservationLost(TransitSignal.upstreamFailed))
        assertFalse(transitBoardingObservationLost(TransitSignal.tracking))
        assertFalse(transitBoardingObservationLost(TransitSignal.notYetVisible))
        // neverSeen은 riding 전용 축이라 이 국면에 오지 않는다 — 그래도 참으로 새지 않게 못 박는다.
        assertFalse(transitBoardingObservationLost(TransitSignal.neverSeen))
        // untrackable은 국면보다 앞선 분기(수동 전진 버튼이 따로 있다).
        assertFalse(transitBoardingObservationLost(TransitSignal.untrackable))
    }

    @Test fun `세션 폴 상한은 한 번만 알린다`() {
        val route = route("subwaySingle")
        var state = initTransitGuide(route, 0.0)
        state = step(state, TransitGuideInput.Board(lock("subway5696")), route, 0.0).state
        state = step(state, TransitGuideInput.ConfirmBoarded, route, 0.0).state
        var capEvents = 0
        for (i in 1..(transitSessionPollCap + 5)) {
            val r = step(state, poll(i, 2, TransitTrackPoll.Empty), route, i * 1000.0)
            state = r.state
            if (r.event == TransitGuideEvent.CapSlowed) capEvents += 1
        }
        assertEquals(1, capEvents)
        assertEquals(60_000, transitPollIntervalMs(state))
    }

    @Test fun `이벤트 통지 채널`() {
        fun countdown(remaining: Int) = TransitGuideEvent.Countdown(remaining, "", null, null, null, null)
        assertTrue(transitEventProfile(countdown(1)).interrupt)
        assertFalse(transitEventProfile(countdown(2)).interrupt)
        assertTrue(transitEventProfile(TransitGuideEvent.Arrived(certain = true)).interrupt)
        assertFalse(transitEventProfile(TransitGuideEvent.SignalLost).interrupt)
        // A41: 곧 도착 이벤트 2종은 imminent·interrupt, boarded(departed)는 비-interrupt·start.
        assertEquals(TransitEventProfile(true, TransitGuideTone.imminent), transitEventProfile(TransitGuideEvent.ArrivingAtBoardStop))
        assertEquals(TransitEventProfile(true, TransitGuideTone.imminent), transitEventProfile(TransitGuideEvent.ArrivingAtAlightStop))
        assertEquals(TransitEventProfile(false, TransitGuideTone.start), transitEventProfile(TransitGuideEvent.Boarded(0, TransitBoardedCause.departed)))
        assertTrue(transitEventProfile(TransitGuideEvent.Boarded(0, TransitBoardedCause.observed)).interrupt)
        // 여정 완료(final)는 도착 종, 중간 구간 전진은 시작 톤(E30 소리 결함 정정).
        assertEquals(TransitEventProfile(false, TransitGuideTone.arrive), transitEventProfile(TransitGuideEvent.LegAdvanced(1, final = true)))
        assertEquals(TransitEventProfile(false, TransitGuideTone.start), transitEventProfile(TransitGuideEvent.LegAdvanced(1, final = false)))
    }

    /** 공백 클래스는 ICU 약칭 공백과 같은 뜻이다(NBSP·전각 공백 포함) — 명시 클래스로 바꾸며 좁히면 Swift와 갈린다. */
    @Test fun `NBSP·전각 공백도 공백이다`() {
        assertEquals("서울", normalizeStopName("서울역\u00A0(1호선)"))
        assertEquals("1075", subwayIdForOdsayLine("수도권 수인\u3000분당선"))
        assertEquals("1009", subwayIdForOdsayLine("수도권 9호선(급행)\u00A0"))
    }

    @Test fun `ODsay 노선 매핑`() {
        assertEquals("1005", subwayIdForOdsayLine("수도권 5호선"))
        assertEquals("1075", subwayIdForOdsayLine("수도권 수인.분당선"))
        assertEquals("1077", subwayIdForOdsayLine("신분당선"))
        assertNull(subwayIdForOdsayLine("대전 1호선"))
        // 급행 lane 접미 — 벗기지 않으면 급행 leg가 통째로 추적 불가.
        assertEquals("1009", subwayIdForOdsayLine("수도권 9호선(급행)"))
        // ⚠ 1호선 형태는 우리 함수의 동작 단언이지 ODsay 관측이 아니다.
        assertEquals("1001", subwayIdForOdsayLine("수도권 1호선(급행)"))
        // 그 밖의 괄호 등급은 삼키지 않는다(직통은 실시간 도착 축이 없다).
        assertNull(subwayIdForOdsayLine("수도권 공항철도(직통)"))
        // 앵커 계약: 끝에 붙은 한 토큰만 벗긴다.
        assertNull(subwayIdForOdsayLine("수도권 (급행)9호선"))
    }

    private fun walkLeg(minutes: Int) = TransitRouteLeg(mode = "walk", minutes = minutes)

    @Test fun `경로 조립은 도보를 대기 문맥으로 흡수한다`() {
        val route = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
            legs = listOf(
                walkLeg(3),
                TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 20, serviceWayCode = 2),
                walkLeg(5),
            ),
            routeKey = "p0",
        )
        val guide = buildTransitGuideRoute(route)
        assertEquals(1, guide?.legs?.size)
        assertEquals(3, guide?.legs?.first()?.walkBeforeMinutes)
        assertEquals(TransitTrackMode.subway, guide?.legs?.first()?.trackMode)
        assertEquals(5, guide?.walkAfterMinutes)

        val walkOnly = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 10, fare = 0, transfers = 0, walkMinutes = 10),
            legs = listOf(walkLeg(10)),
            routeKey = "p0",
        )
        assertNull(buildTransitGuideRoute(walkOnly))
    }

    /** Kit `QuickExitGuideRouteTests` 미러 — 브리핑 leg의 빠른 하차 값이 세션 leg로 그대로 옮겨진다. */
    private fun quickExitRoute(quickExit: QuickExit?) = TransitRoute(
        summary = TransitRouteSummary(totalMinutes = 30, fare = 1550, transfers = 0, walkMinutes = 6),
        legs = listOf(
            TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 24, quickExit = quickExit),
        ),
        routeKey = "p0",
    )

    @Test fun `빠른 하차는 세션 leg로 옮겨진다`() {
        val value = QuickExit(elevator = QuickExitDoor(kind = "door", doors = listOf("6-4")))
        assertEquals(value, buildTransitGuideRoute(quickExitRoute(value))?.legs?.first()?.quickExit)
    }

    @Test fun `빠른 하차 값이 없으면 세션 leg도 null`() {
        val guide = buildTransitGuideRoute(quickExitRoute(null))
        assertEquals(1, guide?.legs?.size) // 조립 실패(null)로 공허하게 통과하지 않게
        assertNull(guide?.legs?.first()?.quickExit)
    }

    /**
     * 급행 leg도 추적 대상이고 경유역은 급행 정차역 그대로다. 종전에는 lineName의 "(급행)" 접미 때문에 trackMode가 null이라
     * 급행 경로의 실시간 안내가 통째로 열리지 않았다(A16 선행 결함).
     */
    @Test fun `급행 leg도 추적 가능하게 조립한다`() {
        val stops = listOf("김포공항", "마곡나루", "가양", "염창", "당산", "여의도", "노량진", "동작", "고속터미널")
            .mapIndexed { i, name -> TransitLegStop(name = name, stationId = (900 + i).toString(), lat = 37.5, lng = 126.9) }
        val route = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 40, fare = 1950, transfers = 0, walkMinutes = 4, departName = "김포공항", arriveName = "고속터미널"),
            legs = listOf(
                TransitRouteLeg(
                    mode = "subway", lineName = "수도권 9호선(급행)", fromName = "김포공항", toName = "고속터미널",
                    stationCount = 8, minutes = 27, serviceWayCode = 1, stops = stops,
                ),
            ),
            routeKey = "p-exp",
        )
        val leg = buildTransitGuideRoute(route)?.legs?.first() ?: fail("조립 실패")
        assertEquals(TransitTrackMode.subway, leg.trackMode)
        // 표시명은 급행 표기를 유지한다(정규화는 매핑 축에만 걸린다).
        assertEquals("수도권 9호선(급행)", leg.lineName)
        assertEquals(9, leg.viaStops.size)
        assertFalse(leg.viaStops.any { it.name == "샛강" })
    }

    private fun stop(name: String, lat: Double = 37.5, lng: Double = 127.0, stationId: String? = null) =
        TransitLegStop(name = name, stationId = stationId, lat = lat, lng = lng)

    private fun subwayLeg(
        board: String,
        alight: String,
        via: List<TransitLegStop>,
        wayCode: Int? = 2,
        lineName: String = "수도권 5호선",
        boardStop: TransitLegStop? = stop(board),
        alightStop: TransitLegStop? = stop(alight),
        expressStops: List<String>? = null,
        expressStopIds: List<String>? = null,
    ) = TransitGuideLeg(
        mode = "subway", lineName = lineName, trackMode = TransitTrackMode.subway,
        boardName = board, alightName = alight, boardStop = boardStop, alightStop = alightStop,
        viaStops = via, stationCount = via.size - 1, routeId = null, wayCode = wayCode, walkBeforeMinutes = null,
        expressStops = expressStops, expressStopIds = expressStopIds,
    )

    private fun item(direction: String, vid: String, dest: String? = null, express: Boolean = false, remaining: Int = 5) = TransitTrackItem(
        vehicleId = vid, direction = direction, message = "m", remainingStops = remaining,
        destinationName = dest, express = express, arrivalCode = null,
    )

    @Test fun `승차 후보 분류`() {
        val leg = subwayLeg("천호", "여의도", listOf(stop("천호"), stop("왕십리(성동구청)"), stop("여의도"), stop("화곡")))

        assertTrue(transitTerminatesBeforeAlight("왕십리", leg))
        assertFalse(transitTerminatesBeforeAlight("화곡", leg))
        assertFalse(transitTerminatesBeforeAlight("여의도", leg))
        assertFalse(transitTerminatesBeforeAlight("미지의역", leg))

        val matched = classifyTransitBoardingCandidates(listOf(item("상행", "1"), item("하행", "2")), leg)
        assertFalse(matched.directionUncertain)
        assertEquals(listOf("2"), matched.candidates.map { it.item.vehicleId })

        val uncertain = classifyTransitBoardingCandidates(listOf(item("알수없음", "3")), leg)
        assertTrue(uncertain.directionUncertain)
        assertEquals(1, uncertain.candidates.size)

        // A17: 후보 전원 direction 빈 문자열(버스)은 방향 축 부재 — uncertain 아님.
        val bus = classifyTransitBoardingCandidates(listOf(item("", "b1"), item("", "b2")), leg)
        assertFalse(bus.directionUncertain)
        assertEquals(listOf("b1", "b2"), bus.candidates.map { it.item.vehicleId })
        assertFalse(classifyTransitBoardingCandidates(emptyList(), leg).directionUncertain)
        // 방향 값이 하나라도 있는데 전멸이면 여전히 uncertain.
        val mixed = classifyTransitBoardingCandidates(listOf(item("", "1"), item("알수없음", "2")), leg)
        assertTrue(mixed.directionUncertain)
        assertEquals(2, mixed.candidates.size)

        val decorated = classifyTransitBoardingCandidates(listOf(item("하행", "5", express = true), item("하행", "6", dest = "왕십리")), leg)
        // 집합 부재 → 판정 불가(unknown): 차단하지 않는다.
        assertEquals(TransitExpressVerdict.unknown, decorated.candidates[0].express)
        assertNull(decorated.candidates[0].unreachable)
        assertNull(decorated.candidates[1].express)
        assertEquals(TransitUnreachableReason.terminatesEarly, decorated.candidates[1].unreachable)
    }

    /** 웹 "급행 결정적 미도달 게이트(A16 L1)"와 동일 케이스. spec 2026-09-02 §4.2. */
    @Test fun `급행 판정 게이트`() {
        val names = listOf("김포공항", "당산", "노량진", "노들", "동작")
        val ids = listOf("901", "902", "903", "904", "905")
        fun stops(withIds: Boolean) = names.zip(ids).map { (n, id) -> stop(n, 37.5, 127.0, if (withIds) id else null) }
        fun leg(expressStops: List<String>? = null, expressStopIds: List<String>? = null, withIds: Boolean = true, alightName: String = "노들") =
            subwayLeg(
                "김포공항", alightName, stops(withIds), lineName = "수도권 9호선",
                boardStop = stops(withIds).first(), alightStop = stop("노들", 37.5, 127.0, if (withIds) "904" else null),
                expressStops = expressStops, expressStopIds = expressStopIds,
            )
        val express = TransitTrackItem(vehicleId = "9", direction = "하행", message = "m", remainingStops = 3, destinationName = "중앙보훈병원", express = true, arrivalCode = null)

        // ID 판정
        val skip = leg(listOf("김포공항", "당산", "동작"), listOf("901", "902", "905"))
        assertEquals(TransitExpressVerdict.skips, transitExpressVerdict(express, skip))
        assertEquals(TransitUnreachableReason.expressSkipsAlight, transitUnreachableReason(express, skip))
        assertEquals(TransitUnreachableReason.expressSkipsAlight, classifyTransitBoardingCandidates(listOf(express), skip).candidates[0].unreachable)
        val stopLeg = leg(listOf("김포공항", "당산", "노들"), listOf("901", "902", "904"))
        assertEquals(TransitExpressVerdict.stops, transitExpressVerdict(express, stopLeg))
        assertNull(transitUnreachableReason(express, stopLeg))
        // ID는 이름 별칭을 무시한다
        assertEquals(TransitExpressVerdict.stops, transitExpressVerdict(express, leg(listOf("김포공항역", "당산역", "노들역"), listOf("901", "902", "904"))))
        // 이름 판정(ID 부재): 자격 ⓐⓑ
        assertEquals(TransitExpressVerdict.skips, transitExpressVerdict(express, leg(listOf("김포공항", "당산", "동작"), withIds = false)))
        assertEquals(TransitExpressVerdict.stops, transitExpressVerdict(express, leg(listOf("김포공항역", "노들역"), withIds = false)))
        assertEquals(TransitExpressVerdict.unknown, transitExpressVerdict(express, leg(listOf("여의도", "신논현"), withIds = false)))
        assertEquals(TransitExpressVerdict.unknown, transitExpressVerdict(express, leg(listOf("김포공항", "당산"), withIds = false, alightName = "미지역")))
        // 집합 부재·빈 집합은 unknown, 완행은 null, 종착 앞이면 종착이 먼저
        assertEquals(TransitExpressVerdict.unknown, transitExpressVerdict(express, leg()))
        assertEquals(TransitExpressVerdict.unknown, transitExpressVerdict(express, leg(emptyList(), emptyList())))
        val local = TransitTrackItem(vehicleId = "1", direction = "하행", message = "m", remainingStops = 3, destinationName = null, express = false, arrivalCode = null)
        assertNull(transitExpressVerdict(local, leg()))
        val early = TransitTrackItem(vehicleId = "8", direction = "하행", message = "m", remainingStops = 3, destinationName = "당산", express = true, arrivalCode = null)
        assertEquals(TransitUnreachableReason.terminatesEarly, transitUnreachableReason(early, leg(listOf("김포공항"), listOf("901"))))
        // 근사 잠금 급행 확인(§6): 집합 있는 노선만 묻고, 선언 판정은 후보 없이 leg만으로
        assertFalse(transitNeedsExpressPrompt(leg()))
        assertTrue(transitNeedsExpressPrompt(skip))
        assertEquals(TransitExpressVerdict.skips, transitDeclaredExpressVerdict(skip))
        assertEquals(TransitExpressVerdict.stops, transitDeclaredExpressVerdict(stopLeg))
        assertEquals(TransitExpressVerdict.unknown, transitDeclaredExpressVerdict(leg()))
    }

    @Test fun `출구 번호 형식 게이트`() {
        assertEquals("2-1", transitValidExitNo(" 2-1 "))
        assertNull(transitValidExitNo("1 2"))
        assertNull(transitValidExitNo("3번 출구"))
        assertNull(transitValidExitNo(null))
        assertNull(transitValidExitNo("１２")) // 전각 숫자는 JS(ASCII 숫자 클래스)처럼 거른다
        // 안드로이드 런타임 정규식(ICU)은 약칭 숫자 클래스가 유니코드 숫자다 — JVM에서 그 의미로 다시 컴파일해 `[0-9]`가
        // 약칭 클래스로 "정리"되는 회귀를 잡는다(JVM 기본 약칭 클래스는 ASCII라 위 단언만으로는 못 잡는다).
        assertFalse(Pattern.compile(VALID_EXIT_NO.pattern, Pattern.UNICODE_CHARACTER_CLASS).matcher("１２").matches())
    }

    /** 웹 "순환선 2호선(내선·외선)"과 동일 케이스. 실호출 확정 2026-08-16 — 내선=wayCode 2·외선=1, 종착 상수 "성수"는 차단 근거 아님. */
    @Test fun `순환선 승차 후보`() {
        val names = listOf(
            "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당",
            "상왕십리", "왕십리", "한양대", "뚝섬", "성수",
            "건대입구", "구의", "강변", "잠실나루", "잠실",
        )
        val leg = subwayLeg(
            "을지로입구", "잠실", names.map { stop(it) }, lineName = "수도권 2호선",
            boardStop = stop("을지로입구", 37.565998, 126.982569), alightStop = stop("잠실", 37.51395, 127.100138),
        )
        fun loopItem(direction: String, vid: String) = item(direction, vid, dest = "성수")
        val result = classifyTransitBoardingCandidates(listOf(loopItem("내선", "3"), loopItem("외선", "4")), leg)
        assertFalse(result.directionUncertain)
        assertEquals(listOf("3"), result.candidates.map { it.item.vehicleId })
        // 순수 판정 자체는 여전히 "앞선 종착"이라 답한다 — 순환선 제외는 분류기 몫.
        assertTrue(transitTerminatesBeforeAlight("성수", leg))
        assertNull(result.candidates[0].unreachable)

        // 지선(성수·신정)도 내선/외선을 쓴다. 종착은 지선 라벨이거나 그 지선의 종점이라 어느 쪽도 하차역보다 앞설 수 없다.
        val branch = subwayLeg(
            "용답", "신설동", listOf("용답", "신답", "용두", "신설동").map { stop(it, 37.56, 127.04) }, lineName = "수도권 2호선",
            boardStop = stop("용답", 37.562066, 127.050879), alightStop = stop("신설동", 37.574653, 127.025158),
        )
        val branchResult = classifyTransitBoardingCandidates(
            listOf(item("내선", "7", dest = "신설동", remaining = 2), item("외선", "8", dest = "성수지선", remaining = 2)),
            branch,
        )
        assertFalse(branchResult.directionUncertain)
        assertEquals(listOf("7"), branchResult.candidates.map { it.item.vehicleId })
        assertFalse(transitTerminatesBeforeAlight("신설동", branch))
        assertFalse(transitTerminatesBeforeAlight("성수지선", branch))
    }

    /** 웹 "경유 목록 현재 위치 매칭(§14.1)"과 동일 케이스. */
    @Test fun `경유 목록 현재 위치 매칭`() {
        val leg = subwayLeg("천호", "여의도", listOf(stop("천호"), stop("강동"), stop("왕십리(성동구청)"), stop("여의도"), stop("화곡")))
        val empty = subwayLeg("천호", "여의도", emptyList(), wayCode = null, boardStop = null, alightStop = null)
        assertEquals(1, viaStopCurrentIndex(leg, "강동"))
        assertEquals(1, viaStopCurrentIndex(leg, "강동역")) // "역" 접미 흡수
        assertEquals(2, viaStopCurrentIndex(leg, "왕십리")) // 부역명 괄호 흡수
        assertNull(viaStopCurrentIndex(leg, "미지의역")) // 목록 밖 = 무표기
        assertNull(viaStopCurrentIndex(leg, null))
        assertNull(viaStopCurrentIndex(leg, ""))
        assertNull(viaStopCurrentIndex(empty, "강동"))
    }

    // ── 승차 전 도보 판정(A25, spec 2026-08-30 §3) ──

    @Test fun `승차 전 도보 대상 공유 fixture 동조`() {
        assertEquals(fixture.routes.keys, fixture.prewalk.keys)
        for ((name, route) in fixture.routes) assertEquals(fixture.prewalk[name], transitPrewalkTarget(route), name)
    }

    @Test fun `승차 전 도보는 0분·정류소 없음·널 아일랜드·NaN을 거절한다`() {
        val first = route("subwaySingle").legs[0]
        fun patched(minutes: Int?, stop: TransitLegStop?) =
            TransitGuideRoute(listOf(first.copy(walkBeforeMinutes = minutes, boardStop = stop)), walkAfterMinutes = null)
        assertNull(transitPrewalkTarget(patched(0, first.boardStop)))
        assertNull(transitPrewalkTarget(patched(null, first.boardStop)))
        assertNull(transitPrewalkTarget(patched(3, null)))
        assertNull(transitPrewalkTarget(patched(3, stop("x", 0.0, 0.0))))
        assertNull(transitPrewalkTarget(patched(3, stop("x", Double.NaN, 127.0))))
        assertNull(transitPrewalkTarget(TransitGuideRoute(emptyList(), walkAfterMinutes = null)))
    }

    @Test fun `도보 소비는 첫 leg만 지우고 원본을 보존한다`() {
        val base = route("twoLegs")
        val out = withoutPrewalk(base)
        assertNull(out.legs[0].walkBeforeMinutes)
        assertEquals(base.legs.size, out.legs.size)
        assertEquals(base.legs[1].walkBeforeMinutes, out.legs[1].walkBeforeMinutes)
        assertEquals(base.walkAfterMinutes, out.walkAfterMinutes)
        assertEquals(2, base.legs[0].walkBeforeMinutes) // 원본 불변
        assertEquals(base.legs[0].boardName, out.legs[0].boardName)

        // en 이름·급행 집합·출구 보존(Swift는 명시 복사라 필드가 늘면 빠뜨릴 수 있어 둔 단언).
        val rich = TransitGuideLeg(
            mode = "subway", lineName = "수도권 9호선", trackMode = TransitTrackMode.subway, boardName = "김포공항", alightName = "노들",
            boardStop = null, alightStop = null, viaStops = emptyList(), stationCount = 4, routeId = null, wayCode = 2,
            walkBeforeMinutes = 3, quickExit = null, lineNameEn = "Line 9", boardNameEn = "Gimpo Int'l Airport",
            alightNameEn = "Nodeul", expressStops = listOf("김포공항"), expressStopIds = listOf("901"), exitAlight = "2-1",
        )
        val kept = withoutPrewalk(TransitGuideRoute(listOf(rich), walkAfterMinutes = null)).legs[0]
        assertNull(kept.walkBeforeMinutes)
        assertEquals(rich.copy(walkBeforeMinutes = null), kept)
    }

    // ── A27 승차 국면 지하철 상태줄 — 공유 fixture(`subway-riding-message-cases.json`) ──

    @Serializable
    private data class RidingFile(val cases: List<RidingCase>) {
        @Serializable
        data class RidingCase(val arrivalCode: String? = null, val expect: Expect)

        @Serializable
        data class Expect(val kind: String, val key: String? = null)
    }

    @Test fun `지하철 승차 상태줄 공유 fixture 동조`() {
        val cases = Fixtures.sharedJson("subway-riding-message-cases.json", RidingFile.serializer()).cases
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val want = when (c.expect.kind) {
                "key" -> SubwayRidingMessage.Key(c.expect.key ?: fail("key 없음"))
                "omit" -> SubwayRidingMessage.Omit
                "raw" -> SubwayRidingMessage.Raw
                else -> fail("미지 kind ${c.expect.kind}")
            }
            assertEquals(want, subwayRidingMessage(c.arrivalCode), "code ${c.arrivalCode}")
        }
    }
}

/** 이벤트 종류를 fixture 문자열로 환원(웹 event.kind 대응). `TransitGuideToneTest`와 공유 — 새 케이스는 여기서 컴파일이 막는다. */
internal fun transitEventKind(event: TransitGuideEvent?): String? = when (event) {
    is TransitGuideEvent.Boarded -> "boarded"
    is TransitGuideEvent.VehicleSelected -> "vehicleSelected"
    is TransitGuideEvent.Approaching -> "approaching"
    TransitGuideEvent.VehiclePassed -> "vehiclePassed"
    TransitGuideEvent.ArrivingAtBoardStop -> "arrivingAtBoardStop"
    TransitGuideEvent.ArrivingAtAlightStop -> "arrivingAtAlightStop"
    is TransitGuideEvent.TrackingStarted -> "trackingStarted"
    is TransitGuideEvent.Countdown -> "countdown"
    is TransitGuideEvent.MessageChanged -> "messageChanged"
    is TransitGuideEvent.Arrived -> "arrived"
    is TransitGuideEvent.BackOnTrack -> "backOnTrack"
    is TransitGuideEvent.ApproxVehicleChanged -> "approxVehicleChanged"
    TransitGuideEvent.SignalLost -> "signalLost"
    TransitGuideEvent.NeverSeen -> "neverSeen"
    TransitGuideEvent.UpstreamFailed -> "upstreamFailed"
    TransitGuideEvent.SignalRecovered -> "signalRecovered"
    is TransitGuideEvent.LegAdvanced -> "legAdvanced"
    TransitGuideEvent.BoardingReset -> "boardingReset"
    TransitGuideEvent.CapSlowed -> "capSlowed"
    null -> null
}
