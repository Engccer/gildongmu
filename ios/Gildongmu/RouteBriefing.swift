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
    /// 지하철역 로터 진입점(E45) — 대상 역을 받아 상세를 여는 소비자의 동작. **기본은 꺼짐**이다.
    ///
    /// 켜는 것은 push 스택이 있는 소비자(길찾기 탭)뿐이다. 안내 조망의 "다른 경로" 후보 목록도 같은
    /// 이 뷰를 쓰지만 그 화면엔 `navigationDestination`이 없어 액션이 서도 **아무 일도 일어나지 않는다**
    /// — 스크린 리더 사용자에게 무반응 액션은 진단할 수 없는 고장이다. 미리 조회가 후보마다 도는 것과
    /// "시트 안 장소 상세는 닫기 버튼 필수"(E33) 우회도 같은 기본값이 막는다.
    ///
    /// ⚠ spec은 이 자리를 `Bool`로 적었지만 push 클로저가 함께 있어야 액션이 실제로 동작한다. 둘을 나눠
    ///   두면 "켜졌는데 클로저가 없다" = 무반응 액션이라는 조합이 생기고, 그것이 정확히 이 옵트인이
    ///   막으려던 결함이다. 하나로 합치면 그 조합이 구조적으로 불가능해진다.
    var stationEntry: ((TransitLegStop, String?) -> Void)?

    var body: some View {
        if includeSummary {
            Text(transitSummaryText(route.summary))
        }
        ForEach(Array(route.legs.enumerated()), id: \.offset) { index, leg in
            // 도보 구간이 거리를 싣게 되면서 이 행에도 "178m"가 들어온다.
            // VoiceOver가 숫자 뒤 m을 minutes로 오독하므로 낭독만 풀어 쓴다.
            // en 계열은 서버 영문(`*En`, E27)으로 — 시각은 `Gangnam (강남)` 병기, 낭독은 영문만(한 줄 한 객체).
            // 영문이 모자란 구간은 통째로 한국어(줄 단위 원자성).
            stationRow(leg.mode == "walk" ? .walk(legIndex: index) : .transit(legIndex: index)) {
                transitLegRow(route.legs, at: index, destinationName: destinationName)
            }
            // 하차 줄(빠른하차 E5 + 하차 출구 E25)은 별도 문장이라 같은 Text에 합치지 않는다 —
            // 합치면 한 줄이 길어지고, 나누면 스와이프 한 번에 "무슨 열차"와 "어디로 내려 나가나"가
            // 갈린다. 둘 다 없으면 행 자체가 없다(3-state: 문구를 만들지 않는다).
            // 역명은 구간 줄과 같은 영어 자격을 따른다(Kit `transitLegUsesEnglish`) — 구간 줄이 한국어면
            // 하차 줄도 한국어 역명이다(줄 단위 원자성, E27). `toName`을 직접 읽지 말 것.
            if let text = alightLineText(
                leg.quickExit,
                station: transitAlightStationName(leg, lang: AppLanguage.dataLocaleValue),
                exitAlight: leg.exit?.alight,
                lang: AppLanguage.current,
                // 출구 문구 정본은 안내 세션과 같은 키다(Kit 카탈로그 밖이라 앱이 조회한다).
                exitBound: { appLocalized("transitGuide.exitBound", $0) })
            {
                stationRow(.alight(legIndex: index)) { Text(text) }
            }
        }
    }

    /// 줄에 역 진입점을 얹는다(E45). 옵트인이 꺼져 있거나 대상 역이 없으면 줄은 종전 그대로다 —
    /// 뷰 종류는 어느 경우에도 같은 `Text`이고 로터 액션만 늘어난다(spec §3.3).
    @ViewBuilder
    private func stationRow<Content: View>(
        _ row: TransitBriefingRow, @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        if let onOpen = stationEntry {
            let actions = briefingStationActions(route.legs, row: row)
            if actions.isEmpty {
                content()
            } else {
                BriefingStationRow(actions: actions, onOpen: onOpen, content: content)
            }
        } else {
            content()
        }
    }
}

