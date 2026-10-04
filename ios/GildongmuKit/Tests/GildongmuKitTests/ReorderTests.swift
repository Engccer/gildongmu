import Testing
import Foundation
@testable import GildongmuKit

/// 순서 바꾸기 로터 액션의 판정(spec 2026-10-05-reorder-rotor-actions-design.md §1·§3.1).
@Suite struct ReorderTests {
    @Test func availableMovesOfferOnlyWhatChangesTheOrder() {
        #expect(Reorder.availableMoves(index: 0, count: 1) == [])
        #expect(Reorder.availableMoves(index: 0, count: 2) == [.down])
        #expect(Reorder.availableMoves(index: 1, count: 2) == [.up])
        // 둘째 자리의 맨 위로는 위로와 같다.
        #expect(Reorder.availableMoves(index: 1, count: 4) == [.up, .down])
        #expect(Reorder.availableMoves(index: 2, count: 4) == [.toTop, .up, .down])
        #expect(Reorder.availableMoves(index: 3, count: 4) == [.toTop, .up])
        #expect(Reorder.availableMoves(index: 4, count: 4) == [])
        #expect(Reorder.availableMoves(index: -1, count: 4) == [])
    }

    @Test func movedRelocatesOneItem() {
        let items = ["a", "b", "c", "d"]
        #expect(Reorder.moved(items, from: 3, .toTop) == ["d", "a", "b", "c"])
        #expect(Reorder.moved(items, from: 2, .up) == ["a", "c", "b", "d"])
        #expect(Reorder.moved(items, from: 1, .down) == ["a", "c", "b", "d"])
    }

    @Test func impossibleMovesKeepTheOrder() {
        let items = ["a", "b", "c"]
        #expect(Reorder.moved(items, from: 0, .up) == items)
        #expect(Reorder.moved(items, from: 0, .toTop) == items)
        #expect(Reorder.moved(items, from: 2, .down) == items)
        #expect(Reorder.moved(items, from: 5, .up) == items)
    }

    @Test func everyOfferedMoveChangesTheOrder() {
        for count in 1...5 {
            let items = Array(0..<count)
            for index in items {
                for move in Reorder.availableMoves(index: index, count: count) {
                    #expect(Reorder.moved(items, from: index, move) != items, "\(index) \(move)")
                }
            }
        }
    }

    @Test func restoredOrderKeepsSavedOrderAndFillsMissingWithDefaults() {
        let defaults = ["chat", "search", "directions", "nearby"]
        #expect(Reorder.restoredOrder(saved: ["nearby", "search", "chat", "directions"], defaultOrder: defaults)
            == ["nearby", "search", "chat", "directions"])
        // 빠진 탭은 기본 순서대로 뒤에.
        #expect(Reorder.restoredOrder(saved: ["directions"], defaultOrder: defaults)
            == ["directions", "chat", "search", "nearby"])
        // 모르는 값·중복은 버린다(탭이 줄어든 뒤의 저장값).
        #expect(Reorder.restoredOrder(saved: ["map", "search", "search", "chat"], defaultOrder: defaults)
            == ["search", "chat", "directions", "nearby"])
        #expect(Reorder.restoredOrder(saved: [], defaultOrder: defaults) == defaults)
    }

    @Test func restoredOrderFromStorageString() {
        let defaults = ["chat", "search", "directions", "nearby"]
        #expect(Reorder.restoredOrder(json: "", defaultOrder: defaults) == defaults)
        #expect(Reorder.restoredOrder(json: "not json", defaultOrder: defaults) == defaults)
        #expect(Reorder.restoredOrder(json: #"{"a":1}"#, defaultOrder: defaults) == defaults)
        let order = ["search", "nearby", "chat", "directions"]
        #expect(Reorder.restoredOrder(json: Reorder.encodedOrder(order), defaultOrder: defaults) == order)
    }

    @Test func defaultOrderIsStoredAsUnset() {
        let defaults = ["chat", "search", "directions", "nearby"]
        #expect(Reorder.storedValue(defaults, defaultOrder: defaults) == "")
        let order = ["search", "chat", "directions", "nearby"]
        #expect(Reorder.restoredOrder(json: Reorder.storedValue(order, defaultOrder: defaults), defaultOrder: defaults) == order)
        // 미지정이면 뒤에 늘어난 탭도 기본 자리에 선다.
        #expect(Reorder.restoredOrder(json: "", defaultOrder: defaults + ["new"]) == defaults + ["new"])
    }
}
