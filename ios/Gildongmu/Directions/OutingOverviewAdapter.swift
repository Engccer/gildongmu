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

    var overviewRows: [GuideOverviewRow] {
        let radius = Int(outingOverviewRadiusMeters)
        let near = model.relations.filter { $0.value.d <= outingOverviewRadiusMeters }
        let zones: [(OutingZone, String, String)] = [
            (.ahead, "zone-ahead", appLocalized("ios.outing.zoneAhead", formatDistance(radius))),
            (.beside, "zone-beside", appLocalized("ios.outing.zoneBeside")),
            (.behind, "zone-behind", appLocalized("ios.outing.zoneBehind", formatDistance(radius))),
        ]
        var rows: [GuideOverviewRow] = []
        for (zone, id, title) in zones {
            rows.append(.heading(id: id, title))
            let items = near.filter { $0.value.zone == zone }.sorted { $0.value.d < $1.value.d }
            if items.isEmpty {
                rows.append(.text(id: "\(id)-empty", appLocalized("ios.outing.zoneEmpty")))
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
