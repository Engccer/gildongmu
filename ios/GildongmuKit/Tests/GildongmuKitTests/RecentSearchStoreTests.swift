import Testing
import Foundation
@testable import GildongmuKit

// 웹 src/lib/__tests__/recent-searches.test.ts의 대표 케이스를 그대로 옮긴다(기대값 재사용).

/// 케이스 격리 suite: 테스트별 UserDefaults를 비우고 시작한다.
private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "recent-search-tests-\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Suite struct RecentQueryTests {
    @Test func trimAndPrependAndIgnoreEmpty() {
        let store = RecentSearchStore(defaults: freshDefaults("trim"))
        #expect(store.recordQuery("  경복궁  ") == [RecentQuery(text: "경복궁")])
        #expect(store.recordQuery("서울역") == [RecentQuery(text: "서울역"), RecentQuery(text: "경복궁")])
        #expect(store.recordQuery("   ") == [RecentQuery(text: "서울역"), RecentQuery(text: "경복궁")])
    }

    @Test func dedupeMovesToTop() {
        let store = RecentSearchStore(defaults: freshDefaults("dedupe"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.recordQuery("a").map(\.text) == ["a", "b"])
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("cap"))
        for i in 1...21 { store.recordQuery("q\(i)") }
        let list = store.queries()
        #expect(list.count == 20)
        #expect(list.first?.text == "q21")
        #expect(!list.map(\.text).contains("q1"))
    }

    @Test func removeAndClear() {
        let store = RecentSearchStore(defaults: freshDefaults("remove"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.removeQuery("a") == [RecentQuery(text: "b")])
        store.clearQueries()
        #expect(store.queries() == [])
    }

    @Test func corruptDataRecoversToEmpty() {
        let defaults = freshDefaults("corrupt")
        defaults.set(Data("{oops".utf8), forKey: "recentQueries.v1")
        #expect(RecentSearchStore(defaults: defaults).queries() == [])
        defaults.set(Data("{oops".utf8), forKey: "recentQueries.v2")
        #expect(RecentSearchStore(defaults: defaults).queries() == [])
    }

    // MARK: 고정(스펙 2026-08-12)

    @Test func migratesV1Strings() throws {
        let defaults = freshDefaults("migrate")
        defaults.set(try JSONEncoder().encode(["a", "b"]), forKey: "recentQueries.v1")
        let store = RecentSearchStore(defaults: defaults)
        #expect(store.queries() == [RecentQuery(text: "a"), RecentQuery(text: "b")])
        // 첫 저장 이후는 v2가 정본
        #expect(store.recordQuery("c").map(\.text) == ["c", "a", "b"])
    }

    @Test func clearAfterMigrationDoesNotResurrectV1() throws {
        let defaults = freshDefaults("migrate-clear")
        defaults.set(try JSONEncoder().encode(["a", "b"]), forKey: "recentQueries.v1")
        let store = RecentSearchStore(defaults: defaults)
        #expect(store.queries().count == 2)
        store.clearQueries() // 고정 없음 → v2에 빈 배열 저장(빈 v2 ≠ v2 부재)
        #expect(store.queries() == [])
    }

    @Test func pinAppendsToEndOfPinBlock() {
        let store = RecentSearchStore(defaults: freshDefaults("pin-order"))
        store.recordQuery("a")
        store.recordQuery("b")
        store.recordQuery("c") // [c, b, a]
        store.setQueryPinned("a", pinned: true) // [a(pin), c, b]
        let after = store.setQueryPinned("b", pinned: true) // [a(pin), b(pin), c]
        #expect(after == [
            RecentQuery(text: "a", pinned: true),
            RecentQuery(text: "b", pinned: true),
            RecentQuery(text: "c"),
        ])
    }

    @Test func unpinMovesToHeadOfUnpinnedBlock() {
        let store = RecentSearchStore(defaults: freshDefaults("unpin"))
        store.recordQuery("a")
        store.recordQuery("b") // [b, a]
        store.setQueryPinned("a", pinned: true) // [a(pin), b]
        #expect(store.setQueryPinned("a", pinned: false) == [RecentQuery(text: "a"), RecentQuery(text: "b")])
    }

    @Test func recordingPinnedItemKeepsItsPlace() {
        let store = RecentSearchStore(defaults: freshDefaults("pin-record"))
        store.recordQuery("a")
        store.recordQuery("b") // [b, a]
        store.setQueryPinned("a", pinned: true) // [a(pin), b]
        #expect(store.recordQuery("a") == [RecentQuery(text: "a", pinned: true), RecentQuery(text: "b")])
        // 비고정 신규 기록은 고정 블록 바로 뒤로
        #expect(store.recordQuery("c").map(\.text) == ["a", "c", "b"])
    }

    @Test func capAppliesOnlyToUnpinned() {
        let store = RecentSearchStore(defaults: freshDefaults("pin-cap"))
        store.recordQuery("keep")
        store.setQueryPinned("keep", pinned: true)
        for i in 1...21 { store.recordQuery("q\(i)") }
        let list = store.queries()
        #expect(list.count == 21) // 고정 1 + 비고정 20
        #expect(list.first == RecentQuery(text: "keep", pinned: true))
        #expect(!list.map(\.text).contains("q1"))
    }

    @Test func clearKeepsPinned() {
        let store = RecentSearchStore(defaults: freshDefaults("pin-clear"))
        store.recordQuery("a")
        store.recordQuery("b")
        store.setQueryPinned("a", pinned: true)
        #expect(store.clearQueries() == [RecentQuery(text: "a", pinned: true)])
        #expect(store.queries() == [RecentQuery(text: "a", pinned: true)])
    }

    @Test func pinUnknownItemIsNoOp() {
        let store = RecentSearchStore(defaults: freshDefaults("pin-ghost"))
        store.recordQuery("a")
        #expect(store.setQueryPinned("ghost", pinned: true) == [RecentQuery(text: "a")])
    }

    /// ForEach 행 정체성(Identifiable)은 고정 토글·라벨 갱신에 불변이어야 한다 —
    /// 정체성이 바뀌면 List가 행을 파괴+재생성해 VO 포커스가 이탈한다(a11y 감사 2026-08-12).
    @Test func listIdentityStableAcrossPinToggleAndLabelRefresh() {
        #expect(RecentQuery(text: "a").id == RecentQuery(text: "a", pinned: true).id)
        let home = RecentEndpoint(label: "집", lat: 37.5, lng: 127.1)
        let toggled = RecentEndpoint(label: "우리집", lat: 37.50001, lng: 127.09999, pinned: true)
        #expect(home.id == toggled.id) // 좌표 4자리 축 = sameCoord와 동일
        #expect(RecentRoute(from: nil, to: home).id == RecentRoute(from: nil, to: toggled, pinned: true).id)
        #expect(RecentRoute(from: home, to: nil).id != RecentRoute(from: nil, to: home).id)
    }
}

