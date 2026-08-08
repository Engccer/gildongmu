import Testing
import Foundation
@testable import GildongmuKit

// 길찾기 도메인 테스트: 수단 4-state 분류(성공≠경로 없음≠실패≠게이트)와
// 표시 순서·성공 집계(포커스 목적지·합산 통지의 근거)를 고정한다.

private func walkFixture() -> WalkRouteBriefing {
    WalkRouteBriefing(
        distanceMeters: 1200, durationSeconds: 900,
        steps: [WalkRouteStep(description: "천호대로를 따라 119m 이동", distanceMeters: nil, pathCoords: nil)],
        stepFree: nil, stepFreeNotice: nil, finalApproach: nil)
}

private func transitFixture() -> TransitRouteResult {
    TransitRouteResult(
        recommended: TransitRoute(
            summary: TransitRouteSummary(
                totalMinutes: 30, fare: 1550, transfers: 1, walkMinutes: 8,
                departName: "길동", arriveName: "시청"),
            legs: [TransitRouteLeg(mode: "subway", lineName: "수도권 5호선", fromName: "길동", toName: "시청", stationCount: 10, minutes: 22,
                                   serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil)],
            routeKey: "p0"),
        alternatives: [], totalCandidates: 1)
}

private func carFixture() -> CarRouteBriefing {
    CarRouteBriefing(distanceMeters: 9000, durationSeconds: 1500, taxiFare: 12000, tollFare: 0, guides: [])
}

@Test func walkClassifiesFourStates() {
    // 성공: 브리핑 보존
    if case .walk(let briefing) = DirectionsOutcomeClassifier.classify(walk: .success(walkFixture())) {
        #expect(briefing.distanceMeters == 1200)
    } else { Issue.record("walk 성공이어야 함") }
    // 경로 없음: envelope result null(3-state, 실패 아님)
    if case .empty = DirectionsOutcomeClassifier.classify(walk: .success(nil)) {} else {
        Issue.record("result nil은 경로 없음이어야 함")
    }
    // 게이트: 404는 키 미등록 → 섹션 미노출(오류로 낭독 금지)
    #expect(DirectionsOutcomeClassifier.classify(walk: .failure(APIError.badStatus(code: 404, message: nil))).isGated)
    // 조회 실패: 502·네트워크 오류
    if case .error = DirectionsOutcomeClassifier.classify(walk: .failure(APIError.badStatus(code: 502, message: "실패"))) {} else {
        Issue.record("502는 조회 실패여야 함")
    }
    if case .error = DirectionsOutcomeClassifier.classify(walk: .failure(URLError(.timedOut))) {} else {
        Issue.record("네트워크 오류는 조회 실패여야 함")
    }
}

@Test func transitAndCarClassifyGateAndSuccess() {
    // 실계약: transit·car는 키 없음 → 503(hasOdsayKey/hasKakaoKey 미충족, walk의 404와 다름)
    #expect(DirectionsOutcomeClassifier.classify(transit: .failure(APIError.badStatus(code: 503, message: nil))).isGated)
    #expect(DirectionsOutcomeClassifier.classify(car: .failure(APIError.badStatus(code: 503, message: nil))).isGated)
    // 분류기는 코드로만 판정하므로 404도 여전히 게이트(수단 불문 공통 규칙)
    #expect(DirectionsOutcomeClassifier.classify(transit: .failure(APIError.badStatus(code: 404, message: nil))).isGated)
    #expect(DirectionsOutcomeClassifier.classify(car: .failure(APIError.badStatus(code: 404, message: nil))).isGated)
    // 회귀: 기존 non-null 성공 경로(TransitRouteResult? → .some)는 값까지 그대로 보존
    if case .transit(let result) = DirectionsOutcomeClassifier.classify(transit: .success(transitFixture())) {
        #expect(result.recommended.summary.departName == "길동")
    } else { Issue.record("transit 성공(non-null)이어야 함") }
    #expect(DirectionsOutcomeClassifier.classify(car: .success(carFixture())).isSuccess)
    if case .error = DirectionsOutcomeClassifier.classify(car: .failure(APIError.badStatus(code: 500, message: nil))) {} else {
        Issue.record("500은 조회 실패여야 함")
    }
}

@Test func transitClassifiesNullResultAsEmpty() {
    // envelope result null(ODsay graceful) = 경로 없음(3-state, 조회 실패 아님, walk와 동형)
    if case .empty = DirectionsOutcomeClassifier.classify(transit: .success(nil)) {} else {
        Issue.record("result nil은 경로 없음이어야 함")
    }
}

@Test func gatedModeIsNotDisplayed() {
    let results = DirectionsResults(outcomes: [
        .transit: .gated,
        .walk: .empty,
        .car: .car(carFixture()),
    ])
    #expect(results.displayedModes == [.car, .walk])  // 게이트는 섹션 자체 미노출
    #expect(results.firstSuccess == .car)             // empty는 성공 아님
    #expect(results.successCount == 1)
}

@Test func firstSuccessFollowsDisplayOrder() {
    let results = DirectionsResults(outcomes: [
        .transit: .error,
        .walk: .walk(walkFixture()),
        .car: .car(carFixture()),
    ])
    #expect(results.displayedModes == [.transit, .car, .walk])
    #expect(results.firstSuccess == .car)  // 고정 순서(대중교통→자동차→도보)의 첫 성공
    #expect(results.successCount == 2)
}

@Test func allFailedHasNoFocusTarget() {
    let results = DirectionsResults(outcomes: [.transit: .error, .car: .error])
    #expect(results.firstSuccess == nil)  // 성공 0건이면 포커스 이동 없음(통지만)
    #expect(results.successCount == 0)
    #expect(results.displayedModes == [.transit, .car])  // 미조회 수단(도보 en)은 미노출
}

@Test func outOfCoverageClassifiesAcrossAllModes() {
    // 서버 마커(spec 2026-07-29): 좌표가 서비스 지역 밖일 때 3수단 전부 같은 방식으로 분류.
    #expect(DirectionsOutcomeClassifier.classify(transit: .failure(APIError.outOfCoverage)).isOutOfCoverage)
    #expect(DirectionsOutcomeClassifier.classify(walk: .failure(APIError.outOfCoverage)).isOutOfCoverage)
    #expect(DirectionsOutcomeClassifier.classify(car: .failure(APIError.outOfCoverage)).isOutOfCoverage)
    // outOfCoverage는 성공도 게이트도 아니다(3-state 뭉개기 금지).
    #expect(!DirectionsOutcomeClassifier.classify(transit: .failure(APIError.outOfCoverage)).isSuccess)
    #expect(!DirectionsOutcomeClassifier.classify(transit: .failure(APIError.outOfCoverage)).isGated)
}

@Test func outOfCoverageModeIsNotDisplayed() {
    // DirectionsModel이 정상적으로는 outOfCoverage를 만나면 화면 전체를 전환해 여기 도달하지
    // 않지만, 방어적으로 개별 수단 렌더에서도 게이트와 동형으로 제외되어야 한다.
    let results = DirectionsResults(outcomes: [
        .transit: .outOfCoverage,
        .walk: .empty,
        .car: .car(carFixture()),
    ])
    #expect(results.displayedModes == [.car, .walk])
    #expect(results.firstSuccess == .car)
    #expect(results.successCount == 1)
}
