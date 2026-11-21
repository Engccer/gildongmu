package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.*
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** E70 여정 전이 표(plan Task 4 · spec §6.1) 계약 테스트. 표의 행마다 한 건, 표 밖 (국면, 사건) 쌍은 전부 ignore. Kit `JourneyTests` 미러. */
class JourneyTest {
    private val journeyId = UUID.fromString("00000000-0000-0000-0000-0000000000E7")

    /** 택시 시작 · 하차 지정 · 출구 도보 있음 — 표의 모든 갈래를 지나는 기본 모양. */
    private val full = JourneyShape(startsWithTaxi = true, alightDesignated = true, hasEgressWalk = true)

    private fun state(phase: JourneyPhase, shape: JourneyShape = full, seq: Int = 5) =
        JourneyState(journeyId, shape, phase, seq)

    private fun step(s: JourneyState, event: JourneyEvent, token: JourneyToken? = null): JourneyStepResult =
        journeyStep(s, event, token ?: s.token)

    /** 기대: 다음 국면(seq는 언제나 +1) / 종료 / 무시. */
    private sealed class Expect {
        data class Next(val phase: JourneyPhase) : Expect()
        object End : Expect()
        object Ignore : Expect()
    }

    private fun outcome(s: JourneyState, event: JourneyEvent): Expect = when (val r = step(s, event)) {
        JourneyStepResult.Ignore -> Expect.Ignore
        JourneyStepResult.End -> Expect.End
        is JourneyStepResult.Next -> {
            // `Next`는 같은 여정·같은 모양을 유지하고 seq만 +1 한다.
            assertEquals(s.journeyId, r.state.journeyId)
            assertEquals(s.shape, r.state.shape)
            assertEquals(s.seq + 1, r.state.seq)
            Expect.Next(r.state.phase)
        }
    }

    private data class Row(val phase: JourneyPhase, val event: JourneyEvent, val expect: Expect)

    private val stageEnds = listOf(JourneyStageEnd.arrived, JourneyStageEnd.userStopped, JourneyStageEnd.startFailed, JourneyStageEnd.ended)
    private val allStages = listOf(JourneyStage.taxiIn, JourneyStage.access, JourneyStage.transit, JourneyStage.egress, JourneyStage.taxiOut)

    private fun running(s: JourneyStage) = JourneyPhase.Running(s)
    private fun trans(s: JourneyStage) = JourneyPhase.Transitioning(s)
    private fun failed(s: JourneyStage) = JourneyPhase.Failed(s)
    private fun ended(e: JourneyStageEnd) = JourneyEvent.StageEnded(e)
    private fun next(p: JourneyPhase) = Expect.Next(p)

    /** 표 전체(`UserEnded`는 따로). `RideCompleted`는 모양 의존이라 기본 모양 기준 한 행씩. */
    private val rows: List<Row> by lazy {
        val t = JourneyStage.taxiIn; val a = JourneyStage.access; val tr = JourneyStage.transit
        val e = JourneyStage.egress; val o = JourneyStage.taxiOut
        val fixed = listOf(
            // running(taxiIn)
            Row(running(t), ended(JourneyStageEnd.arrived), next(trans(a))),
            Row(running(t), JourneyEvent.TaxiDropped, next(trans(a))),
            Row(running(t), ended(JourneyStageEnd.startFailed), next(failed(t))),
            Row(running(t), ended(JourneyStageEnd.ended), next(failed(t))),
            Row(running(t), ended(JourneyStageEnd.userStopped), Expect.End),
            // running(access)
            Row(running(a), ended(JourneyStageEnd.arrived), next(trans(tr))),
            Row(running(a), ended(JourneyStageEnd.startFailed), next(trans(tr))),
            Row(running(a), ended(JourneyStageEnd.ended), next(trans(tr))),
            Row(running(a), ended(JourneyStageEnd.userStopped), Expect.End),
            // running(transit)
            Row(running(tr), JourneyEvent.RideCompleted, next(trans(e))),
            Row(running(tr), JourneyEvent.TransitStopped, Expect.End),
            Row(running(tr), ended(JourneyStageEnd.startFailed), next(failed(tr))),
            // running(egress)
            Row(running(e), ended(JourneyStageEnd.arrived), next(trans(o))),
            Row(running(e), JourneyEvent.TaxiBoarded, next(trans(o))),
            Row(running(e), ended(JourneyStageEnd.userStopped), Expect.End),
            Row(running(e), ended(JourneyStageEnd.startFailed), next(failed(e))),
            Row(running(e), ended(JourneyStageEnd.ended), next(failed(e))),
            // running(taxiOut)
            Row(running(o), ended(JourneyStageEnd.startFailed), next(failed(o))),
            Row(running(o), ended(JourneyStageEnd.arrived), Expect.End),
            Row(running(o), ended(JourneyStageEnd.userStopped), Expect.End),
            Row(running(o), ended(JourneyStageEnd.ended), Expect.End),
            // failed
            Row(failed(t), JourneyEvent.TaxiDropped, next(trans(a))),
            Row(failed(e), JourneyEvent.TaxiBoarded, next(trans(o))),
        )
        val perStage = allStages.flatMap { stage ->
            listOf(
                // transitioning(s)
                Row(trans(stage), JourneyEvent.Prepared(stage), next(running(stage))),
                // access는 아래 별도 행(실패 대신 대중교통으로)
                Row(trans(stage), JourneyEvent.PrepFailed, if (stage == a) next(trans(tr)) else next(failed(stage))),
                Row(trans(stage), JourneyEvent.StaleTimeout, if (stage == a) next(trans(tr)) else next(failed(stage))),
                // failed(s)
                Row(failed(stage), JourneyEvent.Retry, next(trans(stage))),
            )
        }
        // 접근 도보 30m 미만 생략: access를 건너뛰고 대중교통 준비 완료
        fixed + perStage + listOf(Row(trans(a), JourneyEvent.Prepared(tr), next(running(tr))))
    }

