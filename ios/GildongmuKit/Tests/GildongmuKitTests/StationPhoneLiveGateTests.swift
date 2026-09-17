import Testing
import Foundation
@testable import GildongmuKit

// 역 전화번호 실호출 게이트(E44 spec §8). 기본은 꺼져 있다 — `STATION_PHONE_GATE=<expected.json>`일 때만 돈다.
// 실제 `StationPhoneService`(검색어 조립·디코딩·선택)를 프로덕션 `/api/places`에 부르고, 사람이 원본 응답을 읽어
// 적은 기대표와 대조한다(규칙으로 기대표를 만들지 않는다 — 순환 판정 금지). 입력·기대표는 저장소 밖에 둔다.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["STATION_PHONE_GATE"] != nil))
struct StationPhoneLiveGateTests {
    struct Case: Decodable {
        let name: String
        let lineName: String
        let lat: Double
        let lng: Double
        /// "direct" | "representative" | "unavailable"
        let expect: String
        let phone: String?
    }

    @Test func matchesHandWrittenExpectations() async throws {
        let env = ProcessInfo.processInfo.environment
        let path = try #require(env["STATION_PHONE_GATE"])
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let base = URL(string: env["STATION_PHONE_GATE_BASE"] ?? "https://gildongmu.dodoplanet.space")!
        let service = StationPhoneService(client: APIClient(baseURL: base))
        var mismatches: [String] = []
        for item in cases {
            let got = await service.lookup(
                stationName: item.name, lat: item.lat, lng: item.lng, lineName: item.lineName)
            let want: StationPhoneResult = switch item.expect {
            case "direct": .direct(item.phone ?? "")
            case "representative": .representative(item.phone ?? "")
            default: .unavailable
            }
            if got != want { mismatches.append("\(item.name) · \(item.lineName): got \(got), want \(want)") }
            try await Task.sleep(for: .milliseconds(250))
        }
        print("[station-phone-gate] cases=\(cases.count) mismatches=\(mismatches.count)")
        for line in mismatches { print("  x \(line)") }
        #expect(mismatches.isEmpty)
    }
}