/// 브리핑 줄에 달릴 역 액션 하나 — Kit 판정(대상 역·노선 힌트)에 **그 줄의 언어로 고른 표시 이름**을 얹는다.
struct BriefingStationAction: Hashable {
    let stop: TransitLegStop
    /// 전화번호 조회 노선 힌트. 표가 모르는 노선이면 `StationPhoneStore`가 "없음"으로 즉답한다.
    let lineName: String?
    /// 라벨에 쓸 역 이름.
    let name: String
}

/// 그 줄의 역 액션들(E45 spec §3.2·§6). 대상 역은 Kit이 이름 조인으로 고르고, 여기서는 라벨 이름의
/// 언어만 정한다.
///
/// ⚠ 이름의 언어는 **그 줄이 쓴 언어**다(앱 언어가 아니다). 앱 언어로 고르면 줄은 한국어인데 라벨은
///   로마자가 되어 같은 역이 한 화면에서 두 언어로 들린다. 술어는 구간 줄·하차 줄이 쓰는 것과 같은
///   하나이므로(`transitLegUsesEnglish`) 줄이 한국어로 떨어지면 라벨도 함께 떨어진다.
func briefingStationActions(
    _ legs: [TransitRouteLeg], row: TransitBriefingRow
) -> [BriefingStationAction] {
    let stations = transitBriefingStations(legs, row: row)
    guard !stations.isEmpty else { return [] }
    let legIndex: Int
    switch row {
    case .walk(let index), .transit(let index), .alight(let index): legIndex = index
    }
    let usesEnglish = transitLegUsesEnglish(legs[legIndex], lang: AppLanguage.dataLocaleValue)
    return stations.map { station in
        let english = usesEnglish ? station.stop.nameEn.flatMap { $0.isEmpty ? nil : $0 } : nil
        return BriefingStationAction(
            stop: station.stop, lineName: station.lineName, name: english ?? station.stop.name)
    }
}

/// 역 로터를 든 브리핑 줄(E45). **저장소는 이 하위 뷰만 관찰한다** — 전화 라벨이 직통·대표번호로 갈리므로
/// 계산이 `phoneStore.result`를 읽어야 하는데, 그 읽기가 `TransitRouteRows` 본문에 있으면 번호 도착·30초
/// 재확인·6분 축출마다 브리핑 **전체**가 다시 그려진다(E44가 리뷰 M5로 명시적으로 피한 것).
///
/// 줄 뷰는 그대로 내보내고 로터만 얹는다 — 역 개수는 액션 수만 정하고 뷰 종류를 정하지 않는다.
private struct BriefingStationRow<Content: View>: View {
    let actions: [BriefingStationAction]
    let onOpen: (TransitLegStop, String?) -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.openURL) private var openURL
    private let phoneStore = StationPhoneStore.shared

    /// 로터 한 줄 — 라벨과 동작.
    private struct RotorItem: Identifiable {
        let id: String
        let label: String
        let action: () -> Void
    }

    var body: some View {
        content()
            // ⚠ 선언은 **역순**이다: VoiceOver 로터가 빌더 선언의 역순으로 노출된다(PlaceRow·채팅·E33 실측).
            //   역별 묶음 안의 (상세 → 전화) 순서도 함께 뒤집혀야 "A 상세 → A 전화 → B 상세 → B 전화"로 들린다.
            .accessibilityActions {
                ForEach(rotorItems) { item in
                    Button(item.label, action: item.action)
                }
            }
            // 줄이 떠 있는 동안 `recheckSeconds`마다 다시 부른다 — 저장소는 갱신되지 않은 값을 6분에 지우고,
            // 브리핑은 출발 전에 오래 머무는 화면이라 그 시간을 넘기는 것이 평범한 사용이다. 신선하면
            // 네트워크 없이 돌아오고, 같은 키 중복은 저장소가 막는다.
            // ⚠ `leg.stops` 전체가 아니라 **이 줄의 역만** 넘긴다(줄당 최대 2건, spec §5.2).
            .task(id: taskKey) {
                while !Task.isCancelled {
                    for action in actions {
                        phoneStore.prefetch(stops: [action.stop], lineName: action.lineName ?? "")
                    }
                    try? await Task.sleep(for: .seconds(StationPhoneStore.recheckSeconds))
                }
            }
    }

    private var taskKey: String {
        actions.map { "\($0.stop.name)|\($0.lineName ?? "")" }.joined(separator: ",")
    }

    private var rotorItems: [RotorItem] {
        let ordered = actions.flatMap { station -> [RotorItem] in
            let key = "\(station.stop.name)|\(station.lineName ?? "")"
            return [
                RotorItem(
                    id: "open|\(key)",
                    label: appLocalized("transitGuide.openStation", station.name),
                    action: { onOpen(station.stop, station.lineName) }),
                RotorItem(
                    id: "call|\(key)",
                    label: callLabel(station),
                    action: { call(station) }),
            ]
        }
        return ordered.reversed()
    }

    /// **라벨만** 상태로 갈린다. 액션의 존재는 갈리지 않는다 — 번호 없음·조회 중·실패를 액션 부재로 뭉개면
    /// 3상태가 사라지고, 로터를 열어 둔 사이 목록 길이가 변한다(spec 판정 ④).
    private func callLabel(_ station: BriefingStationAction) -> String {
        switch phoneStore.result(
            stationName: station.stop.name, lat: station.stop.lat, lng: station.stop.lng,
            lineName: station.lineName ?? ""
        ) {
        case .representative?:
            return appLocalized("transitGuide.callStationRepresentative", station.name)
        default:
            return appLocalized("transitGuide.callStation", station.name)
        }
    }

    private func call(_ station: BriefingStationAction) {
        callStationPhone(
            stationName: station.stop.name, lat: station.stop.lat, lng: station.stop.lng,
            lineName: station.lineName ?? "", openURL: openURL)
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
        appLocalized("ios.route.transfers", summary.transfers),
        // 도보 0분은 생략(웹 TransitRouteResult의 walkMinutes > 0 조건 동형)
        summary.walkMinutes > 0 ? appLocalized("ios.route.walkMinutes", String(summary.walkMinutes)) : nil)
}