    private val allPhases: List<JourneyPhase> =
        allStages.map { running(it) } + allStages.map { trans(it) } + allStages.map { failed(it) }

    private val allEvents: List<JourneyEvent> =
        stageEnds.map { JourneyEvent.StageEnded(it) } +
            listOf(JourneyEvent.TaxiDropped, JourneyEvent.TaxiBoarded, JourneyEvent.RideCompleted, JourneyEvent.TransitStopped) +
            allStages.map { JourneyEvent.Prepared(it) } +
            listOf(JourneyEvent.PrepFailed, JourneyEvent.Retry, JourneyEvent.StaleTimeout)

    @Test fun `전이 표의 행`() {
        for (row in rows) assertEquals(row.expect, outcome(state(row.phase), row.event), "${row.phase} + ${row.event}")
    }

    @Test fun everythingOutsideTheTableIsIgnored() {
        var checked = 0
        for (phase in allPhases) {
            for (event in allEvents) {
                if (rows.any { it.phase == phase && it.event == event }) continue
                assertEquals(Expect.Ignore, outcome(state(phase), event), "$phase + $event")
                checked += 1
            }
        }
        // 모든 (국면, 사건) 쌍에서 표의 행을 뺀 수 — 표 행이 서로 겹치거나 목록 밖이면 숫자가 어긋난다.
        assertEquals(allPhases.size * allEvents.size - rows.size, checked)
    }

    @Test fun userEndedEndsFromEveryPhase() {
        for (phase in allPhases) assertEquals(Expect.End, outcome(state(phase), JourneyEvent.UserEnded), "$phase")
    }

    // MARK: rideCompleted — 모양 의존(위 표 행은 기본 모양 기준)

    @Test fun rideCompletedFollowsShape() {
        val walkToStand = JourneyShape(startsWithTaxi = true, alightDesignated = true, hasEgressWalk = true)
        val noEgressWalk = JourneyShape(startsWithTaxi = true, alightDesignated = true, hasEgressWalk = false)
        val noAlight = JourneyShape(startsWithTaxi = true, alightDesignated = false, hasEgressWalk = false)
        // 하차 지정 + 출구 도보 → egress, 출구 후보 없음(none) → 곧장 taxiOut, 하차 미지정 → 여정 끝
        assertEquals(next(trans(JourneyStage.egress)), outcome(state(running(JourneyStage.transit), shape = walkToStand), JourneyEvent.RideCompleted))
        assertEquals(next(trans(JourneyStage.taxiOut)), outcome(state(running(JourneyStage.transit), shape = noEgressWalk), JourneyEvent.RideCompleted))
        assertEquals(Expect.End, outcome(state(running(JourneyStage.transit), shape = noAlight), JourneyEvent.RideCompleted))
        // 하차 미지정이면 hasEgressWalk가 참이어도 끝(모순 입력 방어: alightDesignated가 우선)
        val contradictory = JourneyShape(startsWithTaxi = false, alightDesignated = false, hasEgressWalk = true)
        assertEquals(Expect.End, outcome(state(running(JourneyStage.transit), shape = contradictory), JourneyEvent.RideCompleted))
    }

