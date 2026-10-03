import GildongmuKit
import SwiftUI

/// 나들이 "주변 보기" 조망 어댑터(E51 spec §8.2). 셸은 `GuideOverviewSheet` 그대로이고, 여기는
/// 진행축 관계(Kit `outingProject` 결과, 모델이 fix마다 갱신)를 앞·옆·지나온 구획 행으로 투영한다.
///
/// ⚠ 조망 전용 봉인(`GuideOverviewCapability`)을 넓히지 않는다. 장소 활성화는 `perform`이 부모 콜백에
/// 장소를 넘기고 `.dismiss`를 돌려준다 — 상세 시트는 조망이 닫힌 **뒤** 부모가 연다(닫힌 뒤 행동 계약, E33).
@Observable @MainActor
final class OutingOverviewAdapter: GuideOverviewCapability, Identifiable {
    let model: OutingModel
    private let onOpenPlace: (Place) -> Void
    /// `.sheet(item:)` 정체성 — 열 때마다 새 인스턴스.
    nonisolated var id: ObjectIdentifier { ObjectIdentifier(self) }

    init(model: OutingModel, onOpenPlace: @escaping (Place) -> Void) {
        self.model = model
        self.onOpenPlace = onOpenPlace
    }

    /// 머리글 — 시스템 헤더 착지가 낭독한다(별도 통지 없음).
    var overviewHeaderText: String { joinText(model.walkedLine, model.headingLine) }

    /// 마지막으로 그린 행. 세션이 끝나면(모델이 장소를 비운다, E58 후속 ④) 조망이 닫히기 전 한 프레임에 구획이
    /// "없음"으로 다시 그려져 커서가 옮겨 가지 않게 이 행을 그대로 낸다.
    @ObservationIgnored private var lastRows: [GuideOverviewRow] = []

    var overviewRows: [GuideOverviewRow] {
        guard model.isTracking else { return lastRows }
        let rows = currentRows
        lastRows = rows
        return rows
    }

    private var currentRows: [GuideOverviewRow] {
        // 주변 정보가 준비되지 않았으면 "없음"으로 뭉개지 않고 방향 행과 같은 상태 문장 한 줄(3-state, 접근성 감사 M3).
        switch model.surroundingsStatus {
        case .loading: return [.text(id: "status", appLocalized("ios.outing.surroundingsLoading"))]
        case .failed: return [.text(id: "status", appLocalized("ios.outing.surroundingsFailed"))]
        case .outOfCoverage: return [.text(id: "status", appLocalized("ios.outing.outOfCoverage"))]
        case .ready: break
        }
        let radius = formatDistance(Int(outingOverviewRadiusMeters))
        // 스냅샷(연 순간 + 그때 건 재조회가 반영된 첫 fix)에서 그린다 — fix마다 다시 그리면 커서 아래 항목이 구획을 옮겨 다닌다.
        let near = model.overviewRelations.filter { $0.value.d <= outingOverviewRadiusMeters }
        // 방위를 모르면 앞·지나온을 가를 기준이 없다 — "앞에 없음"으로 단정하지 않고 "주변" 한 목록으로(접근성 감사 M2).
        let zones: [(zone: OutingZone?, id: String, title: String)] = model.overviewHeadingValid
            ? [
                (.ahead, "zone-ahead", appLocalized("ios.outing.zoneAhead", radius)),
                (.beside, "zone-beside", appLocalized("ios.outing.zoneBeside")),
                (.behind, "zone-behind", appLocalized("ios.outing.zoneBehind", radius)),
            ]
            : [(nil, "zone-around", appLocalized("ios.outing.zoneAround", radius))]
        var rows: [GuideOverviewRow] = []
        for section in zones {
            rows.append(.heading(id: section.id, section.title))
            let items = near.filter { section.zone == nil || $0.value.zone == section.zone }
                .sorted { $0.value.d < $1.value.d }
            if items.isEmpty {
                rows.append(.text(id: "\(section.id)-empty", appLocalized("ios.outing.zoneEmpty")))
            }
            for (placeID, rel) in items {
                guard let p = model.place(id: placeID) else { continue }
                rows.append(.action(id: placeID, label: OutingModel.overviewItemLine(
                    name: model.displayName(p), side: rel.side, meters: outingQuantizedMeters(rel.d))))
            }
        }
        return rows
    }

    var overviewActions: [GuideOverviewAction] { [] }

    func perform(_ actionId: String) -> GuideOverviewActionResult {
        guard let p = model.place(id: actionId) else { return .stale }
        onOpenPlace(surroundingPlaceToPlace(p))
        return .dismiss
    }

    func subsheetDismissed(_ subsheet: GuideOverviewSubsheet) {}
}