@Suite struct RecentEndpointTests {
    @Test func legacyAndAdditiveRomanizationRoundTrip() throws {
        let defaults = freshDefaults("ep-roman-legacy")
        let legacy = Data(#"[{"label":"경복궁","lat":37.579617,"lng":126.977041}]"#.utf8)
        defaults.set(legacy, forKey: "recentEndpoints.to.v1")
        let store = RecentSearchStore(defaults: defaults)
        let old = try #require(store.endpoints(.to).first)
        #expect(old.labelRoman == nil)
        #expect(!old.pinned)
        #expect(bilingualName(lang: "en", ko: old.label, en: nil, roman: old.labelRoman).primary == "경복궁")
        let new = RecentEndpoint(label: old.label, lat: old.lat, lng: old.lng, labelRoman: "Gyeongbokgung")
        store.recordEndpoint(new, scope: .to)
        let reloaded = RecentSearchStore(defaults: defaults).endpoints(.to)
        #expect(reloaded == [new])
        #expect(reloaded.first?.id == old.id)
        let encoded = try #require(defaults.data(forKey: "recentEndpoints.to.v1"))
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [[String: Any]])
        #expect(object.first?["labelRoman"] as? String == "Gyeongbokgung")
        // 과거 디코더는 additive 키를 무시하고 원명·좌표를 그대로 읽는다.
        struct Legacy: Decodable { let label: String; let lat: Double; let lng: Double }
        #expect(try JSONDecoder().decode([Legacy].self, from: encoded).first?.label == old.label)
    }