    // MARK: 시작

    @Test fun startBeginsTransitioningToFirstStage() {
        val withTaxi = JourneyState.start(journeyId, full)
        assertEquals(trans(JourneyStage.taxiIn), withTaxi.phase)
        assertEquals(1, withTaxi.seq)
        assertEquals(JourneyToken(journeyId, 1), withTaxi.token)

        val transitFirst = JourneyState.start(journeyId, JourneyShape(startsWithTaxi = false, alightDesignated = true, hasEgressWalk = false))
        assertEquals(trans(JourneyStage.transit), transitFirst.phase)
        assertEquals(1, transitFirst.seq)
    }

    @Test fun taxiStartRunsThroughToTaxiOut() {
        // 한 번에 끝까지: 시작 → taxiIn → access(30m 이상) → transit → egress → taxiOut → 끝
        var s = JourneyState.start(journeyId, full)
        fun advance(e: JourneyEvent, expect: JourneyPhase) {
            val r = step(s, e)
            if (r !is JourneyStepResult.Next) { fail("$e 가 전이하지 않았다"); return }
            assertEquals(expect, r.state.phase)
            s = r.state
        }
        advance(JourneyEvent.Prepared(JourneyStage.taxiIn), running(JourneyStage.taxiIn))
        advance(JourneyEvent.TaxiDropped, trans(JourneyStage.access))
        advance(JourneyEvent.Prepared(JourneyStage.access), running(JourneyStage.access))
        advance(ended(JourneyStageEnd.arrived), trans(JourneyStage.transit))
        advance(JourneyEvent.Prepared(JourneyStage.transit), running(JourneyStage.transit))
        advance(JourneyEvent.RideCompleted, trans(JourneyStage.egress))
        advance(JourneyEvent.Prepared(JourneyStage.egress), running(JourneyStage.egress))
        advance(JourneyEvent.TaxiBoarded, trans(JourneyStage.taxiOut))
        advance(JourneyEvent.Prepared(JourneyStage.taxiOut), running(JourneyStage.taxiOut))
        assertEquals(JourneyStepResult.End, step(s, ended(JourneyStageEnd.arrived)))
        assertEquals(9 + 1, s.seq) // 전이 아홉 번 + 시작 seq 1
    }

    // MARK: 낡은 사건·경쟁

    @Test fun staleTokenIsIgnoredEvenForUserEnded() {
        val s = state(running(JourneyStage.taxiIn), seq = 5)
        val old = JourneyToken(journeyId, 4)
        val future = JourneyToken(journeyId, 6)
        val other = JourneyToken(UUID.randomUUID(), 5)
        for (t in listOf(old, future, other)) {
            assertEquals(JourneyStepResult.Ignore, step(s, JourneyEvent.TaxiDropped, t))
            assertEquals(JourneyStepResult.Ignore, step(s, JourneyEvent.UserEnded, t))
        }
        assertNotEquals(JourneyStepResult.Ignore, step(s, JourneyEvent.TaxiDropped, s.token))
    }

    /** 사용자가 「자동차에서 내렸어요」를 누른 직후 자동 도착 판정이 같은 seq로 도착하는 경쟁(Review Focus 4). */
    @Test fun taxiDroppedThenAutoArrivalWithSameTokenTransitionsOnce() {
        val s = state(running(JourneyStage.taxiIn))
        val token = s.token
        val first = journeyStep(s, JourneyEvent.TaxiDropped, token)
        if (first !is JourneyStepResult.Next) { fail("첫 사건이 전이하지 않았다"); return }
        assertEquals(trans(JourneyStage.access), first.state.phase)
        // 두 번째 사건은 같은 (낡은) token을 들고 오므로 새 상태에서 무시된다.
        assertEquals(JourneyStepResult.Ignore, journeyStep(first.state, ended(JourneyStageEnd.arrived), token))
        // 반대 순서도 같다.
        val second = journeyStep(s, ended(JourneyStageEnd.arrived), token)
        if (second !is JourneyStepResult.Next) { fail("도착이 전이하지 않았다"); return }
        assertEquals(JourneyStepResult.Ignore, journeyStep(second.state, JourneyEvent.TaxiDropped, token))
    }

    // MARK: 접근 도보 문턱

