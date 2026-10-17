import SwiftUI
import GildongmuKit

/// 여정 조회 결과(E70 §5.2, 실험판). 읽기 순서: 못 찾음 줄 → (변형 둘이면) 변형 선택 버튼 둘 + 고른 변형의 제목(heading)
/// → 합계 → 택시 앞 → 대중교통 구간 → 출구 선택 → 안내 시작. 줄마다 한 접근성 객체(쉼표 결합)다.
/// heading은 고른 변형 제목 한 줄에만 둔다 — 선택 버튼에 heading을 달면 고르지 않은 변형의 제목 아래에 고른 변형의
/// 합계가 이어져 "heading = 뒤따르는 내용의 제목" 약속이 깨진다(접근성 감사 M2).
struct JourneyResultRows: View {
    let result: JourneyResult
    /// 사용자가 칸에 고른 역(제목이 "지정 역과 다른가"를 이 이름으로 가른다).
    let board: RecentStation?
    let alight: RecentStation?
    @Binding var variantIndex: Int
    @Binding var egressIndex: Int
    let destinationName: String?
    let destinationRoman: String?
    /// 안내 시작 버튼의 포커스 정체성 — 안내가 끝나 시트가 닫히면 길찾기 탭이 여기로 돌려보낸다(`landBeaconStartFocus`).
    let startFocus: AccessibilityFocusState<DirectionsTabView.GuideStartButton?>.Binding
    let onStart: (JourneyVariant, EgressOption?) -> Void

    private var variant: JourneyVariant {
        result.variants[min(variantIndex, result.variants.count - 1)]
    }

    private var egress: EgressOption? {
        guard let options = variant.egress?.options, !options.isEmpty else { return nil }
        return options[min(egressIndex, options.count - 1)]
    }