    @Test func romanizationSurvivesPinsAndRouteRoundTrip() throws {
        let defaults = freshDefaults("ep-route-roman")
        let store = RecentSearchStore(defaults: defaults)
        let from = RecentEndpoint(label: "출발", lat: 37.5, lng: 127, labelRoman: "Start")
        let to = RecentEndpoint(label: "도착", lat: 37.6, lng: 127, labelRoman: "End")
        let via = RecentEndpoint(label: "경유", lat: 37.55, lng: 127, labelRoman: "Via")
        for (scope, item) in [(RecentEndpointScope.from, from), (.to, to), (.via, via)] {
            store.recordEndpoint(item, scope: scope)
            for pinned in [true, false] {
                store.setEndpointPinned(item, scope: scope, pinned: pinned)
                let actual = try #require(store.endpoints(scope).first)
                #expect(actual.labelRoman == item.labelRoman)
                #expect(actual.id == item.id)
                #expect(actual.pinned == pinned)
            }
        }
        let route = RecentRoute(from: from, to: to, via: via)
        store.recordRoute(route)
        store.setRoutePinned(route, pinned: true)
        let restored = try #require(RecentSearchStore(defaults: defaults).routes().first)
        #expect(restored.from == from)
        #expect(restored.to == to)
        #expect(restored.via == via)
        #expect(restored.id == route.id)
        #expect(restored.pinned)
        // 표기만 바뀌어도 같은 경로이며 고정 상태와 자리를 유지한다.
        let updatedTo = RecentEndpoint(label: to.label, lat: to.lat, lng: to.lng, labelRoman: "Destination")
        store.recordRoute(RecentRoute(from: from, to: updatedTo, via: via))
        #expect(store.routes().count == 1)
        #expect(store.routes().first?.to?.labelRoman == "Destination")
        #expect(store.routes().first?.pinned == true)
        store.setRoutePinned(route, pinned: false)
        #expect(store.routes().first?.to?.labelRoman == "Destination")
    }