    @Test fun accessWalkThresholdIsThirtyMeters() {
        // 위도 1도 ≈ 111,195m → 29m·31m에 해당하는 위도 차
        val base = 37.5573
        val meter = 1.0 / 111_194.9
        assertFalse(journeyNeedsAccessWalk(base, 126.956, base + 29 * meter, 126.956))
        assertTrue(journeyNeedsAccessWalk(base, 126.956, base + 31 * meter, 126.956))
        assertEquals(30.0, JourneyTuning.accessWalkMinMeters)
        assertEquals(600, JourneyTuning.handoffDelayMs)
        assertEquals(30, JourneyTuning.staleTransitionSeconds)
        assertEquals(500.0, JourneyTuning.stationIdentityMeters) // 서버 JOURNEY_STATION_IDENTITY_M
    }

    // MARK: 표시 이름(웹 displayStationName 미러 — 공유 fixture 전수)

    @Serializable
    private data class DisplayNameFile(val cases: List<Case>) {
        @Serializable
        data class Case(val input: String, val expected: String)
    }

    @Test fun displayNameSharedFixture() {
        val file = Fixtures.sharedJson("journey-display-names.json", DisplayNameFile.serializer())
        assertTrue(file.cases.isNotEmpty())
        for (c in file.cases) assertEquals(c.expected, journeyStationDisplayName(c.input), c.input)
    }

    // MARK: 입구 검색 짐작(E77 — 공유 fixture 전수)

    @Serializable
    private data class GuessFile(val cases: List<Case>) {
        @Serializable
        data class Pt(val lat: Double, val lng: Double)

        @Serializable
        data class Case(val name: String, val place: Pt, val origin: Pt? = null, val dest: Pt? = null, val expected: String)
    }

    @Test fun transferGuessSharedFixture() {
        val file = Fixtures.sharedJson("journey-transfer-guess.json", GuessFile.serializer())
        assertEquals(7, file.cases.size)
        for (c in file.cases) {
            val got = journeyTransferGuess(
                c.place.lat, c.place.lng,
                c.origin?.let { RoutePoint(it.lat, it.lng) }, c.dest?.let { RoutePoint(it.lat, it.lng) },
            )
            assertEquals(c.expected, if (got == JourneyTransferSide.alight) "alight" else "board", c.name)
        }
    }

    @Test fun displayNameExtraCases() {
        assertEquals("인천공항1터미널", journeyStationDisplayName("인천공항1터미널역 공항철도"))
    }

    // MARK: 동명 이역 노선 머리말(판정 8)

    @Test fun lineLabelNormalizesKakaoAndOdsayForms() {
        assertEquals("2호선", journeyLineLabel("수도권 2호선"))
        assertEquals("2호선", journeyLineLabel("수도권2호선"))
        assertEquals("9호선", journeyLineLabel("수도권 9호선(급행)"))
        assertEquals("수인분당선", journeyLineLabel("수도권 수인.분당선"))
        assertEquals("경의중앙선", journeyLineLabel("경의중앙선"))
        assertNull(journeyLineLabel(null))
        assertNull(journeyLineLabel(" "))
    }

    @Test fun sameLineFollowsServerForms() {
        assertTrue(journeySameLine("수도권2호선", "수도권 2호선"))
        assertTrue(journeySameLine("9호선", "수도권 9호선(급행)"))
        assertTrue(journeySameLine("수인분당선", "수도권 수인.분당선"))
        // 카카오 출구 힌트는 지역을 싣지 않는다 — 같은 역 안 비교라 코어만 본다(서버 sameLine 동형)
        assertTrue(journeySameLine("2호선", "부산 2호선"))
        assertFalse(journeySameLine("부산 2호선", "대구 2호선"))
        assertFalse(journeySameLine("1호선", "11호선"))
        assertFalse(journeySameLine("경의중앙선", "수도권 2호선"))
    }

    @Serializable
    private data class LineNameFile(val cases: List<Case>) {
        @Serializable
        data class Case(val a: String, val b: String, val same: Boolean)
    }

    /** 서버 `sameLine`과 같은 표본(웹 `station-identity.test.ts`가 같은 파일을 돈다) — 양방향. */
    @Test fun sameLineSharedFixture() {
        val file = Fixtures.sharedJson("journey-line-names.json", LineNameFile.serializer())
        assertTrue(file.cases.isNotEmpty())
        for (c in file.cases) {
            assertEquals(c.same, journeySameLine(c.a, c.b), "${c.a} ↔ ${c.b}")
            assertEquals(c.same, journeySameLine(c.b, c.a), "${c.b} ↔ ${c.a}")
        }
    }

