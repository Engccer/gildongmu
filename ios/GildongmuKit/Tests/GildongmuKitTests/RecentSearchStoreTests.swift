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
        #expect(store.recordQuery("  경복궁  ") == ["경복궁"])
        #expect(store.recordQuery("서울역") == ["서울역", "경복궁"])
        #expect(store.recordQuery("   ") == ["서울역", "경복궁"])
    }

    @Test func dedupeMovesToTop() {
        let store = RecentSearchStore(defaults: freshDefaults("dedupe"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.recordQuery("a") == ["a", "b"])
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("cap"))
        for i in 1...21 { store.recordQuery("q\(i)") }
        let list = store.queries()
        #expect(list.count == 20)
        #expect(list.first == "q21")
        #expect(!list.contains("q1"))
    }

    @Test func removeAndClear() {
        let store = RecentSearchStore(defaults: freshDefaults("remove"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.removeQuery("a") == ["b"])
        store.clearQueries()
        #expect(store.queries() == [])
    }

    @Test func corruptDataRecoversToEmpty() {
        let defaults = freshDefaults("corrupt")
        defaults.set(Data("{oops".utf8), forKey: "recentQueries.v1")
        #expect(RecentSearchStore(defaults: defaults).queries() == [])
    }
}

@Suite struct RecentEndpointTests {
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
}

@Suite struct RecentRouteTests {
    private let home = RecentEndpoint(label: "자택", lat: 37.535, lng: 127.145)
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
}