    @Test func pinnedEndpointDedupeKeepsLatestSpellingAndLegacyRouteDecodes() throws {
        let store = RecentSearchStore(defaults: freshDefaults("ep-roman-dedupe"))
        let old = RecentEndpoint(label: "이름", lat: 37.5, lng: 127, labelRoman: "Old")
        store.recordEndpoint(old, scope: .to)
        store.setEndpointPinned(old, scope: .to, pinned: true)
        let changed = RecentEndpoint(label: "새 이름", lat: 37.50001, lng: 127, labelRoman: "New")
        let items = store.recordEndpoint(changed, scope: .to)
        #expect(items.count == 1)
        #expect(items.first?.labelRoman == "New")
        #expect(items.first?.id == old.id)
        #expect(items.first?.pinned == true)
        let legacy = Data(#"{"to":{"label":"이름","lat":37.5,"lng":127}}"#.utf8)
        let route = try JSONDecoder().decode(RecentRoute.self, from: legacy)
        #expect(route.to?.labelRoman == nil)
        #expect(route.from == nil && route.via == nil && !route.pinned)
    }

    let gyeongbok = RecentEndpoint(label: "경복궁", lat: 37.579617, lng: 126.977041)

    @Test func recordRemoveClear() {
        let store = RecentSearchStore(defaults: freshDefaults("ep"))
        #expect(store.recordEndpoint(gyeongbok, scope: .to) == [gyeongbok])
        #expect(store.removeEndpoint(gyeongbok, scope: .to) == [])
        store.recordEndpoint(gyeongbok, scope: .to)
        store.clearEndpoints(.to)
        #expect(store.endpoints(.to) == [])
    }

    @Test func coord4DigitDedupeReplacesLabel() {
        let store = RecentSearchStore(defaults: freshDefaults("coord"))
        store.recordEndpoint(gyeongbok, scope: .to)
        store.recordEndpoint(RecentEndpoint(label: "서울역", lat: 37.5547, lng: 126.9707), scope: .to)
        // 소수 5자리째만 다른 좌표(4자리 반올림 동일) + 라벨 변형 → 교체·끌어올림
        let next = store.recordEndpoint(
            RecentEndpoint(label: "경복궁 (고궁)", lat: 37.5796172, lng: 126.9770413), scope: .to)
        #expect(next.count == 2)
        #expect(next.first?.label == "경복궁 (고궁)")
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("epcap"))
        for i in 1...21 {
            store.recordEndpoint(RecentEndpoint(label: "p\(i)", lat: Double(i), lng: Double(i)), scope: .to)
        }
        #expect(store.endpoints(.to).count == 20)
        #expect(store.endpoints(.to).first?.label == "p21")
    }

    @Test func fromAndToAreSeparated() {
        let store = RecentSearchStore(defaults: freshDefaults("scope"))
        store.recordEndpoint(gyeongbok, scope: .from)
        #expect(store.endpoints(.to) == [])
        store.recordEndpoint(RecentEndpoint(label: "서울역", lat: 37.5547, lng: 126.9707), scope: .to)
        #expect(store.endpoints(.from) == [gyeongbok])
        // 한쪽 전체 삭제가 다른 쪽에 영향 없음
        store.clearEndpoints(.from)
        #expect(store.endpoints(.from) == [])
        #expect(store.endpoints(.to).count == 1)
    }

    // MARK: 고정(스펙 2026-08-12)

    @Test func legacyDataWithoutPinnedDecodesUnpinned() {
        let defaults = freshDefaults("ep-legacy")
        let raw = #"[{"label":"집","lat":37.5,"lng":127.1}]"#  // pinned 필드 없는 기존 데이터
        defaults.set(Data(raw.utf8), forKey: "recentEndpoints.to.v1")
        let store = RecentSearchStore(defaults: defaults)
        #expect(store.endpoints(.to) == [RecentEndpoint(label: "집", lat: 37.5, lng: 127.1)])
    }

    @Test func pinKeepsTopAndLabelRefreshKeepsPlaceAndClearKeepsPins() {
        let store = RecentSearchStore(defaults: freshDefaults("ep-pin"))
        let home = RecentEndpoint(label: "집", lat: 37.5, lng: 127.1)
        store.recordEndpoint(home, scope: .to)
        store.recordEndpoint(RecentEndpoint(label: "회사", lat: 37.6, lng: 127.0), scope: .to) // [회사, 집]
        store.setEndpointPinned(home, scope: .to, pinned: true) // [집(pin), 회사]
        #expect(store.endpoints(.to).map(\.label) == ["집", "회사"])
        // 고정 항목 재기록(라벨 변형) → 자리 유지 + 라벨 교체 + 고정 유지
        let relabeled = store.recordEndpoint(RecentEndpoint(label: "우리집", lat: 37.5, lng: 127.1), scope: .to)
        #expect(relabeled.first == RecentEndpoint(label: "우리집", lat: 37.5, lng: 127.1, pinned: true))
        // cap: 고정 1 + 비고정 20
        for i in 1...21 {
            store.recordEndpoint(RecentEndpoint(label: "p\(i)", lat: Double(i), lng: Double(i)), scope: .to)
        }
        #expect(store.endpoints(.to).count == 21)
        // clear는 고정만 남긴다
        #expect(store.clearEndpoints(.to).map(\.label) == ["우리집"])
    }
}

