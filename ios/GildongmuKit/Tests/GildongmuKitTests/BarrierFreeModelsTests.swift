import Testing
import Foundation
@testable import GildongmuKit

// 무장애 여행 계약 테스트 — Fixtures/barrier-free-*.json이 계약 정본.
// match는 웹 계약상 비-throw(모든 실패를 nil로) — 네트워크 오류까지 검증한다.

@Test func nearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(BarrierFreeNearbyResponse.self, from: fixture("barrier-free-nearby"))
    #expect(!result.places.isEmpty)
    #expect(result.places.allSatisfy { !$0.contentId.isEmpty && !$0.name.isEmpty })
    // 거리순 정렬 보존(서버 계약)
    #expect(result.places.map(\.distanceMeters) == result.places.map(\.distanceMeters).sorted())
}

@Test func detailFixtureDecodes() throws {
    let result = try JSONDecoder().decode(BarrierFreeDetailResponse.self, from: fixture("barrier-free-detail"))
    guard let detail = result.detail else { Issue.record("detail이 nil이면 안 됨"); return }
    #expect(!detail.facilities.isEmpty)
    // 화이트리스트 항목은 값이 있는 것만 담긴다(3-state 중 "값 있음"만) — 라벨·값 둘 다 비어있지 않아야 함
    #expect(detail.facilities.allSatisfy { !$0.label.isEmpty && !$0.value.isEmpty })
}

@Test func matchFixtureDecodesSameEnvelope() throws {
    let result = try JSONDecoder().decode(BarrierFreeDetailResponse.self, from: fixture("barrier-free-match"))
    guard let detail = result.detail else { Issue.record("detail이 nil이면 안 됨"); return }
    #expect(!detail.facilities.isEmpty)
    #expect(detail.facilities.allSatisfy { !$0.label.isEmpty && !$0.value.isEmpty })
}

@Test func detailNullEnvelopeDecodesToNil() throws {
    let json = #"{"detail":null}"#
    let result = try JSONDecoder().decode(BarrierFreeDetailResponse.self, from: Data(json.utf8))
    #expect(result.detail == nil)
}

@Test func matchReturnsNilOnNetworkError() async {
    // 존재하지 않는 baseURL(연결 거부) 주입 — match는 throw 대신 nil로 수렴해야 한다(웹 계약).
    let client = APIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
    let service = BarrierFreeService(client: client)
    let detail = await service.match(lat: 37.5665986816, lng: 126.9783710306, name: "존재하지않는장소")
    #expect(detail == nil)
}