    var body: some View {
        ForEach(missingLines, id: \.self) { Text($0) }
        // 변형이 둘이면 선택 버튼 둘(선택 trait + 시각 체크) 뒤에 고른 변형의 제목 heading. 하나면 제목 없이 바로 합계(판정 13).
        if result.variants.count > 1 {
            ForEach(Array(result.variants.enumerated()), id: \.offset) { index, v in
                Button {
                    variantIndex = index
                    egressIndex = 0
                } label: {
                    selectableLabel(heading(v), selected: index == variantIndex)
                }
                .accessibilityAddTraits(index == variantIndex ? .isSelected : [])
            }
            Text(heading(variant))
                .accessibilityAddTraits(.isHeader)
        }
        Text(totalsLine)
        if let taxiIn = variant.taxiIn, let station = variant.boardStation {
            // 추천 경로가 버스로 시작하면 택시는 정류장 앞까지 간다 — 정류장 이름에 「역」을 붙이지 않는다(판정 5).
            if variant.boardsAtBusStop {
                Text(appLocalized("ios.journey.taxiInStop", station.name, minutesText(taxiIn), wonText(taxiIn.taxiFare)))
            } else {
                Text(appLocalized(
                    "ios.journey.taxiIn", journeyStationDisplayName(station.name), minutesText(taxiIn),
                    wonText(taxiIn.taxiFare)))
            }
        }
        TransitRouteRows(
            route: variant.transit, includeSummary: false,
            destinationName: destinationName, destinationRoman: destinationRoman)
        if let options = variant.egress?.options {
            if options.count > 1 {
                ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                    Button { egressIndex = index } label: {
                        selectableLabel(
                            egressLine(option, lookupFailed: variant.egress?.lookupFailed == true),
                            selected: index == egressIndex)
                    }
                    .accessibilityAddTraits(index == egressIndex ? .isSelected : [])
                }
            } else if let option = options.first {
                Text(egressLine(option, lookupFailed: variant.egress?.lookupFailed == true))
            }
        }
        Button(appLocalized("beacon.guideStartTransitAlt", heading(variant))) {
            onStart(variant, egress)
        }
        .accessibilityFocused(startFocus, equals: .journey)
    }

    /// 선택지 줄 — 고른 것은 시각 체크 표식(WCAG 1.4.1: 색·trait만으로 전하지 않는다). 표식은 낭독에서 숨기고 선택 trait가 정본이다.
    private func selectableLabel(_ text: String, selected: Bool) -> some View {
        HStack {
            Text(text)
            Spacer(minLength: 8)
            if selected {
                Image(systemName: "checkmark").accessibilityHidden(true)
            }
        }
    }

    private var lines: JourneyLineQualifiers { journeyLineQualifiers(result, board: board, alight: alight) }

    private func heading(_ v: JourneyVariant) -> String {
        journeyVariantHeading(v, board: board, alight: alight, lines: lines)
    }

    /// 판정 14: 지정 역 경로를 못 찾았다는 사실 한 줄(양쪽이면 두 줄, 새 문장 없음 — spec §3.2). 동명 이역이면 고른 역의
    /// 노선을 붙인다(판정 8).
    private var missingLines: [String] {
        guard let side = result.designatedMissing?.side else { return [] }
        let lines = lines
        let boardLine = board.map {
            appLocalized(
                "ios.journey.designatedMissing",
                lines.board ? journeyQualifiedStationName($0.label, line: $0.line) : journeyStationDisplayName($0.label))
        }
        let alightLine = alight.map {
            appLocalized(
                "ios.journey.designatedMissingAlight",
                lines.alight ? journeyQualifiedStationName($0.label, line: $0.line) : journeyStationDisplayName($0.label))
        }
        switch side {
        case .board: return [boardLine].compactMap { $0 }
        case .alight: return [alightLine].compactMap { $0 }
        case .both: return [boardLine, alightLine].compactMap { $0 }
        }
    }

    /// 합계는 서버가 기본 출구로 낸 값이다 — 다른 출구·승강장을 고르면 그 택시 구간만큼 바꿔 말한다.
    private var totalsLine: String {
        var minutes = variant.totals.minutes
        var taxiFare = variant.totals.taxiFare
        if let base = variant.egress?.options.first, let picked = egress {
            minutes += minutesOf(picked.taxiOut) - minutesOf(base.taxiOut)
            taxiFare += picked.taxiOut.taxiFare - base.taxiOut.taxiFare
        }
        return appLocalized(
            "ios.journey.totals", String(minutes), wonText(taxiFare), wonText(variant.totals.transitFare))
    }

    private func egressLine(_ option: EgressOption, lookupFailed: Bool) -> String {
        let minutes = minutesText(option.taxiOut)
        let fare = wonText(option.taxiOut.taxiFare)
        switch option.kind {
        case .exit: return appLocalized("ios.journey.egressExit", option.label, minutes, fare)
        case .stand: return appLocalized("ios.journey.egressStand", minutes, fare)
        case .none:
            return lookupFailed
                ? appLocalized("ios.journey.egressLookupFailed", minutes, fare)
                : appLocalized("ios.journey.egressNone", minutes, fare)
        }
    }
}

private func minutesOf(_ briefing: CarRouteBriefing) -> Int {
    Int((Double(briefing.durationSeconds) / 60).rounded())
}

private func minutesText(_ briefing: CarRouteBriefing) -> String { String(minutesOf(briefing)) }

/// 동명 이역 노선 머리말을 붙일 쪽(판정 8). 그 쪽의 지정 역 제목(또는 못 찾음 줄)과 추천 제목에 함께 붙는다.
struct JourneyLineQualifiers: Equatable {
    var board = false
    var alight = false
}

/// 추천 변형의 그 쪽 지하철 정류가 고른 역과 이름은 같고 노선이 다른가(Kit `journeyNeedsLineQualifier`). 고른 역의 노선은
/// 지정 역 경로가 있으면 그 탈것 노선, 없으면 칸의 노선 힌트다. 버스는 제목이 이미 「버스」를 말해 가를 필요가 없다.
func journeyLineQualifiers(_ result: JourneyResult, board: RecentStation?, alight: RecentStation?) -> JourneyLineQualifiers {
    guard let recommended = result.variants.first(where: { $0.kind == .recommended }) else { return .init() }
    let designated = result.variants.first { $0.kind == .designated }
    func vehicles(_ v: JourneyVariant?) -> [TransitRouteLeg] { v?.transit.legs.filter { $0.mode != "walk" } ?? [] }
    var out = JourneyLineQualifiers()
    if let board, let actual = vehicles(recommended).first, actual.mode != "bus" {
        let own = vehicles(designated).first
        out.board = journeyNeedsLineQualifier(
            designatedName: own?.fromName ?? board.label, designatedLine: own?.lineName ?? board.line,
            actualName: actual.fromName ?? "", actualLine: actual.lineName)
    }
    if let alight, let actual = vehicles(recommended).last, actual.mode != "bus" {
        let own = vehicles(designated).last
        out.alight = journeyNeedsLineQualifier(
            designatedName: own?.toName ?? alight.label, designatedLine: own?.lineName ?? alight.line,
            actualName: actual.toName ?? "", actualLine: actual.lineName)
    }
    return out
}