@Suite struct RecentRouteTests {
    private let home = RecentEndpoint(label: "자택", lat: 37.5665, lng: 126.978)
    private let school = RecentEndpoint(label: "신명중학교", lat: 37.529, lng: 127.138)

    @Test func prependAndDedupeByPair() {
        let store = RecentSearchStore(defaults: freshDefaults("route-dedupe"))
        let a = RecentRoute(from: home, to: school)
        let b = RecentRoute(from: nil, to: school)
        #expect(store.recordRoute(a) == [a])
        #expect(store.recordRoute(b) == [b, a])   // 한쪽 nil ≠ place: 다른 쌍
        let relabeled = RecentRoute(from: RecentEndpoint(label: "자택 아파트", lat: home.lat, lng: home.lng), to: school)
        #expect(store.recordRoute(relabeled) == [relabeled, b])   // 같은 쌍은 끌어올림+라벨 갱신
    }

    @Test func rejectsBothCurrent() {
        let store = RecentSearchStore(defaults: freshDefaults("route-both-nil"))
        #expect(store.recordRoute(RecentRoute(from: nil, to: nil)) == [])
        #expect(store.routes() == [])
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("route-cap"))
        for i in 0..<25 {
            store.recordRoute(RecentRoute(from: nil, to: RecentEndpoint(label: "t\(i)", lat: 37 + Double(i) * 0.01, lng: 127)))
        }
        #expect(store.routes().count == 20)
    }

    @Test func removeClearAndDecodeRecovery() {
        let defaults = freshDefaults("route-remove")
        let store = RecentSearchStore(defaults: defaults)
        let a = RecentRoute(from: home, to: school)
        let b = RecentRoute(from: nil, to: school)
        store.recordRoute(a)
        store.recordRoute(b)
        #expect(store.removeRoute(b) == [a])
        store.clearRoutes()
        #expect(store.routes() == [])
        defaults.set(Data("broken".utf8), forKey: "recentRoutes.v1")
        #expect(store.routes() == [])
    }

    // MARK: 고정(스펙 2026-08-12)

    @Test func legacyDataWithoutPinnedDecodesUnpinned() {
        let defaults = freshDefaults("route-legacy")
        let raw = #"[{"from":null,"to":{"label":"학교","lat":37.529,"lng":127.138}}]"#
        defaults.set(Data(raw.utf8), forKey: "recentRoutes.v1")
        let store = RecentSearchStore(defaults: defaults)
        #expect(store.routes() == [RecentRoute(from: nil, to: RecentEndpoint(label: "학교", lat: 37.529, lng: 127.138))])
    }

    @Test func pinnedRouteStaysOnTopAcrossRecordsAndClear() {
        let store = RecentSearchStore(defaults: freshDefaults("route-pin"))
        let toSchool = RecentRoute(from: home, to: school)
        let toWork = RecentRoute(from: nil, to: RecentEndpoint(label: "회사", lat: 37.6, lng: 127.0))
        store.recordRoute(toSchool)
        store.recordRoute(toWork) // [회사, 학교]
        store.setRoutePinned(toSchool, pinned: true) // [학교(pin), 회사]
        #expect(store.routes().first?.to?.label == "신명중학교")
        store.recordRoute(toWork) // 재기록해도 고정이 위
        #expect(store.routes().first?.to?.label == "신명중학교")
        #expect(store.routes().first?.pinned == true)
        // clear 보존 → 해제 후 clear는 전량 삭제
        #expect(store.clearRoutes().count == 1)
        store.setRoutePinned(store.routes()[0], pinned: false)
        #expect(store.clearRoutes() == [])
    }
}


// MARK: - 경유지(N4)