/// 구간 행 — 시각 문자열과 낭독 문자열이 갈릴 수 있어(병기) `distanceText` 대신 직접 라벨을 단다.
@MainActor
func transitLegRow(_ legs: [TransitRouteLeg], at index: Int, destinationName: String?) -> some View {
    let line = transitLegLine(legs, at: index, destinationName: destinationName)
    return Text(line.visual).accessibilityLabel(Text(spokenUnits(line.spoken)))
}

/// 구간 문장 (시각, 낭독). ko·영문 부재는 둘이 같다. en은 노선·승차·하차(도보는 행선지)가 **다** 영문일 때만
/// 영어 문장이고 역명은 괄호 병기(시각 전용) — 하나라도 없으면 한국어 문장(`transitLegText`).
func transitLegLine(_ legs: [TransitRouteLeg], at index: Int, destinationName: String? = nil) -> (visual: String, spoken: String) {
    let leg = legs[index]
    // 승차 출구(E25)는 두 줄 중 **하나만** 싣는다(Kit 술어 둘이 배타) — 도보 줄이면 행선지 문구
    // 안으로, 앞 도보가 없으면 이 탑승 줄 끝으로.
    let boardExit = leg.mode == "walk" ? boardExitAfterWalk(legs, at: index) : boardExitOnBoardLine(legs, at: index)
    let ko = transitLegText(leg, destinationName: destinationName, boardExit: boardExit)
    // 영어 자격은 Kit 술어 하나다 — 하차 줄(`TransitRouteRows`)이 같은 술어로 역명을 고른다.
    guard transitLegUsesEnglish(leg, lang: AppLanguage.dataLocaleValue) else { return (ko, ko) }
    if leg.mode == "walk" {
        let en = transitLegText(
            leg, destinationName: destinationName, names: .english(bilingual: false), boardExit: boardExit)
        return (en, en)
    }
    return (
        transitLegText(leg, destinationName: destinationName, names: .english(bilingual: true), boardExit: boardExit),
        transitLegText(leg, destinationName: destinationName, names: .english(bilingual: false), boardExit: boardExit)
    )
}

/// 구간 문장에 쓸 이름 선택 — `.korean`은 종전 문장 그대로, `.english`는 `*En`(병기 여부는 시각/낭독).
enum TransitLegNames {
    case korean
    case english(bilingual: Bool)
}

