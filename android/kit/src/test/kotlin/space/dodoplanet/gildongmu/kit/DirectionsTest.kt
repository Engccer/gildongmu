package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import space.dodoplanet.gildongmu.kit.models.WalkRouteStep
import kotlinx.coroutines.CancellationException
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 길찾기 도메인 — Kit `DirectionsTests` 미러: 수단 상태 분류(성공≠경로 없음≠실패≠게이트)와 표시 순서·성공 집계
 * (포커스 목적지·합산 통지의 근거), 공유 fixture `directions-order-scenarios.json`.
 */
class DirectionsTest {
    private fun walkFixture() = WalkRouteBriefing(
        distanceMeters = 1200, durationSeconds = 900,
        steps = listOf(WalkRouteStep(description = "천호대로를 따라 119m 이동")),
    )

    private fun transitFixture() = TransitRouteResult(
        recommended = TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 30, fare = 1550, transfers = 1, walkMinutes = 8, departName = "길동", arriveName = "시청"),
            legs = listOf(TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "길동", toName = "시청", stationCount = 10, minutes = 22)),
            routeKey = "p0",
        ),
        alternatives = emptyList(), totalCandidates = 1,
    )

    private fun carFixture() = CarRouteBriefing(distanceMeters = 9000, durationSeconds = 1500, taxiFare = 12000, tollFare = 0, guides = emptyList())

    private fun badStatus(code: Int, message: String? = null) = Result.failure<Nothing>(APIError.BadStatus(code, message))

    @Test fun walkClassifiesFourStates() {
        // 성공: 브리핑 보존
        assertEquals(1200, assertIs<DirectionsModeOutcome.Walk>(DirectionsOutcomeClassifier.classifyWalk(Result.success(walkFixture()))).briefing.distanceMeters)
        // 경로 없음: envelope result null(3-state, 실패 아님)
        assertIs<DirectionsModeOutcome.Empty>(DirectionsOutcomeClassifier.classifyWalk(Result.success(null)))
        // 게이트: 404는 키 미등록 → 섹션 미노출(오류로 낭독 금지)
        assertTrue(DirectionsOutcomeClassifier.classifyWalk(badStatus(404)).isGated)
        // 조회 실패: 502·네트워크 오류
        assertIs<DirectionsModeOutcome.Error>(DirectionsOutcomeClassifier.classifyWalk(badStatus(502, "실패")))
        assertIs<DirectionsModeOutcome.Error>(DirectionsOutcomeClassifier.classifyWalk(Result.failure(APIError.Network(IOException("timed out")))))
    }

    @Test fun transitAndCarClassifyGateAndSuccess() {
        // 실계약: transit·car는 키 없음 → 503(walk의 404와 다름)
        assertTrue(DirectionsOutcomeClassifier.classifyTransit(badStatus(503)).isGated)
        assertTrue(DirectionsOutcomeClassifier.classifyCar(badStatus(503)).isGated)
        // 분류기는 코드로만 판정하므로 404도 여전히 게이트(수단 불문 공통 규칙)
        assertTrue(DirectionsOutcomeClassifier.classifyTransit(badStatus(404)).isGated)
        assertTrue(DirectionsOutcomeClassifier.classifyCar(badStatus(404)).isGated)
        // 회귀: 기존 non-null 성공 경로는 값까지 그대로 보존
        val transit = assertIs<DirectionsModeOutcome.Transit>(DirectionsOutcomeClassifier.classifyTransit(Result.success(transitFixture())))
        assertEquals("길동", transit.result.recommended.summary.departName)
        assertTrue(DirectionsOutcomeClassifier.classifyCar(Result.success(carFixture())).isSuccess)
        assertIs<DirectionsModeOutcome.Error>(DirectionsOutcomeClassifier.classifyCar(badStatus(500)))
    }

    /** Result에 담긴 취소는 분류하지 않고 다시 던진다 — 떠난 조회가 "조회 실패"로 커밋되지 않는다(Kotlin 고유). */
    @Test fun cancellationInResultIsRethrownNotClassified() {
        assertFailsWith<CancellationException> { DirectionsOutcomeClassifier.classifyWalk(Result.failure(CancellationException("left"))) }
        assertFailsWith<CancellationException> { DirectionsOutcomeClassifier.classifyCar(Result.failure(CancellationException("left"))) }
    }

    /** envelope result null(ODsay graceful) = 경로 없음(3-state, 조회 실패 아님, walk와 동형). */
    @Test fun transitClassifiesNullResultAsEmpty() {
        assertIs<DirectionsModeOutcome.Empty>(DirectionsOutcomeClassifier.classifyTransit(Result.success(null)))
    }

    @Test fun gatedModeIsNotDisplayed() {
        val results = DirectionsResults(
            mapOf(
                DirectionsMode.transit to DirectionsModeOutcome.Gated,
                DirectionsMode.walk to DirectionsModeOutcome.Empty,
                DirectionsMode.car to DirectionsModeOutcome.Car(carFixture()),
            ),
        )
        assertEquals(listOf(DirectionsMode.car, DirectionsMode.walk), results.displayedModes) // 게이트는 섹션 자체 미노출
        assertEquals(DirectionsMode.car, results.firstSuccess) // empty는 성공 아님
        assertEquals(1, results.successCount)
    }

    /** E11 동적 순서: 성공(자동차·도보)이 앞, 실패(대중교통)가 뒤. walkFixture는 15분이라 30분 이하 승격으로 도보가 맨 앞. */
    @Test fun firstSuccessFollowsDynamicOrder() {
        val results = DirectionsResults(
            mapOf(
                DirectionsMode.transit to DirectionsModeOutcome.Error,
                DirectionsMode.walk to DirectionsModeOutcome.Walk(walkFixture()),
                DirectionsMode.car to DirectionsModeOutcome.Car(carFixture()),
            ),
        )
        assertEquals(listOf(DirectionsMode.walk, DirectionsMode.car, DirectionsMode.transit), results.displayedModes)
        assertEquals(DirectionsMode.walk, results.firstSuccess) // 새 순서의 첫 성공이 포커스 목적지
        assertEquals(2, results.successCount)
    }

    @Test fun allFailedHasNoFocusTarget() {
        val results = DirectionsResults(mapOf(DirectionsMode.transit to DirectionsModeOutcome.Error, DirectionsMode.car to DirectionsModeOutcome.Error))
        assertNull(results.firstSuccess) // 성공 0건이면 포커스 이동 없음(통지만)
        assertEquals(0, results.successCount)
        assertEquals(listOf(DirectionsMode.transit, DirectionsMode.car), results.displayedModes) // 미조회 수단은 미노출
    }

    /** 서버 마커(spec 2026-07-29): 좌표가 서비스 지역 밖일 때 3수단 전부 같은 방식으로 분류. */
    @Test fun outOfCoverageClassifiesAcrossAllModes() {
        val failure = Result.failure<Nothing>(APIError.OutOfCoverage)
        assertTrue(DirectionsOutcomeClassifier.classifyTransit(failure).isOutOfCoverage)
        assertTrue(DirectionsOutcomeClassifier.classifyWalk(failure).isOutOfCoverage)
        assertTrue(DirectionsOutcomeClassifier.classifyCar(failure).isOutOfCoverage)
        // outOfCoverage는 성공도 게이트도 아니다(3-state 뭉개기 금지).
        assertFalse(DirectionsOutcomeClassifier.classifyTransit(failure).isSuccess)
        assertFalse(DirectionsOutcomeClassifier.classifyTransit(failure).isGated)
    }

    /** 화면 모델이 정상적으로는 outOfCoverage를 만나면 화면 전체를 전환하지만, 개별 수단 렌더에서도 게이트와 동형으로 제외된다. */
    @Test fun outOfCoverageModeIsNotDisplayed() {
        val results = DirectionsResults(
            mapOf(
                DirectionsMode.transit to DirectionsModeOutcome.OutOfCoverage,
                DirectionsMode.walk to DirectionsModeOutcome.Empty,
                DirectionsMode.car to DirectionsModeOutcome.Car(carFixture()),
            ),
        )
        assertEquals(listOf(DirectionsMode.car, DirectionsMode.walk), results.displayedModes)
        assertEquals(DirectionsMode.car, results.firstSuccess)
        assertEquals(1, results.successCount)
    }

    // E11 섹션 동적 순서 — 웹 공유 fixture 동조

    @Serializable
    private data class OrderScenarios(val order: List<OrderCase>) {
        @Serializable
        data class OrderCase(val name: String, val modes: List<String>, val success: Map<String, Boolean>, val walkDurationSeconds: Int? = null, val expect: List<String>)
    }

    @Test fun orderMatchesWebFixture() {
        val cases = Fixtures.sharedJson("directions-order-scenarios.json", OrderScenarios.serializer()).order
        // ⚠ 공회전 방지: 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        assertTrue(cases.size >= 9)
        for (c in cases) {
            val modes = c.modes.mapNotNull(DirectionsMode::fromRawValue)
            assertEquals(c.modes.size, modes.size, "${c.name}: 미지의 수단")
            val got = DirectionsOrder.orderModes(modes, isSuccess = { c.success[it.rawValue] == true }, walkDurationSeconds = c.walkDurationSeconds)
            assertEquals(c.expect, got.map { it.rawValue }, c.name)
        }
    }

    /** 30분 판정은 웹과 같은 반올림(분 값 > 30). */
    @Test fun walkCollapseMirrorsWeb() {
        assertTrue(WalkCollapse.shouldCollapse(31 * 60))
        assertFalse(WalkCollapse.shouldCollapse(30 * 60))
        assertFalse(WalkCollapse.shouldCollapse(30 * 60 + 1))
        assertTrue(WalkCollapse.shouldCollapse(30 * 60 + 31))
        // x.5 경계는 올림(Swift `rounded()`): 30분 30초 → 31분 → 접힘.
        assertTrue(WalkCollapse.shouldCollapse(30 * 60 + 30))
    }

    /** replacingWalk는 outcome만 바꾸고 순서를 보존한다. */
    @Test fun replacingWalkPreservesOrder() {
        // 도보 empty로 settled → 순서 확정. 전 수단 비성공이라 현행 고정 순서.
        val initial = DirectionsResults(
            mapOf(DirectionsMode.transit to DirectionsModeOutcome.Empty, DirectionsMode.car to DirectionsModeOutcome.Error, DirectionsMode.walk to DirectionsModeOutcome.Empty),
        )
        assertEquals(listOf(DirectionsMode.transit, DirectionsMode.car, DirectionsMode.walk), initial.orderedModes)
        // 계단 회피 재조회로 도보가 15분 성공이 되어도 순서는 스냅샷 그대로(spec §2 규칙 3).
        val updated = initial.replacingWalk(DirectionsModeOutcome.Walk(walkFixture()))
        assertEquals(listOf(DirectionsMode.transit, DirectionsMode.car, DirectionsMode.walk), updated.orderedModes)
        assertEquals(true, updated.outcomes[DirectionsMode.walk]?.isSuccess)
        // 파생값은 새 outcome을 본다: 유일한 성공인 도보가 첫 성공.
        assertEquals(DirectionsMode.walk, updated.firstSuccess)
        assertEquals(1, updated.successCount)
    }

    /** 새 조회(생성)는 순서를 다시 계산한다 — 30분 이하 도보 최상단. */
    @Test fun initPromotesWalkableWalk() {
        val results = DirectionsResults(mapOf(DirectionsMode.transit to DirectionsModeOutcome.Empty, DirectionsMode.walk to DirectionsModeOutcome.Walk(walkFixture())))
        assertEquals(listOf(DirectionsMode.walk, DirectionsMode.transit), results.orderedModes)
        assertEquals(listOf(DirectionsMode.walk, DirectionsMode.transit), results.displayedModes)
        assertEquals(DirectionsMode.walk, results.firstSuccess)
    }

    /** 경유지(N4): 대중교통은 호출하지 않고 UnsupportedWaypoint — 성공이 아니지만 섹션은 남아 사유를 말한다. */
    @Test fun unsupportedWaypointIsDisplayedButNotSuccess() {
        val results = DirectionsResults(mapOf(DirectionsMode.transit to DirectionsModeOutcome.UnsupportedWaypoint, DirectionsMode.car to DirectionsModeOutcome.Car(carFixture())))
        assertEquals(listOf(DirectionsMode.car, DirectionsMode.transit), results.displayedModes)
        assertEquals(1, results.successCount)
        assertFalse(DirectionsModeOutcome.UnsupportedWaypoint.isSuccess)
        assertFalse(DirectionsModeOutcome.UnsupportedWaypoint.isGated)
    }

    @Test fun modeRawValuesAndDisplayOrder() {
        assertEquals(listOf("transit", "walk", "car"), DirectionsMode.entries.map { it.rawValue })
        assertEquals(listOf(DirectionsMode.transit, DirectionsMode.car, DirectionsMode.walk), DirectionsMode.displayOrder)
    }
}
