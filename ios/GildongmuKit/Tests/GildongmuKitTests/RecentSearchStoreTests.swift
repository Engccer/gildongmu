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
        #expect(store.recordEndpoint(gyeongbok) == [gyeongbok])
        #expect(store.removeEndpoint(gyeongbok) == [])
        store.recordEndpoint(gyeongbok)
        store.clearEndpoints()
        #expect(store.endpoints() == [])
    }

    @Test func coord4DigitDedupeReplacesLabel() {
        let store = RecentSearchStore(defaults: freshDefaults("coord"))
        store.recordEndpoint(gyeongbok)
        store.recordEndpoint(RecentEndpoint(label: "서울역", lat: 37.5547, lng: 126.9707))
        // 소수 5자리째만 다른 좌표(4자리 반올림 동일) + 라벨 변형 → 교체·끌어올림
        let next = store.recordEndpoint(
            RecentEndpoint(label: "경복궁 (고궁)", lat: 37.5796172, lng: 126.9770413))
        #expect(next.count == 2)
        #expect(next.first?.label == "경복궁 (고궁)")
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("epcap"))
        for i in 1...21 {
            store.recordEndpoint(RecentEndpoint(label: "p\(i)", lat: Double(i), lng: Double(i)))
        }
        #expect(store.endpoints().count == 20)
        #expect(store.endpoints().first?.label == "p21")
    }
}
