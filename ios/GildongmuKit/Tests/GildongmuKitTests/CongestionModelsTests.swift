import Testing
import Foundation
@testable import GildongmuKit

// 실시간 인구 혼잡도 계약 테스트.
// Fixtures/congestion-nearby.json은 **실호출 캡처**다(2026-08-01 14:00, 강남역
// 좌표 37.4979,127.0276로 /api/congestion/nearby 응답 원문). 손으로 지어낸 예시를
// 두면 필드 이름은 맞아도 값의 모양이 실제와 어긋날 수 있어 계약 검증이 헐거워진다.

@Test func congestionNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(CongestionNearbyResponse.self, from: fixture("congestion-nearby"))
    let area = try #require(result.area)
    #expect(area.code == "POI014")
    #expect(area.name == "강남역")
    #expect(CongestionLevelKey(levelText: area.level) == .busy)
    // 완성 문장은 낭독 정본(ko 전용), 비면 계약 위반
    #expect(!area.message.isEmpty)
    #expect(area.asOf == "2026-08-01 14:00")
}

// 서울 핫스팟 밖(서울의 91%)은 오류가 아니라 정상 응답의 null이다. 디코딩이 깨지면
// 화면 전체가 "조회 실패"로 전락한다(3-state 붕괴).
@Test func congestionAreaNullDecodesToNil() throws {
    let body = Data(#"{"area":null}"#.utf8)
    #expect(try JSONDecoder().decode(CongestionNearbyResponse.self, from: body).area == nil)
}

@Test func congestionLevelKeyMapsFourGrades() {
    #expect(CongestionLevelKey(levelText: "여유") == .relaxed)
    #expect(CongestionLevelKey(levelText: "보통") == .normal)
    #expect(CongestionLevelKey(levelText: "약간 붐빔") == .slightlyBusy)
    #expect(CongestionLevelKey(levelText: "붐빔") == .busy)
    // 원문에 공백이 섞여 와도 같은 등급으로 읽는다
    #expect(CongestionLevelKey(levelText: " 붐빔 ") == .busy)
}

// 서울시가 단계를 늘리면 표에 없는 등급어가 온다. nil이어야 소비자가 원문을 낭독한다.
// 임의 키로 접혀 들어가면 없는 등급을 단정하게 된다.
@Test func congestionLevelKeyIsNilForUnknownGrade() {
    #expect(CongestionLevelKey(levelText: "매우 붐빔") == nil)
    #expect(CongestionLevelKey(levelText: "") == nil)
}