/// 변형 제목(§8.4 표 + 그 아래 조합 규칙). 지정 역 경로는 지정한 쪽의 역 이름, 추천은 다른 쪽(둘 다 다르면 승차 쪽)을
/// 말하고, 그 쪽 탈것이 버스면 정류장 문장이다. 안내 시작 버튼 라벨도 이 이름을 쓴다(로터에서 어느 경로인지 들린다).
/// 동명 이역이면 그 쪽 역 이름 앞에 노선을 붙인다(판정 8 — 「2호선 신촌역에서 타는 추천 경로」).
func journeyVariantHeading(
    _ v: JourneyVariant, board: RecentStation?, alight: RecentStation?, lines: JourneyLineQualifiers
) -> String {
    let vehicles = v.transit.legs.filter { $0.mode != "walk" }
    let first = vehicles.first
    let last = vehicles.last
    let display = journeyStationDisplayName
    func named(_ name: String, line: String?, qualified: Bool) -> String {
        qualified ? journeyQualifiedStationName(name, line: line) : display(name)
    }
    switch v.kind {
    case .designated:
        if let board {
            return appLocalized(
                "ios.journey.designatedHeading",
                named(first?.fromName ?? board.label, line: first?.lineName ?? board.line, qualified: lines.board))
        }
        return appLocalized(
            "ios.journey.designatedHeadingAlight",
            named(last?.toName ?? alight?.label ?? "", line: last?.lineName ?? alight?.line, qualified: lines.alight))
    case .recommended:
        let boardDiffers = board.map { display($0.label) != display(first?.fromName ?? "") } ?? false
        let alightDiffers = alight.map { display($0.label) != display(last?.toName ?? "") } ?? false
        // 이름이 같아도 노선이 다르면 다른 역이다 — 그 쪽을 다른 쪽으로 친다.
        if boardDiffers || lines.board || !(alightDiffers || lines.alight) {
            let name = first?.fromName ?? ""
            return first?.mode == "bus"
                ? appLocalized("ios.journey.recommendedHeadingBus", name)
                : appLocalized(
                    "ios.journey.recommendedHeading", named(name, line: first?.lineName, qualified: lines.board))
        }
        let name = last?.toName ?? ""
        return last?.mode == "bus"
            ? appLocalized("ios.journey.recommendedHeadingBusAlight", name)
            : appLocalized(
                "ios.journey.recommendedHeadingAlight", named(name, line: last?.lineName, qualified: lines.alight))
    }
}

/// 역 칸의 노선 힌트(spec §4.1 — 카테고리 마지막 조각 또는 이름 꼬리). 카카오 역 분류 끝(`수도권2호선`)이 노선이면 그것,
/// 아니면 이름 뒤 공백 다음 노선 토큰(`아현역 2호선`의 `2호선`). 모르면 nil(서버는 좌표 조건만으로 판정한다).
func journeyLineHint(_ place: Place) -> String? {
    func isLine(_ token: Substring) -> Bool {
        token.hasSuffix("선") || token.hasSuffix("철도") || token.hasPrefix("GTX")
    }
    if let last = place.category.split(separator: ">").last.map({ $0.trimmingCharacters(in: .whitespaces) }),
       last != "지하철,전철", isLine(Substring(last)) {
        return last
    }
    if let tail = place.name.split(separator: " ").dropFirst().last, isLine(tail) { return String(tail) }
    return nil
}