    private fun stop(name: String, line: String?, lat: Double, lng: Double) = JourneyStopIdentity(name, line, lat, lng)

    @Test fun qualifierOnlyForSameNameDifferentStation() {
        // 경의중앙선 신촌을 골랐는데 추천은 2호선 신촌 승차(좌표 약 680m) — 붙인다
        val gyeongui = stop("신촌역", "경의중앙선", 37.5598, 126.9426)
        val line2 = stop("신촌", "수도권 2호선", 37.5552, 126.9369)
        assertTrue(journeyNeedsLineQualifier(gyeongui, line2))
        // 노선을 모르면 좌표로 가른다 — 멀면 다른 역
        assertTrue(journeyNeedsLineQualifier(stop("신촌", null, 37.5598, 126.9426), line2))
        // 노선을 모르고 같은 자리면 같은 역(두 역을 다 정한 여정에서 추천이 고른 그 역에서 탈 때) — 붙이지 않는다
        assertFalse(journeyNeedsLineQualifier(stop("서울역", null, 37.5547, 126.9707), stop("서울역", "수도권 1호선", 37.5546, 126.9720)))
        // 같은 복합체의 다른 노선(노선 둘 다 앎)은 붙인다
        assertTrue(journeyNeedsLineQualifier(stop("잠실", "8호선", 37.5145, 127.1059), stop("잠실", "수도권 2호선", 37.5133, 127.1001)))
        // 이름이 다르면 평소 문장(애오개 ≠ 아현), 이름·노선이 같으면 붙이지 않는다
        assertFalse(journeyNeedsLineQualifier(stop("아현", "2호선", 37.5573, 126.956), line2))
        assertFalse(journeyNeedsLineQualifier(stop("신촌", "수도권2호선", 37.5598, 126.9426), line2))
    }

    // MARK: 쪽 판정(결과 화면 제목) — 손으로 만든 변형

    private fun leg(
        mode: String, from: String?, to: String?, line: String? = null,
        at: Pair<Double, Double>? = null, end: Pair<Double, Double>? = null,
    ): TransitRouteLeg {
        val stops = at?.let { a ->
            val e = end ?: a
            listOf(TransitLegStop(name = from ?: "", lat = a.first, lng = a.second), TransitLegStop(name = to ?: "", lat = e.first, lng = e.second))
        }
        return TransitRouteLeg(mode = mode, lineName = line, fromName = from, toName = to, stationCount = null, minutes = 5, stops = stops)
    }