@Suite struct RecentRouteViaTests {
    @Test func viaDistinguishesIdentityAndSurvivesPin() {
        let store = RecentSearchStore(defaults: freshDefaults("via"))
        let a = RecentEndpoint(label: "A", lat: 37.5, lng: 127.1)
        let b = RecentEndpoint(label: "B", lat: 37.6, lng: 127.2)
        let c = RecentEndpoint(label: "C", lat: 37.55, lng: 127.15)
        store.recordRoute(RecentRoute(from: a, to: b))
        let list = store.recordRoute(RecentRoute(from: a, to: b, via: c))
        #expect(list.count == 2)
        #expect(list.first?.via?.label == "C")
        #expect(RecentRoute(from: a, to: b).id != RecentRoute(from: a, to: b, via: c).id)
        let pinned = store.setRoutePinned(RecentRoute(from: a, to: b, via: c), pinned: true)
        #expect(pinned.first?.via?.label == "C" && pinned.first?.pinned == true)
        // 같은 경로 재기록은 경유지를 보존한 채 제자리(고정 블록)에 남는다.
        let again = store.recordRoute(RecentRoute(from: a, to: b, via: c))
        #expect(again.count == 2 && again.first?.via?.label == "C" && again.first?.pinned == true)
        let removed = store.removeRoute(RecentRoute(from: a, to: b, via: c))
        #expect(removed.count == 1 && removed.first?.via == nil)
    }

    @Test func legacyRouteWithoutViaDecodes() throws {
        let json = #"{"from":null,"to":{"label":"B","lat":37.6,"lng":127.2}}"#
        let r = try JSONDecoder().decode(RecentRoute.self, from: Data(json.utf8))
        #expect(r.via == nil && r.pinned == false && r.to?.label == "B")
    }
}

// MARK: - 고정 블록 순서(E67, spec 2026-10-05-reorder-rotor-actions-design.md §2)

@Suite struct RecentPinnedReorderTests {
    /// [a, b, c 고정(이 순서)] + [x, y 비고정].
    private func seededQueries(_ name: String) -> RecentSearchStore {
        let store = RecentSearchStore(defaults: freshDefaults(name))
        for text in ["y", "x", "c", "b", "a"] { store.recordQuery(text) }
        for text in ["a", "b", "c"] { store.setQueryPinned(text, pinned: true) }
        return store
    }

    @Test func reorderRebuildsPinBlockAndLeavesUnpinnedAlone() {
        let store = seededQueries("reorder-basic")
        #expect(store.queries().map(\.text) == ["a", "b", "c", "x", "y"])
        let moved = store.reorderPinnedQueries(["c", "a", "b"])
        #expect(moved.map(\.text) == ["c", "a", "b", "x", "y"])
        #expect(moved.prefix(3).allSatisfy { $0.pinned } && !moved[3].pinned)
        #expect(store.queries() == moved)
    }

    /// 사용자 지정 순은 그 뒤의 쓰기(재기록·새 고정·해제·삭제·모두 지우기)를 지나도 남는다(§2.1 전수표).
    @Test func userOrderSurvivesEveryOtherWrite() {
        let store = seededQueries("reorder-survive")
        store.reorderPinnedQueries(["c", "a", "b"])
        #expect(store.recordQuery("a").map(\.text) == ["c", "a", "b", "x", "y"])
        #expect(store.recordQuery("z").map(\.text) == ["c", "a", "b", "z", "x", "y"])
        // 새 고정은 블록 끝.
        #expect(store.setQueryPinned("x", pinned: true).map(\.text) == ["c", "a", "b", "x", "z", "y"])
        #expect(store.setQueryPinned("a", pinned: false).map(\.text) == ["c", "b", "x", "a", "z", "y"])
        #expect(store.removeQuery("b").map(\.text) == ["c", "x", "a", "z", "y"])
        #expect(store.clearQueries().map(\.text) == ["c", "x"])
    }

