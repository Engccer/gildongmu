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
        distanceText(joinText(
            appLocalized("ios.route.totalDistance", formatDistance(briefing.distanceMeters)),
            appLocalized("ios.route.durationMinutes", String(briefing.durationSeconds / 60)),
            appLocalized("ios.route.taxiFare", wonText(briefing.taxiFare)),
            briefing.tollFare > 0 ? appLocalized("ios.route.tollFare", wonText(briefing.tollFare)) : nil))
        ForEach(Array(briefing.guides.enumerated()), id: \.offset) { _, guide in
            // guidance(완성 안내문)가 정본, 비면 name 폴백, 둘 다 비면 행 생략
            let text = guide.guidance.isEmpty ? guide.name : guide.guidance
            if !text.isEmpty {
                // ⚠ 종전 "\(m)m" 직접 조립은 1km 넘는 구간(고속도로)이 "1234m"로
                // 표기되던 결함이라 formatDistance 정본으로 교체.
                distanceText(joinText(text, guide.distanceMeters > 0 ? formatDistance(guide.distanceMeters) : nil))
            }
        }
    }
}

/// 대중교통 결과 행들(요약 1행+구간들). 소비 화면이 heading·섹션을 소유한다.
/// includeSummary=false는 대안 펼침 전용 — DisclosureGroup 라벨이 이미 요약이라
/// 본문에서 재낭독하지 않는다(인접 중복 금지, 웹 TransitRouteResult 동형).
struct TransitRouteRows: View {
    let route: TransitRoute
    var includeSummary = true

    var body: some View {
        if includeSummary {
            Text(transitSummaryText(route.summary))
        }
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
    // 운행 밖만 표기(정상·정보없음은 침묵). 별도 Text로 쪼개면 접근성 객체가 갈라지므로
    // joinText로 같은 한 줄에 합친다.
    var serviceOutside: String?
    if leg.serviceStatus == "outside",
       let first = leg.firstServiceTime, let last = leg.lastServiceTime {
        // 웹 정본 키를 그대로 쓴다. iOS 전용 사본(ios.route.serviceOutside)은 생성물인
        // 카탈로그에만 수기로 존재해 재생성 때 소멸하는 상태였다(2026-08-01 발견).
        serviceOutside = appLocalized("route.transit.legServiceOutside", first, last)
    }
    return joinText(
        leg.lineName,
        leg.fromName.map { appLocalized("ios.route.board", $0) },
        leg.toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map { String(format: countKey, String($0)) },
        appLocalized("ios.route.legMinutes", String(leg.minutes)),
        serviceOutside)
}

/// 도보 결과 행들(요약 1행+step들). 웹 WalkRouteResult 미러: step description
/// 완성 문장이 낭독 정본(turnType 재조합 금지), 빈 문장은 행 생략.
struct WalkRouteRows: View {
    let briefing: WalkRouteBriefing

    var body: some View {
        // 거리 표기는 `formatDistance` 정본에 맡긴다. 종전엔 여기서 소수 km를 직접
        // 조립해(문구가 `{distanceKm}km`였다) 같은 화면의 다른 거리와 표기가 갈렸고,
        // 1km 미만 도보 경로가 "0.8km"로 낭독됐다.
        distanceText(appLocalized("route.pedestrian.summary",
            formatDistance(briefing.distanceMeters),
            String(Int((Double(briefing.durationSeconds) / 60).rounded()))))
        ForEach(Array(briefing.steps.enumerated()), id: \.offset) { _, step in
            if !step.description.isEmpty {
                // 서버 안내문 속 "244m 이동"도 같은 오독 대상이라 낭독만 풀어 쓴다
                distanceText(step.description)
            }
        }
    }
}