    private fun variant(kind: JourneyVariantKind, legs: List<TransitRouteLeg>) = JourneyVariant(
        kind = kind, boardStation = null, alightStation = null, taxiIn = null,
        transit = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 20, fare = 1550, transfers = 0, walkMinutes = 0, departName = null, arriveName = null),
            legs = legs, routeKey = "p0",
        ),
        egress = null, totals = JourneyTotals(minutes = 20, taxiFare = 0, transitFare = 1550),
    )

    private val sinchonGyeongui = RecentStation(label = "신촌역", lat = 37.5598, lng = 126.9426, line = "경의중앙선", kind = null)
    private val seoulKtx = RecentStation(label = "서울역", lat = 37.5547, lng = 126.9707, line = null, kind = null)
    private val gwanghwamun = RecentStation(label = "광화문역", lat = 37.5710, lng = 126.9768, line = "5호선", kind = null)

    private fun missing(side: JourneyMissingSide) = JourneyDesignatedMissing(side = side, oppositeDirection = null)

    @Test fun boardHomonymQualifiesBoardSideOnly() {
        val rec = variant(JourneyVariantKind.recommended, listOf(
            leg("walk", null, "신촌"),
            leg("subway", "신촌", "광화문", line = "수도권 2호선", at = 37.5552 to 126.9369, end = 37.5710 to 126.9768),
        ))
        val result = JourneyResult(variants = listOf(rec), designatedMissing = missing(JourneyMissingSide.board))
        val lines = journeyLineQualifiers(result, board = sinchonGyeongui, alight = null)
        assertEquals(JourneyLineQualifiers(board = true, alight = false), lines)
        assertTrue(journeyRecommendedTitleIsBoardSide(rec, board = sinchonGyeongui, alight = null, lines = lines))
    }

    /**
     * 코드 리뷰 m2 반례: 두 역을 다 정했고 하차 쪽만 안 맞았다. 추천은 고른 서울역(힌트 없음)에서 타고 다른 역에서 내린다 —
     * 승차 쪽에 노선을 붙이지 않고, 제목은 다른 쪽인 하차 쪽이다.
     */
    @Test fun sameStationWithUnknownLineIsNotHomonym() {
        val rec = variant(JourneyVariantKind.recommended, listOf(
            leg("subway", "서울역", "종각", line = "수도권 1호선", at = 37.5546 to 126.9720, end = 37.5702 to 126.9831),
        ))
        val result = JourneyResult(variants = listOf(rec), designatedMissing = missing(JourneyMissingSide.alight))
        val lines = journeyLineQualifiers(result, board = seoulKtx, alight = gwanghwamun)
        assertEquals(JourneyLineQualifiers(board = false, alight = false), lines)
        assertFalse(journeyRecommendedTitleIsBoardSide(rec, board = seoulKtx, alight = gwanghwamun, lines = lines))
    }

    /**
     * 칸에 고른 역으로 비교한다: 지정 역 경로는 공덕 경의중앙선에서 타지만 칸(힌트 없는 공덕)과 같은 자리인 추천의 5호선 공덕은
     * 서버가 같은 역으로 본다 — 승차 쪽에 붙지 않는다. 하차는 경의중앙선 신촌(칸) vs 2호선 신촌(추천)이라 붙고 제목은 하차 쪽.
     */
    @Test fun alightHomonymComparesAgainstChosenStation() {
        val designated = variant(JourneyVariantKind.designated, listOf(
            leg("subway", "공덕", "신촌", line = "경의중앙선", at = 37.5440 to 126.9516, end = 37.5598 to 126.9426),
        ))
        val rec = variant(JourneyVariantKind.recommended, listOf(
            leg("subway", "공덕", "충정로", line = "수도권 5호선", at = 37.5440 to 126.9516, end = 37.5600 to 126.9636),
            leg("subway", "충정로", "신촌", line = "수도권 2호선", at = 37.5600 to 126.9636, end = 37.5552 to 126.9369),
            leg("walk", "신촌", null),
        ))
        val gongdeok = RecentStation(label = "공덕역", lat = 37.5440, lng = 126.9516, line = null, kind = null)
        val result = JourneyResult(variants = listOf(designated, rec), designatedMissing = null)
        val lines = journeyLineQualifiers(result, board = gongdeok, alight = sinchonGyeongui)
        assertEquals(JourneyLineQualifiers(board = false, alight = true), lines)
        assertFalse(journeyRecommendedTitleIsBoardSide(rec, board = gongdeok, alight = sinchonGyeongui, lines = lines))
    }

    /** 탈것이 둘 이상이어도 승차 쪽은 첫 탈것으로 가른다(재리뷰 m5 — `.first` → `.last` 변이 검출). */
    @Test fun boardHomonymUsesFirstVehicleAmongSeveral() {
        val rec = variant(JourneyVariantKind.recommended, listOf(
            leg("subway", "신촌", "충정로", line = "수도권 2호선", at = 37.5552 to 126.9369, end = 37.5600 to 126.9636),
            leg("subway", "충정로", "광화문", line = "수도권 5호선", at = 37.5600 to 126.9636, end = 37.5710 to 126.9768),
        ))
        val result = JourneyResult(variants = listOf(rec), designatedMissing = missing(JourneyMissingSide.board))
        assertEquals(JourneyLineQualifiers(board = true), journeyLineQualifiers(result, board = sinchonGyeongui, alight = null))
    }

    @Test fun busSideIsNeverQualified() {
        val rec = variant(JourneyVariantKind.recommended, listOf(
            leg("bus", "신촌", "광화문", line = "7612", at = 37.5552 to 126.9369, end = 37.5710 to 126.9768),
        ))
        val result = JourneyResult(variants = listOf(rec), designatedMissing = missing(JourneyMissingSide.board))
        assertEquals(JourneyLineQualifiers(), journeyLineQualifiers(result, board = sinchonGyeongui, alight = null))
    }

    /** 코드 리뷰 m4: 앞뒤 도보를 건너 탈것으로 가르고, 승차·하차 쪽이 서로 다르게 나온다. */
    @Test fun busStopEndsSkipWalkAndDifferBySide() {
        val busFirst = variant(JourneyVariantKind.recommended, listOf(
            leg("walk", null, "정류장"), leg("bus", "정류장", "역", line = "472"), leg("subway", "역", "광화문", line = "5호선"),
            leg("walk", "광화문", null),
        ))
        assertTrue(busFirst.boardsAtBusStop)
        assertFalse(busFirst.alightsAtBusStop)
        val busLast = variant(JourneyVariantKind.recommended, listOf(
            leg("walk", null, "역"), leg("subway", "역", "환승", line = "2호선"), leg("bus", "환승", "정류장", line = "472"),
        ))
        assertFalse(busLast.boardsAtBusStop)
        assertTrue(busLast.alightsAtBusStop)
    }

    // MARK: 버스 정류장 지정(E70-e)

    @Serializable
    private data class BusStopKeyFile(val busStops: Pairs) {
        @Serializable
        data class Name(val name: String, val key: String)

        @Serializable
        data class Pairs(val names: List<Name>)
    }

    /** 웹 `busStopKey`와 같은 공유 fixture 표 전체를 읽는다. */
    @Test fun busStopKeyMatchesSharedTable() {
        val file = Fixtures.sharedJson("journey-station-pairs.json", BusStopKeyFile.serializer())
        assertTrue(file.busStops.names.isNotEmpty())
        for (c in file.busStops.names) assertEquals(c.key, journeyBusStopKey(c.name), c.name)
        // 짝 없는 여는 괄호는 그대로 남는다(웹 정규식 `\([^)]*\)`와 같다)
        assertEquals("가(나", journeyBusStopKey("가(나"))
    }

    @Test fun busStopSideSkipsLineQualifierAndComparesByKey() {
        val stopBoard = RecentStation(label = "강남역.삼성전자", lat = 37.4979, lng = 127.0276, line = null, kind = JourneyStationKind.busStop)
        // 표시 이름이 역과 같고(「강남」) 600m 이상 떨어진 정류장 — 가드가 없으면 동명 이역으로 보고 노선 머리말이 붙는다
        val sameNameStop = RecentStation(label = "강남역", lat = 37.4979, lng = 127.0276, line = null, kind = JourneyStationKind.busStop)
        val far = variant(JourneyVariantKind.recommended, listOf(
            leg("subway", "강남", "역삼", line = "수도권 5호선", at = 37.5049 to 127.0276, end = 37.5007 to 127.0364),
        ))
        val farResult = JourneyResult(variants = listOf(far), designatedMissing = missing(JourneyMissingSide.board))
        assertEquals(JourneyLineQualifiers(), journeyLineQualifiers(farResult, board = sameNameStop, alight = null))
        val farAlight = variant(JourneyVariantKind.recommended, listOf(
            leg("subway", "역삼", "강남", line = "수도권 5호선", at = 37.5007 to 127.0364, end = 37.5049 to 127.0276),
        ))
        val farAlightResult = JourneyResult(variants = listOf(farAlight), designatedMissing = missing(JourneyMissingSide.alight))
        assertEquals(JourneyLineQualifiers(), journeyLineQualifiers(farAlightResult, board = null, alight = sameNameStop))
        val otherKey = variant(JourneyVariantKind.recommended, listOf(leg("bus", "논현사거리", "역삼", line = "112")))
        val alightStop = RecentStation(label = "역삼역", lat = 37.5007, lng = 127.0364, line = null, kind = JourneyStationKind.busStop)
        // 승차는 같은 키, 하차는 다른 키 → 하차 쪽 제목
        val toOther = variant(JourneyVariantKind.recommended, listOf(leg("bus", "강남역", "다른정류장", line = "112")))
        assertFalse(journeyRecommendedTitleIsBoardSide(toOther, board = stopBoard, alight = alightStop, lines = JourneyLineQualifiers()))
        // 승차가 다른 키 → 승차 쪽 제목
        assertTrue(journeyRecommendedTitleIsBoardSide(otherKey, board = stopBoard, alight = null, lines = JourneyLineQualifiers()))
    }

    @Test fun qualifiedNamePrefixesKnownLineOnly() {
        assertEquals("2호선 신촌", journeyQualifiedStationName("신촌", line = "수도권 2호선"))
        assertEquals("경의중앙선 신촌", journeyQualifiedStationName("신촌역", line = "경의중앙선"))
        assertEquals("서울", journeyQualifiedStationName("서울역", line = null))
    }

    // MARK: E71 지금 탄 열차 — 방면 묶음·방향 잠금

    private fun arrival(line: String?, dir: String, nm: String, dest: String): SubwayArrival {
        fun q(s: String) = "\"$s\""
        val json = "{\"line\":${line?.let(::q) ?: "null"},\"direction\":${q(dir)},\"trainLineNm\":${q(nm)}," +
            "\"destination\":${q(dest)},\"message\":\"곧 도착\",\"arrivalSeconds\":0,\"express\":false}"
        return KitJson.decodeFromString(SubwayArrival.serializer(), json)
    }

    @Test fun linesAreDistinctNonEmptyInFirstSeenOrder() {
        val list = listOf(
            arrival("1호선", "상행", "인천행 - 구로방면", "인천"),
            arrival(null, "상행", "x", "x"),
            arrival("1호선", "하행", "청량리행 - 역곡방면", "청량리"),
            arrival("경의중앙선", "상행", "문산행 - 가좌방면", "문산"),
            arrival("", "상행", "x", "x"),
        )
        assertEquals(listOf("1호선", "경의중앙선"), journeyAboardLines(list))
        assertEquals(emptyList<String>(), journeyAboardLines(emptyList()))
    }

    @Test fun directionsGroupByUpdnLineWithBoundNameAndTerminals() {
        val list = listOf(
            arrival("1호선", "상행", "인천행 - 구로방면", "인천"),
            arrival("1호선", "상행", "부평행 - 구로방면", "부평"),
            arrival("1호선", "하행", "청량리행 - 역곡방면", "청량리"),
            arrival("1호선", "상행", "인천행 - 구로방면", "인천"),
            arrival("경의중앙선", "상행", "문산행 - 가좌방면", "문산"),
            arrival("1호선", "", "x행 - y방면", "x"),
        )
        assertEquals(
            listOf(
                JourneyAboardDirection(direction = "상행", name = "구로방면", terminals = listOf("인천", "부평")),
                JourneyAboardDirection(direction = "하행", name = "역곡방면", terminals = listOf("청량리")),
            ),
            journeyAboardDirections(list, line = "1호선"),
        )
    }

    @Test fun capitalRegionPrefixedHintMatchesBareArrivalLine() {
        val list = listOf(
            arrival("1호선", "상행", "인천행 - 구로방면", "인천"),
            arrival("2호선", "내선", "성수행 - 시청방면", "성수"),
            arrival("경의중앙선", "상행", "문산행 - 가좌방면", "문산"),
        )
        assertEquals(listOf("상행"), journeyAboardDirections(list, line = "수도권1호선").map { it.direction })
        assertEquals(listOf("인천"), journeyAboardDirections(list, line = "수도권1호선").first().terminals)
        assertEquals(listOf("내선"), journeyAboardDirections(list, line = "수도권2호선").map { it.direction })
        assertFalse(journeyAboardDirections(list, line = "수도권1호선").any { it.terminals.contains("문산") })
    }

    @Test fun nameFallsBackToDirectionWithoutDashSeparator() {
        val list = listOf(arrival("1호선", "상행", "인천행", "인천"))
        assertEquals("상행", journeyAboardDirections(list, line = "1호선").first().name)
    }

    @Test fun nameComesFromFirstEntryThatHasSeparator() {
        val list = listOf(
            arrival("1호선", "상행", "인천행", "인천"),
            arrival("1호선", "상행", "부평행 -  구로방면 ", "부평"),
        )
        assertEquals("구로방면", journeyAboardDirections(list, line = "1호선").first().name)
    }

    @Test fun circularLineGivesInnerAndOuterGroups() {
        val list = listOf(
            arrival("2호선", "내선", "성수행 - 시청방면", "성수"),
            arrival("2호선", "외선", "신도림행 - 충정로방면", "신도림"),
            arrival("2호선", "내선", "성수행 - 시청방면", "성수"),
        )
        val groups = journeyAboardDirections(list, line = "2호선")
        assertEquals(listOf("내선", "외선"), groups.map { it.direction })
        assertEquals(listOf("성수"), groups[0].terminals)
    }

    @Test fun trainItemsKeepOnlyTheLockedDirection() {
        fun item(dir: String, id: String) = TransitTrackItem(
            vehicleId = id, direction = dir, message = "", remainingStops = null,
            destinationName = null, express = false, arrivalCode = null,
        )
        val items = listOf(item("상행", "a"), item("하행", "b"), item("상행", "c"))
        assertEquals(listOf<String?>("a", "c"), journeyAboardTrainItems(items, direction = "상행").map { it.vehicleId })
        assertTrue(journeyAboardTrainItems(listOf(item("하행", "b")), direction = "상행").isEmpty())
    }
}
