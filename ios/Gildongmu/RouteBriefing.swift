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
    /// 경유지 라벨(N4) — `WalkRouteRows.waypointLabel` 동형.
    var waypointLabel: String? = nil

    var body: some View {
        // 통행료 0원은 생략(잉여)
        distanceText(joinText(
            appLocalized("ios.route.totalDistance", formatDistance(briefing.distanceMeters)),
            appLocalized("ios.route.durationMinutes", String(briefing.durationSeconds / 60)),
            appLocalized("ios.route.taxiFare", wonText(briefing.taxiFare)),
            briefing.tollFare > 0 ? appLocalized("ios.route.tollFare", wonText(briefing.tollFare)) : nil))
        ForEach(Array(briefing.guides.enumerated()), id: \.offset) { index, guide in
            if let waypoint = briefing.waypoint, index == waypoint.stepIndex, let waypointLabel {
                Text(appLocalized("directions.viaArrived", waypointLabel))
            }
            // guidance(완성 안내문)가 정본, 비면 name 폴백, 둘 다 비면 행 생략
            let text = guide.guidance.isEmpty ? guide.name : guide.guidance
            if !text.isEmpty {
                // ⚠ 종전의 미터 직접 조립(보간+m)은 1km 넘는 구간(고속도로)이 "1234m"로
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
    /// 마지막 도보 구간이 가리킬 목적지 이름(spec §4.3). 모르면 nil이고,
    /// 그때도 "목적지까지"라는 구간 의미는 알기 때문에 문구가 사라지지 않는다.
    var destinationName: String?

    var body: some View {
        if includeSummary {
            Text(transitSummaryText(route.summary))
        }
        ForEach(Array(route.legs.enumerated()), id: \.offset) { _, leg in
            // 도보 구간이 거리를 싣게 되면서 이 행에도 "178m"가 들어온다.
            // VoiceOver가 숫자 뒤 m을 minutes로 오독하므로 낭독만 풀어 쓴다.
            distanceText(transitLegText(leg, destinationName: destinationName))
            // 빠른하차(E5)는 별도 문장이라 같은 Text에 합치지 않는다 — 합치면 한 줄이
            // 길어지고, 나누면 스와이프 한 번에 "무슨 열차"와 "몇 번 문"이 갈린다.
            // 값이 없으면 행 자체가 없다(3-state: 문구를 만들지 않는다).
            if let text = quickExitText(leg.quickExit, station: leg.toName ?? "", lang: AppLanguage.current) {
                Text(text)
            }
        }
    }
}

/// 대안 경로의 표시 이름(spec §4.1). 축 판정은 서버가 끝냈고 Kit이 키를 고른다.
///
/// ⚠ Kit이 돌려준 키를 그대로 `appLocalized(변수)`로 넘기지 않는다.
///   `check-xcstrings-keys.mjs`는 **문자열 리터럴만** 스캔하므로 변수 키는 카탈로그
///   대조에서 통째로 빠지고, 키가 없으면 VoiceOver가 키 문자열을 그대로 낭독한다.
///   리터럴로 되받는 이 스위치가 그 게이트를 살려 둔다.
func transitAlternativeName(_ route: TransitRoute) -> String {
    let resolved = TransitAlternativeName.key(
        highlight: route.highlight, displayIndex: route.displayIndex)
    switch resolved.key {
    case "route.transit.alternativeFastestFewestTransfers":
        return appLocalized("route.transit.alternativeFastestFewestTransfers")
    case "route.transit.alternativeFewestTransfers":
        return appLocalized("route.transit.alternativeFewestTransfers")
    case "route.transit.alternativeFastest":
        return appLocalized("route.transit.alternativeFastest")
    default:
        return appLocalized("route.transit.alternativeHeading", String(resolved.index ?? 1))
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

/// 구간 한 줄 = 한 접근성 객체. 도보 구간은 행선지·거리 유무로 문구가 갈린다(spec §4.3).
func transitLegText(_ leg: TransitRouteLeg, destinationName: String? = nil) -> String {
    if leg.mode == "walk" {
        // 마지막 도보에는 행선지가 없다(provider가 목적지 이름을 모른다). 소비자가
        // 목적지 이름을 알면 그것을 쓰고, 몰라도 "목적지까지"라는 구간 의미는 남긴다
        // (이름 부재와 구간 의미 부재는 다른 층이다).
        let name = [leg.toName, destinationName].compactMap { $0 }.first { !$0.isEmpty }
        // 거리는 3-state: 필드가 없으면 "0m"가 아니라 거리 없는 문구로 떨어진다.
        // 조립은 formatDistance 정본을 지난다(소수 km 직접 조립 금지).
        // 키·인자 순서 판정은 Kit `TransitWalkLegText`(테스트가 잠근다, D8). 아래
        // switch는 키 → 리터럴 조회의 항등 매핑이다(키 린터 계약: 리터럴 호출만).
        let resolved = TransitWalkLegText.resolve(
            name: name, distance: leg.distanceMeters.map(formatDistance), minutes: leg.minutes)
        switch resolved.key {
        case "route.transit.legWalkTo":
            return appLocalized("route.transit.legWalkTo", arguments: resolved.args)
        case "route.transit.legWalkToNoDistance":
            return appLocalized("route.transit.legWalkToNoDistance", arguments: resolved.args)
        case "route.transit.legWalkToDest":
            return appLocalized("route.transit.legWalkToDest", arguments: resolved.args)
        case "route.transit.legWalkToDestNoDistance":
            return appLocalized("route.transit.legWalkToDestNoDistance", arguments: resolved.args)
        default:
            // Kit이 키를 늘렸는데 여기 case가 빠진 것 — 문자열 switch라 컴파일러가 못
            // 잡으므로 디버그에서 즉시 드러내고, 릴리스는 키를 그대로 노출해 침묵을 피한다.
            assertionFailure("TransitWalkLegText 키 미매핑: \(resolved.key)")
            return resolved.key
        }
    }
    // ko는 두 키가 같은 "정거장"이라 분기가 무의미해 보이지만 지우지 말 것 —
    // en(stops/stations)·ja(バス停/駅)는 수단별로 단어가 갈린다.
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
    // 버스 번호는 그대로면 "370"이라 무엇인지 알 수 없다(지하철은 "수도권 5호선"이라
    // 수단이 드러난다). 웹 키를 공유한다 — iOS 전용 사본은 카탈로그 재생성 때 소멸한다.
    // ⚠ 빈 문자열을 없음으로 접는다: 웹은 falsy 검사가 이미 걸러내는데 Swift `.map`은
    // ""도 값으로 통과시켜 **iOS만 "번 버스"**를 낸다(ODsay busNo 결측 시 계약 이탈).
    let lineName = leg.lineName?.trimmingCharacters(in: .whitespaces)
    let lineText = (lineName?.isEmpty == false ? lineName : nil).map {
        leg.mode == "bus" ? appLocalized("route.transit.busNo", $0) : $0
    }
    return joinText(
        lineText,
        leg.fromName.map { appLocalized("ios.route.board", $0) },
        leg.toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map { String(format: countKey, String($0)) },
        appLocalized("ios.route.legMinutes", String(leg.minutes)),
        serviceOutside)
}

/// 도보 상세를 접고 시작하는 문턱(분, 위원장 판정 2026-08-07). 잘못 접은 비용은
/// 스와이프 1회이고 잘못 펼친 비용은 수백 행이라, 비대칭이 이 방향을 정한다.
let walkCollapseThresholdMinutes = 30

/// 도보 요약의 표시 분(초를 반올림). ⚠ 접힘 문턱 판정도 **이 값**으로 한다.
/// 판정과 표시가 다른 값을 쓰면 경계에서 "약 30분인데 접혔다"가 생긴다(spec §4.4).
func walkDisplayMinutes(_ briefing: WalkRouteBriefing) -> Int {
    Int((Double(briefing.durationSeconds) / 60).rounded())
}

/// 도보 요약 한 줄. 거리 표기는 `formatDistance` 정본에 맡긴다. 종전엔 여기서
/// 소수 km를 직접 조립해(문구가 `{distanceKm}km`였다) 같은 화면의 다른 거리와
/// 표기가 갈렸고, 1km 미만 도보 경로가 "0.8km"로 낭독됐다.
func walkSummaryText(_ briefing: WalkRouteBriefing) -> String {
    appLocalized("route.pedestrian.summary",
        formatDistance(briefing.distanceMeters),
        String(walkDisplayMinutes(briefing)))
}

/// 도보 결과 행들(요약 1행+step들). 웹 WalkRouteResult 미러: step description
/// 완성 문장이 낭독 정본(서버 `rewriteWalkGuidance`가 만든다 — 클라 재조합 금지),
/// 빈 문장은 행 생략.
struct WalkRouteRows: View {
    let briefing: WalkRouteBriefing
    /// 접힘 라벨이 이미 요약이면 본문에서 반복하지 않는다(대안 disclosure 동형).
    var includeSummary = true
    /// 라벨이 stepFreeNotice를 병기하는 소비자(M3 2행 disclosure)는 서버가 비기하
    /// 응답 스텝 0번에 삽입한 같은 문장을 본문에서 생략한다 — 라벨·본문 이중 낭독
    /// 방지(a11y 감사 2026-08-12). 번호는 원본 인덱스 유지(웹·CLI와 같은 값 계약).
    var omitNoticeStep = false
    /// 경유지 라벨(N4). `briefing.waypoint.stepIndex` 앞에 "경유지 {label} 도착" 구획 행을
    /// 그린다(웹 `StepList`·CLI와 같은 구획 문장, 번호 없는 평문 — 스텝 번호는 원본 인덱스).
    /// 서버는 라벨을 모르므로 호출부(폼 상태)가 준다. nil이면 행을 그리지 않는다.
    var waypointLabel: String? = nil

    var body: some View {
        if includeSummary {
            distanceText(walkSummaryText(briefing))
        }
        ForEach(Array(briefing.steps.enumerated()), id: \.offset) { index, step in
            if let waypoint = briefing.waypoint, index == waypoint.stepIndex, let waypointLabel {
                Text(appLocalized("directions.viaArrived", waypointLabel))
            }
            if !step.description.isEmpty,
               !(omitNoticeStep && index == 0
                   && step.description == briefing.stepFreeNotice) {
                // 단계 번호는 웹(<ol>)·CLI("1. ")에 이미 있고 iOS만 없었다. 서로 닮은
                // 문장이 십수 개 이어져 커서를 놓치면 복귀 지점을 찾을 단서가 없다.
                // 번호는 표시 순서가 아니라 **원본 인덱스**라 세 소비자가 같은 값을 쓴다.
                // 서버 안내문 속 "244m 이동"도 같은 오독 대상이라 낭독만 풀어 쓴다
                distanceText("\(index + 1). \(step.description)")
            }
        }
    }
}
