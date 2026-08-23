import Foundation

/// 대중교통 안내 "주변 확인" 앵커 판정(E15-2, spec 2026-08-23-transit-surroundings-anchor §2).
///
/// "현재역"은 조망의 `transitOverviewHere`가 `.station`으로 **확정**했을 때만이다 —
/// 같은 화면에서 조망은 "현재 위치 모름"이라 말하고 주변 확인은 "현재역 주변"이라
/// 말하는 모순을 판정 재사용으로 막는다. 그 밖은 전부 하차역이고, 정차역 목록이
/// 없어 하차역 좌표를 모르면 앵커가 없다(섹션 미노출 — 좌표 없는 주변 확인은 없다).
///
/// ⚠ 웹 미러가 없는 Kit 단독 순수 함수다 — 웹 `TransitGuidePanel`에는 주변 확인 UI가
/// 없다(E15 다음 능력 ③ 웹 조망 UI 뒤). 웹에 UI가 생기면 그때 미러를 만든다.
public enum TransitSurroundingsAnchor: Sendable, Equatable {
    case currentStation(TransitLegStop)
    case alightStop(TransitLegStop)

    public var stop: TransitLegStop {
        switch self {
        case let .currentStation(s), let .alightStop(s): s
        }
    }
}

public func transitSurroundingsAnchor(state: TransitGuideState, leg: TransitGuideLeg) -> TransitSurroundingsAnchor? {
    if case let .station(idx) = transitOverviewHere(state: state, leg: leg),
       leg.viaStops.indices.contains(idx) {
        return .currentStation(leg.viaStops[idx])
    }
    guard let alight = leg.alightStop else { return nil }
    return .alightStop(alight)
}
