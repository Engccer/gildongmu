import Testing
import Foundation
@testable import GildongmuKit

/// 경로 브리핑의 역 진입점 판정(E45, spec 2026-09-18-briefing-station-entry-design §3.2).
///
/// 이 스위트가 지키는 것은 **정체성**이다 — 줄에서 들린 이름과 열리는 역이 같아야 한다. 그래서
/// `stops.first`/`stops.last` 같은 위치 인덱스를 쓰면 빨개지는 fixture(역순 목록·부분 목록·같은 이름
/// 두 번)를 함께 둔다. 조인이 실패하면 진입점은 **없다**(추측으로 고르지 않는다).
struct TransitBriefingStationsTests {
    // MARK: fixture

    private func stop(_ name: String, lat: Double = 37.5, lng: Double = 127.0, nameEn: String? = nil) -> TransitLegStop {
        TransitLegStop(name: name, lat: lat, lng: lng, nameEn: nameEn)
    }

    private func subway(
        line: String? = "수도권 5호선", from: String? = "천호", to: String? = "여의도",
        stops: [TransitLegStop]? = nil
    ) -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "subway", lineName: line, fromName: from, toName: to, stationCount: 10, minutes: 25,
            serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, stops: stops)
    }

    private func bus(from: String? = "천호역", to: String? = "강변역", stops: [TransitLegStop]? = nil) -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "bus", lineName: "342", fromName: from, toName: to, stationCount: 5, minutes: 12,
            serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, stops: stops)
    }

    private func walk(to: String? = "천호") -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "walk", lineName: nil, fromName: nil, toName: to, stationCount: nil, minutes: 3,
            serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, distanceMeters: 180)
    }

    /// 5호선 천호 → 여의도 정차역(일부)
    private var line5Stops: [TransitLegStop] {
        [stop("천호", lat: 37.538), stop("광나루", lat: 37.545), stop("여의도", lat: 37.521)]
    }

    // MARK: .transit — 구간 줄

    @Test func 구간_줄은_승차_하차_둘을_등장_순으로_준다() {
        let legs = [subway(stops: line5Stops)]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호", "여의도"])
        #expect(out.allSatisfy { $0.lineName == "수도권 5호선" })
    }

    @Test func 정차역_목록이_역순으로_와도_이름으로_찾는다() {
        // 위치 인덱스(first/last)로 고르면 승차·하차가 뒤바뀐다 — 반대편 승강장 안내가 되는 자리.
        let legs = [subway(stops: line5Stops.reversed())]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호", "여의도"])
        #expect(out.first?.stop.lat == 37.538)
    }

    @Test func 첫_항목이_떨어진_부분_목록에서는_승차가_빠지고_하차만_남는다() {
        // 서버 `toLegStops`가 좌표·이름 무효 항목을 flatMap으로 떨어뜨린다 — first가 조용히 중간역이 된다.
        let legs = [subway(stops: [stop("광나루", lat: 37.545), stop("여의도", lat: 37.521)])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["여의도"])
    }

    @Test func 마지막_항목이_떨어진_부분_목록에서는_하차가_빠지고_승차만_남는다() {
        let legs = [subway(stops: [stop("천호", lat: 37.538), stop("광나루", lat: 37.545)])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호"])
    }

    @Test func 같은_이름이_두_번_나오면_승차는_앞에서_하차는_뒤에서_찾는다() {
        // 순환선 왕복 — 좌표가 다른 두 항목이라 앞·뒤 방향이 결과를 가른다.
        let legs = [subway(from: "시청", to: "시청", stops: [
            stop("시청", lat: 37.5651), stop("을지로입구", lat: 37.566), stop("시청", lat: 37.5659),
        ])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        // 정규화 결과가 같아 한 건으로 접힌다(규칙 5) — 접기 전에 각각 찾았는지는 좌표로 본다.
        #expect(out.count == 1)
        #expect(out.first?.stop.lat == 37.5651)
    }

    @Test func 승차와_하차가_같은_역이면_한_건으로_접는다() {
        let legs = [subway(from: "천호", to: "천호역", stops: [stop("천호", lat: 37.538)])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호"])
    }

    @Test func 부역명_괄호와_역_접미_표기_차이를_흡수한다() {
        let legs = [subway(from: "천호역", to: "여의도(한국거래소)", stops: [
            stop("천호(풍납토성)", lat: 37.538), stop("여의도", lat: 37.521),
        ])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호(풍납토성)", "여의도"])
    }

    @Test func 구간_줄의_이름이_빈_문자열이면_그_쪽은_진입점이_없다() {
        // `transitLegText`는 ""도 값으로 통과시켜 "에서 승차"를 낸다 — non-nil 게이트면 라벨이 " 상세 보기"가 된다.
        let legs = [subway(from: "", stops: line5Stops)]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["여의도"])
    }

    @Test func 빈_이름끼리_조인되지_않는다() {
        // 이름 게이트가 **두 겹**이라 이 케이스만이 바깥 겹(non-empty)의 효과를 잰다. 정규화 뒤 빈 문자열을
        // 거부하는 안쪽 겹은 정상 역 이름만 있는 목록에서 같은 결과를 내기 때문이다. 서버가 이름 무효 항목을
        // 떨어뜨리지만 만약 남으면 빈 이름끼리 맞아떨어져 라벨이 " 상세 보기"가 된다(spec §3.2 규칙 3).
        let legs = [subway(from: "", to: "여의도", stops: [stop(""), stop("여의도", lat: 37.521)])]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.map(\.stop.name) == ["여의도"])
    }

    @Test func 조인에_실패하면_진입점이_없다() {
        let legs = [subway(from: "없는역", to: "다른역", stops: line5Stops)]
        #expect(transitBriefingStations(legs, row: .transit(legIndex: 0)).isEmpty)
    }

    @Test func 정차역_목록이_없으면_진입점이_없다() {
        #expect(transitBriefingStations([subway(stops: nil)], row: .transit(legIndex: 0)).isEmpty)
        #expect(transitBriefingStations([subway(stops: [])], row: .transit(legIndex: 0)).isEmpty)
    }

    @Test func 버스_구간에는_진입점이_없다() {
        let legs = [bus(stops: [stop("천호역", lat: 37.538), stop("강변역", lat: 37.535)])]
        #expect(transitBriefingStations(legs, row: .transit(legIndex: 0)).isEmpty)
        #expect(transitBriefingStations(legs, row: .alight(legIndex: 0)).isEmpty)
    }

    @Test func 노선명이_비면_힌트는_없음이다() {
        let legs = [subway(line: "", stops: line5Stops)]
        let out = transitBriefingStations(legs, row: .transit(legIndex: 0))
        #expect(out.count == 2)
        #expect(out.allSatisfy { $0.lineName == nil })
    }

    // MARK: .alight — 하차 줄

    @Test func 하차_줄은_하차역_하나를_뒤에서부터_찾는다() {
        let legs = [subway(stops: line5Stops)]
        let out = transitBriefingStations(legs, row: .alight(legIndex: 0))
        #expect(out.map(\.stop.name) == ["여의도"])
        #expect(out.first?.lineName == "수도권 5호선")
    }

    @Test func 하차_줄의_대상은_구간_줄의_하차_항목과_같다() {
        let legs = [subway(from: "시청", to: "시청", stops: [
            stop("시청", lat: 37.5651), stop("을지로입구", lat: 37.566), stop("시청", lat: 37.5659),
        ])]
        let alight = transitBriefingStations(legs, row: .alight(legIndex: 0))
        #expect(alight.first?.stop.lat == 37.5659)
    }

    @Test func 하차_줄의_이름이_없거나_비면_진입점이_없다() {
        #expect(transitBriefingStations([subway(to: nil, stops: line5Stops)], row: .alight(legIndex: 0)).isEmpty)
        #expect(transitBriefingStations([subway(to: "", stops: line5Stops)], row: .alight(legIndex: 0)).isEmpty)
    }

    // MARK: .walk — 도보 줄

    @Test func 도보_줄은_다음_지하철_구간의_승차역을_준다() {
        let legs = [walk(to: "천호"), subway(stops: line5Stops)]
        let out = transitBriefingStations(legs, row: .walk(legIndex: 0))
        #expect(out.map(\.stop.name) == ["천호"])
        #expect(out.first?.lineName == "수도권 5호선")
    }

    @Test func 도보가_연달아_둘이면_두_줄이_같은_역을_가리킨다() {
        // 서버가 도보 줄의 행선지 이름을 **다음 non-walk leg**에서 복사한다 — `legs[i+1]`만 보면
        // 같은 이름인데 한 줄에만 진입점이 생긴다.
        let legs = [walk(to: "천호"), walk(to: "천호"), subway(stops: line5Stops)]
        let first = transitBriefingStations(legs, row: .walk(legIndex: 0))
        let second = transitBriefingStations(legs, row: .walk(legIndex: 1))
        #expect(first.map(\.stop.name) == ["천호"])
        #expect(first == second)
    }

    @Test func 다음_탑승이_버스면_도보_줄에_진입점이_없다() {
        let legs = [walk(to: "천호역"), bus(stops: [stop("천호역", lat: 37.538)])]
        #expect(transitBriefingStations(legs, row: .walk(legIndex: 0)).isEmpty)
    }

    @Test func 마지막_도보에는_진입점이_없다() {
        let legs = [subway(stops: line5Stops), walk(to: nil)]
        #expect(transitBriefingStations(legs, row: .walk(legIndex: 1)).isEmpty)
    }

    @Test func 도보_줄의_다음_구간_승차역이_정차역_목록에_없으면_진입점이_없다() {
        // 서버가 도보 줄의 행선지를 다음 non-walk leg의 `fromName`으로 **덮으므로**(odsay.ts:413-422)
        // 줄에 들린 이름과 조인에 쓰는 이름은 같은 값이다. 어긋날 수 있는 것은 이름이 아니라 **목록**이다.
        let legs = [walk(to: "천호"), subway(from: "천호", stops: [stop("광나루"), stop("여의도")])]
        #expect(transitBriefingStations(legs, row: .walk(legIndex: 0)).isEmpty)
    }

    @Test func 도보_줄의_다음_구간_승차역_이름이_비면_진입점이_없다() {
        // 그 경우 서버는 `toName`을 덮지 않는다 — 줄에도 역 이름이 들리지 않으므로 진입점도 없어야 한다.
        let legs = [walk(to: "천호"), subway(from: "", stops: line5Stops)]
        #expect(transitBriefingStations(legs, row: .walk(legIndex: 0)).isEmpty)
    }

    @Test func 도보가_아닌_구간에_도보_줄_판정을_걸면_진입점이_없다() {
        let legs = [subway(stops: line5Stops)]
        #expect(transitBriefingStations(legs, row: .walk(legIndex: 0)).isEmpty)
    }

    @Test func 범위_밖_인덱스는_진입점이_없다() {
        let legs = [subway(stops: line5Stops)]
        #expect(transitBriefingStations(legs, row: .transit(legIndex: 3)).isEmpty)
        #expect(transitBriefingStations(legs, row: .alight(legIndex: -1)).isEmpty)
        #expect(transitBriefingStations([], row: .walk(legIndex: 0)).isEmpty)
    }

    // MARK: 전화 3상태 → 통지·진동

    @Test func 번호가_있으면_통지하지_않는다() {
        #expect(briefingPhoneAnnouncement(.direct("02-6311-5331")) == nil)
        #expect(briefingPhoneAnnouncement(.representative("1544-7788")) == nil)
    }

    @Test func 번호_없음은_없다고_말하고_주의_진동() {
        let out = briefingPhoneAnnouncement(.unavailable)
        #expect(out?.key == "ios.station.phoneMissing")
        #expect(out?.haptic == .attention)
    }

    @Test func 모름은_찾고_있다고_말하고_주의_진동() {
        let out = briefingPhoneAnnouncement(nil)
        #expect(out?.key == "ios.station.phonePending")
        #expect(out?.haptic == .attention)
    }

    @Test func 조회_실패는_실패로_말하고_실패_진동() {
        let out = briefingPhoneAnnouncement(.failed)
        #expect(out?.key == "ios.station.phoneError")
        #expect(out?.haptic == .failure)
    }
}
