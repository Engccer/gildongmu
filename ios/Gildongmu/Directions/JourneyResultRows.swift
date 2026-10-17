import SwiftUI
import GildongmuKit

/// 여정 조회 결과(E70 §5.2, 실험판). 읽기 순서: 못 찾음 줄 → (변형 둘이면) 변형 제목 겸 선택 버튼 → 합계 → 택시 앞 →
/// 대중교통 구간 → 출구 선택 → 안내 시작. 줄마다 한 접근성 객체(쉼표 결합)다.
struct JourneyResultRows: View {
    let result: JourneyResult
    /// 사용자가 칸에 고른 역(제목이 "지정 역과 다른가"를 이 이름으로 가른다).
    let board: RecentStation?
    let alight: RecentStation?
    @Binding var variantIndex: Int
    @Binding var egressIndex: Int
    let destinationName: String?
    let destinationRoman: String?
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
        // 변형이 둘이면 제목이 곧 선택 버튼이다(heading trait + 선택 trait, 한 객체). 하나면 제목 없이 바로 합계.
        if result.variants.count > 1 {
            ForEach(Array(result.variants.enumerated()), id: \.offset) { index, v in
                Button {
                    variantIndex = index
                    egressIndex = 0
                } label: {
                    Text(journeyVariantHeading(v, board: board, alight: alight))
                }
                .accessibilityAddTraits(index == variantIndex ? [.isHeader, .isSelected] : .isHeader)
            }
        }
        Text(totalsLine)
        if let taxiIn = variant.taxiIn, let station = variant.boardStation {
            Text(appLocalized(
                "ios.journey.taxiIn", journeyStationDisplayName(station.name), minutesText(taxiIn), wonText(taxiIn.taxiFare)))
        }
        TransitRouteRows(
            route: variant.transit, includeSummary: false,
            destinationName: destinationName, destinationRoman: destinationRoman)
        if let options = variant.egress?.options {
            if options.count > 1 {
                ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                    Button { egressIndex = index } label: {
                        Text(egressLine(option, lookupFailed: variant.egress?.lookupFailed == true))
                    }
                    .accessibilityAddTraits(index == egressIndex ? .isSelected : [])
                }
            } else if let option = options.first {
                Text(egressLine(option, lookupFailed: variant.egress?.lookupFailed == true))
            }
        }
        Button(appLocalized("beacon.guideStartTransitAlt", journeyVariantHeading(variant, board: board, alight: alight))) {
            onStart(variant, egress)
        }
    }

    /// 판정 14: 지정 역 경로를 못 찾았다는 사실 한 줄(양쪽이면 두 줄, 새 문장 없음 — spec §3.2).
    private var missingLines: [String] {
        guard let side = result.designatedMissing?.side else { return [] }
        let boardLine = board.map { appLocalized("ios.journey.designatedMissing", journeyStationDisplayName($0.label)) }
        let alightLine = alight.map {
            appLocalized("ios.journey.designatedMissingAlight", journeyStationDisplayName($0.label))
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

/// 변형 제목(§8.4 표 + 그 아래 조합 규칙). 지정 역 경로는 지정한 쪽의 역 이름, 추천은 다른 쪽(둘 다 다르면 승차 쪽)을
/// 말하고, 그 쪽 탈것이 버스면 정류장 문장이다. 안내 시작 버튼 라벨도 이 이름을 쓴다(로터에서 어느 경로인지 들린다).
func journeyVariantHeading(_ v: JourneyVariant, board: RecentStation?, alight: RecentStation?) -> String {
    let vehicles = v.transit.legs.filter { $0.mode != "walk" }
    let first = vehicles.first
    let last = vehicles.last
    let display = journeyStationDisplayName
    switch v.kind {
    case .designated:
        if board != nil {
            return appLocalized("ios.journey.designatedHeading", display(first?.fromName ?? board!.label))
        }
        return appLocalized("ios.journey.designatedHeadingAlight", display(last?.toName ?? alight?.label ?? ""))
    case .recommended:
        let boardDiffers = board.map { display($0.label) != display(first?.fromName ?? "") } ?? false
        let alightDiffers = alight.map { display($0.label) != display(last?.toName ?? "") } ?? false
        if boardDiffers || !alightDiffers {
            let name = first?.fromName ?? ""
            return first?.mode == "bus"
                ? appLocalized("ios.journey.recommendedHeadingBus", name)
                : appLocalized("ios.journey.recommendedHeading", display(name))
        }
        let name = last?.toName ?? ""
        return last?.mode == "bus"
            ? appLocalized("ios.journey.recommendedHeadingBusAlight", name)
            : appLocalized("ios.journey.recommendedHeadingAlight", display(name))
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