/// 구간 한 줄 = 한 접근성 객체. 도보 구간은 행선지·거리 유무로 문구가 갈린다(spec §4.3).
func transitLegText(
    _ leg: TransitRouteLeg, destinationName: String? = nil, names: TransitLegNames = .korean,
    /// 이 줄이 실을 승차 출구(E25) — 호출부가 배타 술어로 고른 값이고, 도보면 행선지 문구 안으로,
    /// 탑승이면 줄 끝으로 간다. 실을 것이 없으면 nil이고 문구는 종전 그대로다.
    boardExit: String? = nil
) -> String {
    /// 이름 하나 — 영문 모드면 `*En`(호출부가 존재를 보장), 병기면 `English (한글)`.
    func pick(_ ko: String?, _ en: String?) -> String? {
        switch names {
        case .korean: return ko
        case .english(let bilingual):
            guard let en else { return ko }
            // 병기 정본은 E28 `bilingualName`(한 줄 괄호, 낭독은 primary만) — roman은 ODsay 영문이 있어 nil.
            return bilingual ? bilingualName(lang: AppLanguage.current, ko: ko ?? en, en: en, roman: nil).display : en
        }
    }
    let fromName = pick(leg.fromName, leg.fromNameEn)
    let toName = pick(leg.toName, leg.toNameEn)
    let lineNameRaw: String? = {
        if case .english = names, let en = leg.lineNameEn { return en }
        return leg.lineName
    }()
    if leg.mode == "walk" {
        // 마지막 도보에는 행선지가 없다(provider가 목적지 이름을 모른다). 소비자가
        // 목적지 이름을 알면 그것을 쓰고, 몰라도 "목적지까지"라는 구간 의미는 남긴다
        // (이름 부재와 구간 의미 부재는 다른 층이다).
        let name = [toName, destinationName].compactMap { $0 }.first { !$0.isEmpty }
        // 거리는 3-state: 필드가 없으면 "0m"가 아니라 거리 없는 문구로 떨어진다.
        // 조립은 formatDistance 정본을 지난다(소수 km 직접 조립 금지).
        // 키·인자 순서 판정은 Kit `TransitWalkLegText`(테스트가 잠근다, D8). 아래
        // switch는 키 → 리터럴 조회의 항등 매핑이다(키 린터 계약: 리터럴 호출만).
        let resolved = TransitWalkLegText.resolve(
            name: name, distance: leg.distanceMeters.map(formatDistance), minutes: leg.minutes,
            boardExit: boardExit)
        switch resolved.key {
        case "route.transit.legWalkTo":
            return appLocalized("route.transit.legWalkTo", arguments: resolved.args)
        case "route.transit.legWalkToNoDistance":
            return appLocalized("route.transit.legWalkToNoDistance", arguments: resolved.args)
        case "route.transit.legWalkToExit":
            return appLocalized("route.transit.legWalkToExit", arguments: resolved.args)
        case "route.transit.legWalkToExitNoDistance":
            return appLocalized("route.transit.legWalkToExitNoDistance", arguments: resolved.args)
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
    // en(stops/stations)·ja(バス停/駅)는 수단별로 단어가 갈린다. 키마다 수량을 인자로
    // 직접 넘긴다(A29) — 포맷을 먼저 꺼내 두고 나중에 채우면 복수 블록 해석기를 우회한다.
    let countText: (Int) -> String = {
        leg.mode == "bus" ? appLocalized("ios.route.stopCount", $0) : appLocalized("ios.route.stationCount", $0)
    }
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
    let lineName = lineNameRaw?.trimmingCharacters(in: .whitespaces)
    let lineText = (lineName?.isEmpty == false ? lineName : nil).map {
        leg.mode == "bus" ? appLocalized("route.transit.busNo", $0) : $0
    }
    return joinText(
        lineText,
        fromName.map { appLocalized("ios.route.board", $0) },
        toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map(countText),
        appLocalized("ios.route.legMinutes", String(leg.minutes)),
        // 승차 출구 폴백(E25) — 앞 도보 줄이 없을 때만 값이 온다. 운행 밖 경고보다 앞이다.
        boardExit.map { appLocalized("route.transit.legBoardExit", $0) },
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