    /// 넘긴 목록의 비고정·없는 항목·중복은 무시하고, 빠진 고정은 저장 순서대로 뒤에 붙는다.
    @Test func reorderIgnoresStrangersAndKeepsMissingPins() {
        let store = seededQueries("reorder-strangers")
        #expect(store.reorderPinnedQueries(["x", "ghost", "b", "b"]).map(\.text) == ["b", "a", "c", "x", "y"])
        #expect(store.reorderPinnedQueries([]).map(\.text) == ["b", "a", "c", "x", "y"])
    }

    /// 화면 기준 이동(§2.2): 화면의 고정 순서가 저장과 어긋나 있어도(Y를 고정한 뒤 그보다 위에 보이던 Z를
    /// 고정) 이동 결과는 화면 순서에 이동을 적용한 것이다.
    @Test func moveFollowsOnScreenPinOrder() {
        let store = RecentSearchStore(defaults: freshDefaults("reorder-screen"))
        for text in ["y", "z"] { store.recordQuery(text) } // [z, y]
        let screen = store.queries()
        store.setQueryPinned("y", pinned: true)
        store.setQueryPinned("z", pinned: true) // 저장 [y, z], 화면은 자리 유지 [z, y]
        #expect(store.queries().map(\.text) == ["y", "z"])
        let onScreenPins = screen.map(\.text) // 둘 다 고정된 화면: [z, y]
        let next = Reorder.moved(onScreenPins, from: 1, .up) // y를 위로
        #expect(store.reorderPinnedQueries(next).map(\.text) == ["y", "z"])
        #expect(store.reorderPinnedQueries(Reorder.moved(onScreenPins, from: 0, .down)).map(\.text) == ["y", "z"])
        #expect(store.reorderPinnedQueries(onScreenPins).map(\.text) == ["z", "y"])
    }

    @Test func reorderKeepsStoredValuesOverPassedOnes() {
        let store = RecentSearchStore(defaults: freshDefaults("reorder-ep"))
        let home = RecentEndpoint(label: "집", lat: 37.5, lng: 127.1)
        let work = RecentEndpoint(label: "회사", lat: 37.6, lng: 127.0, labelRoman: "Hoesa")
        store.recordEndpoint(home, scope: .to)
        store.recordEndpoint(work, scope: .to)
        store.setEndpointPinned(home, scope: .to, pinned: true)
        store.setEndpointPinned(work, scope: .to, pinned: true) // [집, 회사]
        // 넘긴 값의 라벨·pinned가 아니라 저장본이 남는다(좌표 4자리 동일 판정).
        let moved = store.reorderPinnedEndpoints(
            [RecentEndpoint(label: "다른 이름", lat: 37.60001, lng: 127.0), home], scope: .to)
        #expect(moved == [
            RecentEndpoint(label: "회사", lat: 37.6, lng: 127.0, pinned: true, labelRoman: "Hoesa"),
            RecentEndpoint(label: "집", lat: 37.5, lng: 127.1, pinned: true),
        ])
        #expect(store.endpoints(.from) == [])
    }

    @Test func routeReorderUsesFullRouteIdentity() {
        let store = RecentSearchStore(defaults: freshDefaults("reorder-route"))
        let a = RecentEndpoint(label: "A", lat: 37.5, lng: 127.1)
        let b = RecentEndpoint(label: "B", lat: 37.6, lng: 127.2)
        let c = RecentEndpoint(label: "C", lat: 37.55, lng: 127.15)
        let direct = RecentRoute(from: a, to: b)
        let viaC = RecentRoute(from: a, to: b, via: c)
        let fromHere = RecentRoute(from: nil, to: b)
        for route in [direct, viaC, fromHere] {
            store.recordRoute(route)
            store.setRoutePinned(route, pinned: true)
        }
        let ids = { (list: [RecentRoute]) in list.map(\.id) }
        #expect(ids(store.routes()) == ids([direct, viaC, fromHere]))
        #expect(ids(store.reorderPinnedRoutes([fromHere, direct, viaC])) == ids([fromHere, direct, viaC]))
        #expect(store.routes().allSatisfy { $0.pinned })
    }
}
