import Testing
@testable import GildongmuKit

// 도보 구간 문구 키·인자 순서(D8). 잠그는 것은 "어떤 조합이 어떤 키가 되고 인자가
// 어느 순서로 가는가"뿐 — 문구 자체는 앱 카탈로그가 정본이다.

@Suite("대중교통 도보 구간 문구 키")
struct TransitWalkLegTextTests {
    @Test("이름·거리 모두 — (name, minutes, distance)")
    func both() {
        let r = TransitWalkLegText.resolve(name: "천호역", distance: "350m", minutes: 5)
        #expect(r.key == "route.transit.legWalkTo")
        #expect(r.args == ["천호역", "5", "350m"])
    }

    @Test("이름만 — (name, minutes)")
    func nameOnly() {
        let r = TransitWalkLegText.resolve(name: "천호역", distance: nil, minutes: 5)
        #expect(r.key == "route.transit.legWalkToNoDistance")
        #expect(r.args == ["천호역", "5"])
    }

    @Test("거리만 — 목적지 문구 (minutes, distance)")
    func distanceOnly() {
        let r = TransitWalkLegText.resolve(name: nil, distance: "1.2km", minutes: 15)
        #expect(r.key == "route.transit.legWalkToDest")
        #expect(r.args == ["15", "1.2km"])
    }

    @Test("둘 다 없음 — (minutes)")
    func neither() {
        let r = TransitWalkLegText.resolve(name: nil, distance: nil, minutes: 3)
        #expect(r.key == "route.transit.legWalkToDestNoDistance")
        #expect(r.args == ["3"])
    }

    @Test("빈 이름은 이름 없음으로 접는다")
    func emptyNameIsNil() {
        #expect(TransitWalkLegText.resolve(name: "", distance: nil, minutes: 3).key
                == "route.transit.legWalkToDestNoDistance")
    }

    // MARK: 승차 출구(E25) — 다음 구간의 승차 출구를 이 줄이 싣는다

    @Test("이름 + 출구 + 거리 — (name, exit, minutes, distance)")
    func nameExitDistance() {
        let r = TransitWalkLegText.resolve(name: "개화", distance: "131m", minutes: 2, boardExit: "1")
        #expect(r.key == "route.transit.legWalkToExit")
        #expect(r.args == ["개화", "1", "2", "131m"])
    }

    @Test("이름 + 출구, 거리 없음 — (name, exit, minutes)")
    func nameExitNoDistance() {
        let r = TransitWalkLegText.resolve(name: "개화", distance: nil, minutes: 2, boardExit: "1")
        #expect(r.key == "route.transit.legWalkToExitNoDistance")
        #expect(r.args == ["개화", "1", "2"])
    }

    @Test("이름이 없으면 출구가 있어도 목적지 문구다(붙일 자리가 없다)")
    func exitWithoutNameFallsBack() {
        let r = TransitWalkLegText.resolve(name: nil, distance: "131m", minutes: 2, boardExit: "1")
        #expect(r.key == "route.transit.legWalkToDest")
        #expect(r.args == ["2", "131m"])
    }

    @Test("출구가 없으면 종전 키 그대로다")
    func noExitKeepsLegacyKeys() {
        #expect(TransitWalkLegText.resolve(name: "개화", distance: "131m", minutes: 2, boardExit: nil).key
                == "route.transit.legWalkTo")
        #expect(TransitWalkLegText.resolve(name: "개화", distance: "131m", minutes: 2, boardExit: "").key
                == "route.transit.legWalkTo")
    }
}
