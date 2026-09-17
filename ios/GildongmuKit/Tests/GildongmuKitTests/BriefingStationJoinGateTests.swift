import Testing
import Foundation
@testable import GildongmuKit

// 실호출 게이트 2단 — 경로 브리핑 역 진입점(E45 spec §8). 기본은 꺼져 있다:
// `BRIEFING_JOIN_GATE=<scripts/verify-briefing-station-join.mjs 덤프>`일 때만 돈다.
//
// **판정 주체가 실제 구현이다.** 1단(Node 스크립트)은 ODsay 실응답을 덤프만 하고, 조인 성립 여부는 여기서
// `transitBriefingStations` 자신이 낸다 — 스크립트에 술어를 재현하면 "우리가 재현한 규칙이 우리 규칙과 같다"를
// 재는 순환 판정이 된다.
//
// ⚠ **선정 단계가 표본을 자른다.** 성립률만 보면 "확인하려는 케이스가 표본에 없었다"가 높은 성립률로 위장한다.
//   그래서 케이스별 존재를 **별도 단언**으로 두고 부재는 실패로 적는다(1단도 같은 축을 본다).
@Suite(.enabled(if: ProcessInfo.processInfo.environment["BRIEFING_JOIN_GATE"] != nil))
struct BriefingStationJoinGateTests {
    struct Dump: Decodable {
        let lang: String
        let capturedAt: String
        let samples: [Sample]
    }

    struct Sample: Decodable {
        let pair: String
        let routes: [Route]
    }

    struct Route: Decodable {
        let legs: [TransitRouteLeg]
    }

    /// 줄 하나의 판정 결과. `hasName`은 "줄에 역 이름이 들리는가", `joined`는 "그 이름으로 역을 찾았는가".
    private struct Verdict {
        let row: String
        let hasName: Bool
        let joined: Bool
        let detail: String
    }

    private func verdicts(_ legs: [TransitRouteLeg]) -> [Verdict] {
        var out: [Verdict] = []
        for (index, leg) in legs.enumerated() {
            if leg.mode == "walk" {
                // 도보 줄에 역 이름이 들리는 조건 = 다음 non-walk leg가 지하철이고 그 승차역 이름이 있다.
                let next = legs[legs.index(after: index)...].first { $0.mode != "walk" }
                let hasName = next?.mode == "subway" && !(next?.fromName ?? "").isEmpty
                let found = transitBriefingStations(legs, row: .walk(legIndex: index))
                out.append(Verdict(
                    row: "walk", hasName: hasName, joined: !found.isEmpty,
                    detail: "\(leg.toName ?? "(없음)") → \(next?.fromName ?? "(없음)")"))
            } else if leg.mode == "subway" {
                // 구간 줄은 이름이 둘까지 들린다 — 들린 수와 찾은 수를 각각 센다.
                let names = [leg.fromName, leg.toName].compactMap { $0 }.filter { !$0.isEmpty }
                let unique = Set(names.map(normalizeStopName)).count
                let found = transitBriefingStations(legs, row: .transit(legIndex: index))
                out.append(Verdict(
                    row: "transit", hasName: unique > 0, joined: found.count == unique,
                    detail: "\(leg.lineName ?? "?") \(names.joined(separator: "→")) · 들림 \(unique) 찾음 \(found.count)"))
                // 하차 줄은 하차역 이름이 있을 때만 선다.
                let alightName = leg.toName ?? ""
                let alight = transitBriefingStations(legs, row: .alight(legIndex: index))
                out.append(Verdict(
                    row: "alight", hasName: !alightName.isEmpty, joined: !alight.isEmpty,
                    detail: alightName))
            }
        }
        return out
    }

    @Test func joinsInRealResponses() throws {
        let path = try #require(ProcessInfo.processInfo.environment["BRIEFING_JOIN_GATE"])
        let dump = try JSONDecoder().decode(Dump.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        try #require(!dump.samples.isEmpty, "덤프가 비어 있다 — 판정한 사례가 없는 게이트는 실패다")

        var all: [Verdict] = []
        var transferTwice = 0
        var mixed = 0
        var adjacentSubway = 0
        for sample in dump.samples {
            for route in sample.routes {
                all.append(contentsOf: verdicts(route.legs))
                let boards = route.legs.filter { $0.mode != "walk" }
                if boards.count >= 3 { transferTwice += 1 }
                if route.legs.contains(where: { $0.mode == "bus" }),
                   route.legs.contains(where: { $0.mode == "subway" }) { mixed += 1 }
                for i in route.legs.indices.dropFirst()
                where route.legs[i].mode == "subway" && route.legs[i - 1].mode == "subway" {
                    adjacentSubway += 1
                }
            }
        }

        // 이름이 들리는 줄만 성립률의 분모다 — 이름이 없는 줄에 진입점이 없는 것은 정상이다.
        let audible = all.filter(\.hasName)
        let joined = audible.filter(\.joined)
        let failures = audible.filter { !$0.joined }
        let rate = audible.isEmpty ? 0 : Double(joined.count) / Double(audible.count)
        print("""

        [E45 조인 게이트] \(dump.capturedAt) lang=\(dump.lang)
          표본: \(dump.samples.count)OD · 줄 \(all.count)(이름 들림 \(audible.count))
          성립: \(joined.count)/\(audible.count) = \(String(format: "%.1f%%", rate * 100))
          케이스: 환승2회+ \(transferTwice)경로 · 버스↔지하철 \(mixed)경로 · 지하철 연속 \(adjacentSubway)자리
        """)
        for failure in failures.prefix(20) {
            print("  조인 실패 — \(failure.row): \(failure.detail)")
        }

        // 확인하려는 케이스가 표본에 실제로 있었는가. 부재는 미실측이고, 미실측은 통과가 아니다.
        #expect(transferTwice > 0, "환승 2회 이상 경로가 표본에 없다 — 미실측")
        #expect(mixed > 0, "버스↔지하철 혼합 경로가 표본에 없다 — 미실측")
        #expect(adjacentSubway > 0, "도보 줄 없는 지하철 연속 구간이 표본에 없다 — 미실측")

        // ⚠ 조인 실패율이 낮지 않으면 설계가 아니라 데이터 문제다 — 그때는 멈추고 사람이 본다.
        #expect(audible.count >= 20, "이름이 들리는 줄이 너무 적어 비율이 의미 없다")
        #expect(rate >= 0.99, "조인 성립률 \(String(format: "%.1f%%", rate * 100)) — 설계가 아니라 데이터를 본다")
    }
}
