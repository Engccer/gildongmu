import SwiftUI
import GildongmuKit

/// 경로 결과 행 렌더러(길찾기 탭 소비). 과거 장소 상세의 단독 브리핑 화면
/// 2종(자동차·대중교통)은 "여기까지 길찾기"(DirectionsTab 3수단 비교)와
/// 중복이라 제거(2026-07-30) — 행 렌더러만 남긴다. 실주행은 딥링크 위임 유지.
/// guidance·노선명·정류장명은 provider 한국어 원문이 낭독 정본, 행은 joinText 단일 텍스트.

/// 요금 천 단위 구분(예 22600 → "22,600")
private func wonText(_ amount: Int) -> String {
    amount.formatted(.number.grouping(.automatic))
}

/// 자동차 결과 행들(요약 1행+턴바이턴). 수단 heading은 소비 화면(길찾기 탭)이 소유.
struct CarRouteRows: View {
    let briefing: CarRouteBriefing

    var body: some View {
        // 통행료 0원은 생략(잉여)
        Text(joinText(
            appLocalized("ios.route.totalDistance", String(format: "%.1f", Double(briefing.distanceMeters) / 1000)),
            appLocalized("ios.route.durationMinutes", String(briefing.durationSeconds / 60)),
            appLocalized("ios.route.taxiFare", wonText(briefing.taxiFare)),
            briefing.tollFare > 0 ? appLocalized("ios.route.tollFare", wonText(briefing.tollFare)) : nil))
        ForEach(Array(briefing.guides.enumerated()), id: \.offset) { _, guide in
            // guidance(완성 안내문)가 정본, 비면 name 폴백, 둘 다 비면 행 생략
            let text = guide.guidance.isEmpty ? guide.name : guide.guidance
            if !text.isEmpty {
                Text(joinText(text, guide.distanceMeters > 0 ? "\(guide.distanceMeters)m" : nil))
            }
        }
    }
}

/// 대중교통 결과 행들(요약 1행+구간들). 소비 화면이 heading·섹션을 소유한다.
struct TransitRouteRows: View {
    let route: TransitRoute

    var body: some View {
        Text(transitSummaryText(route.summary))
        ForEach(Array(route.legs.enumerated()), id: \.offset) { _, leg in
            Text(transitLegText(leg))
        }
    }
}

func transitSummaryText(_ summary: TransitRouteSummary) -> String {
    joinText(
        appLocalized("ios.route.durationMinutes", String(summary.totalMinutes)),
        appLocalized("ios.route.fare", wonText(summary.fare)),
        appLocalized("ios.route.transfers", String(summary.transfers)),
        // 도보 0분은 생략(웹 TransitRouteResult의 walkMinutes > 0 조건 동형)
        summary.walkMinutes > 0 ? appLocalized("ios.route.walkMinutes", String(summary.walkMinutes)) : nil)
}

/// 구간 한 줄 = 한 접근성 객체. walk leg는 노선 정보가 없어 단일 분기(계약 테스트 근거)
func transitLegText(_ leg: TransitRouteLeg) -> String {
    if leg.mode == "walk" {
        return appLocalized("ios.route.walkMinutes", String(leg.minutes))
    }
    let countKey = leg.mode == "bus" ? appLocalized("ios.route.stopCount") : appLocalized("ios.route.stationCount")
    return joinText(
        leg.lineName,
        leg.fromName.map { appLocalized("ios.route.board", $0) },
        leg.toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map { String(format: countKey, String($0)) },
        appLocalized("ios.route.legMinutes", String(leg.minutes)))
}

/// 도보 결과 행들(요약 1행+step들). 웹 WalkRouteResult 미러: step description
/// 완성 문장이 낭독 정본(turnType 재조합 금지), 빈 문장은 행 생략.
struct WalkRouteRows: View {
    let briefing: WalkRouteBriefing

    var body: some View {
        Text(appLocalized("route.pedestrian.summary",
            String(format: "%.1f", Double(briefing.distanceMeters) / 1000),
            String(Int((Double(briefing.durationSeconds) / 60).rounded()))))
        ForEach(Array(briefing.steps.enumerated()), id: \.offset) { _, step in
            if !step.description.isEmpty {
                Text(step.description)
            }
        }
    }
}
