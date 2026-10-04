import Testing
import Foundation
@testable import GildongmuKit

// M4 "한눈에 보기" — 서버 `/api/nearby/overview` 디코딩 + 결정론 문장 조립 계약
// (spec 2026-08-22-nearby-tab-restructure §3.1·§4·§6). 상태별 문장이 전부 달라야
// 한다(3-state 불변식: 0건 ≠ 정보 없음 ≠ 실패, 키 없음은 불릿 부재).

private let fixture = """
{"data":{"place":"서울특별시 강동구 길동, 천중로44길 74","radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","line":"5호선","bearing":"ne","distanceMeters":262},
  "busStops":{"state":"ok","count":5,"nearest":[{"name":"길동사거리","distanceMeters":80,"bearing":"e"},{"name":"길동역","distanceMeters":120,"bearing":"n"}]}},
 {"kind":"food","state":"ok","count":15,"countCapped":true,"nearest":[{"name":"가람식당","distanceMeters":40,"bearing":"s"},{"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
 {"kind":"cafe","state":"ok","count":3,"countCapped":false,"nearest":[{"name":"스타벅스","distanceMeters":90,"bearing":"w"},{"name":"카페 1971","distanceMeters":200,"bearing":"n"}]},
 {"kind":"kids","state":"none"},
 {"kind":"events","state":"unavailable","reason":"seoulOnly"},
 {"kind":"barrierFree","state":"failed"}
]}}
"""

private func decode(_ json: String) throws -> NearbyOverviewResponse {
    try JSONDecoder().decode(NearbyOverviewResponse.self, from: Data(json.utf8))
}

@Test func overviewDecodesEveryBulletState() throws {
    let data = try #require(try decode(fixture).data)
    #expect(data.place == "서울특별시 강동구 길동, 천중로44길 74")
    #expect(data.radiusMeters == 1000)
    #expect(data.bullets.count == 6)
    guard case .transit(let station, let bus) = data.bullets[0] else { Issue.record("transit"); return }
    #expect(station?.name == "길동")
    #expect(station?.line == "5호선")
    guard case .ok(let count, let nearest) = bus else { Issue.record("bus"); return }
    #expect(count == 5)
    #expect(nearest.map(\.name) == ["길동사거리", "길동역"])
    guard case .place(.food, .ok(let fc, let capped, let fn)) = data.bullets[1] else { Issue.record("food"); return }
    #expect(fc == 15 && capped && fn.count == 2)
    guard case .place(.cafe, .ok(let cc, let cCapped, _)) = data.bullets[2] else { Issue.record("cafe"); return }
    #expect(cc == 3 && !cCapped)
    guard case .place(.kids, .empty) = data.bullets[3] else { Issue.record("kids"); return }
    guard case .place(.events, .unavailableSeoulOnly) = data.bullets[4] else { Issue.record("events"); return }
    guard case .place(.barrierFree, .failed) = data.bullets[5] else { Issue.record("bf"); return }
}

@Test func overviewBulletsWithUnknownKindOrStateAreDroppedNotFatal() throws {
    // 서버가 종류·상태를 늘려도 화면이 통째로 죽지 않는다(NearbyModels 원칙: 모르는 값에 관대).
    let json = """
    {"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"weather","state":"ok"},{"kind":"kids","state":"ok","count":1,"countCapped":false,"nearest":[]}]}}
    """
    let data = try #require(try decode(json).data)
    #expect(data.bullets.count == 1)
}

@Test func overviewBusStopsNullMeansBusSliceGated() throws {
    let json = """
    {"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"transit","state":"ok","station":null,"busStops":null}]}}
    """
    let data = try #require(try decode(json).data)
    guard case .transit(let station, let bus) = data.bullets[0] else { Issue.record("transit"); return }
    #expect(station == nil)
    #expect(bus == nil)
}

@Test func overviewLinesKoAreOnePerBulletAndDistinctPerState() throws {
    let data = try #require(try decode(fixture).data)
    let lines = buildOverviewLines(data, lang: "ko").map(\.text)
    // 문장형 + 받침에 따른 조사(이/가·은/는)는 코드가 고른다(koParticle). 거리·방위가 이름 앞이다.
    #expect(lines == [
        "가장 가까운 지하철역은 북동쪽 262m 지점에 있는 5호선 길동입니다. 버스 정류소가 5곳 있습니다. 가장 가까운 곳은 동쪽 80m 지점에 있는 길동사거리이고, 북쪽 120m 지점에 길동역이 있습니다.",
        "식당이 15곳 이상 있습니다. 가장 가까운 곳은 남쪽 40m 지점에 있는 가람식당이고, 동쪽 60m 지점에 김밥천국이 있습니다.",
        "카페가 3곳 있습니다. 가장 가까운 곳은 서쪽 90m 지점에 있는 스타벅스이고, 북쪽 200m 지점에 카페 1971 있습니다.",
        "아이 놀 곳은 1km 안에 없습니다.",
        "문화 행사는 서울에서만 안내합니다.",
        "무장애 관광지 정보를 가져오지 못했습니다.",
    ])
}

@Test func overviewTransitVariantsKo() throws {
    func line(_ bullets: String) throws -> String {
        let data = try #require(try decode("{\"data\":{\"place\":null,\"radiusMeters\":1000,\"bullets\":[\(bullets)]}}").data)
        return buildOverviewLines(data, lang: "ko")[0].text
    }
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":{"state":"none"}}"#)
        == "1km 안에 지하철역이 없습니다. 버스 정류소가 없습니다.")
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":{"state":"uncovered"}}"#)
        == "1km 안에 지하철역이 없습니다. 버스 정류소 정보는 이 지역에서 제공되지 않습니다.")
    #expect(try line(#"{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":{"state":"failed"}}"#)
        == "가장 가까운 지하철역은 서쪽 910m 지점에 있는 용문입니다. 버스 정류소 정보를 가져오지 못했습니다.")
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":null}"#)
        == "1km 안에 지하철역이 없습니다.")
    // 버스 조각 자체가 없으면(키 없음) 역 문장만.
    #expect(try line(#"{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":null}"#)
        == "가장 가까운 지하철역은 서쪽 910m 지점에 있는 용문입니다.")
}

@Test func overviewLinesEnUseLocaleOrder() throws {
    let data = try #require(try decode(fixture).data)
    let lines = buildOverviewLines(data, lang: "en").map(\.text)
    #expect(lines[1] == "Restaurants: 15 or more. The nearest are 가람식당, 40m to the south, 김밥천국, 60m to the east.")
    #expect(lines[2] == "Cafes: 3. The nearest are 스타벅스, 90m to the west, 카페 1971, 200m to the north.")
    #expect(lines[3] == "Places for kids: none within 1km.")
    // 조사는 ko에서만 붙는다.
    #expect(lines[0].hasPrefix("Transit: The nearest subway station is 길동 (5호선), 262m to the northeast."))
}

@Test func overviewNearestUsesSingularSentenceForOnePlace() throws {
    // 한 곳뿐이면 나열이 없어 조사 자리도 없다(nearestOne). 조사 판정 불가 축은 위 fixture의 "카페 1971"이 덮는다.
    let json = """
    {"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"cafe","state":"ok","count":1,"countCapped":false,"nearest":[{"name":"GS25","distanceMeters":40,"bearing":"s"}]}]}}
    """
    let data = try #require(try decode(json).data)
    #expect(buildOverviewLines(data, lang: "ko").map(\.text) == ["카페가 1곳 있습니다. 가장 가까운 곳은 남쪽 40m 지점에 있는 GS25입니다."])
}

@Test func sceneItemToPlaceCarriesCoordinatesAndRawCategory() {
    let item = SurroundingsSceneItem(
        name: "서울신명초등학교", distanceMeters: 75, road: nil, category: "school",
        id: "kakao-1", lat: 37.5415, lng: 127.1503, categoryRaw: "교육,학문 > 학교 > 초등학교",
        roadAddress: "서울특별시 강동구 명일로24길 33", phone: "02-000-0000", link: "https://place.map.kakao.com/1")
    let place = sceneItemToPlace(item)
    #expect(place.id == "kakao-1")
    #expect(place.name == "서울신명초등학교")
    #expect(place.category == "교육,학문 > 학교 > 초등학교")
    #expect(place.roadAddress == "서울특별시 강동구 명일로24길 33")
    #expect(place.lat == 37.5415 && place.lng == 127.1503)
    #expect(place.phone == "02-000-0000")
    #expect(place.distanceMeters == 75)
}

@Test func sceneItemDecodesNewFields() throws {
    let json = """
    {"name":"가람식당","distanceMeters":47,"road":"성내로","category":"restaurant","id":"kakao-2","lat":37.54,"lng":127.15,"categoryRaw":"음식점 > 한식","roadAddress":null}
    """
    let item = try JSONDecoder().decode(SurroundingsSceneItem.self, from: Data(json.utf8))
    #expect(item.id == "kakao-2")
    #expect(item.roadAddress == nil)
    #expect(item.phone == nil)
}

@Test func overviewLinesEnUseRomanAndCollectKoreanSecondary() throws {
    // 비-ko: 역은 seed 영문(nameEn) 우선, 장소는 nameRoman, 한글 없는 이름(GS25)은 병기하지 않는다(E28).
    let json = """
    {"data":{"place":null,"radiusMeters":1000,"bullets":[
      {"kind":"transit","state":"ok","station":{"name":"길동역","nameEn":"Gil-dong","line":"5호선","bearing":"n","distanceMeters":200},"busStops":null},
      {"kind":"kids","state":"ok","count":2,"countCapped":false,"nearest":[
        {"name":"길동어린이공원","nameRoman":"Gildongeorinigongwon","distanceMeters":300,"bearing":"w"},
        {"name":"GS25","nameRoman":"GS25","distanceMeters":400,"bearing":"e"}]}]}}
    """
    let data = try #require(try decode(json).data)
    let lines = buildOverviewLines(data, lang: "en")
    #expect(lines[0].text.contains("Gil-dong"))
    #expect(!lines[0].text.contains("길동역"))
    #expect(lines[0].secondary == "길동역")
    #expect(lines[1].text.contains("Gildongeorinigongwon, 300m to the west"))
    #expect(lines[1].secondary == "길동어린이공원")
    #expect(lines[1].display.hasSuffix(" (길동어린이공원)"))
}

// MARK: - E65 문장 속 상세 진입 대상(옵트인 `places=1`)

private let detailFixture = """
{"data":{"place":null,"radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","nameEn":"Gildong","line":"5호선","bearing":"ne","distanceMeters":262,"lat":37.5378,"lng":127.1401},
  "busStops":{"state":"ok","count":1,"nearest":[{"name":"길동사거리","distanceMeters":80,"bearing":"e"}]}},
 {"kind":"food","state":"ok","count":3,"countCapped":false,"nearest":[
   {"name":"가람식당","nameRoman":"Garam Sikdang","distanceMeters":40,"bearing":"s","place":{"id":"k1","name":"가람식당","category":"음식점 > 한식","address":"","roadAddress":"서울 강동구 천중로 1","lat":37.5,"lng":127.1,"phone":"02-000-0000"}},
   {"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
 {"kind":"events","state":"ok","count":1,"countCapped":false,"nearest":[
   {"name":"가을 음악회","distanceMeters":300,"bearing":"w","event":{"id":"seoul-1","title":"가을 음악회","category":"콘서트","place":"구민회관","district":"강동구","dateText":"2026-10-01~2026-10-31","timeText":"19:30","isFree":true,"target":"누구나","lat":37.53,"lng":127.13,"distanceMeters":300}}]},
 {"kind":"kids","state":"none"}
]}}
"""

@Test func overviewDetailTargetsFollowSentenceOrderAndSkipWhatHasNoDetail() throws {
    let data = try #require(try decode(detailFixture).data)
    let transit = overviewDetailTargets(data.bullets[0], lang: "ko")
    // 역만 대상이다 — 정류소는 상세 화면이 없다(죽은 액션 금지).
    #expect(transit.map(\.name) == ["길동"])
    #expect(transit[0].isStation)
    #expect(transit[0].lineHint == "5호선")
    #expect(transit[0].place.lat == 37.5378 && transit[0].place.category == "지하철역")
    // 옵트인 재료가 없는 항목(김밥천국)은 빠진다. 있는 항목은 문장 순서대로.
    let food = overviewDetailTargets(data.bullets[1], lang: "ko")
    #expect(food.map(\.place.id) == ["k1"])
    #expect(food[0].place.phone == "02-000-0000")
    #expect(!food[0].isStation && food[0].event == nil)
    // 행사는 원본을 함께 싣는다(상세의 행사 섹션 재료).
    let events = overviewDetailTargets(data.bullets[2], lang: "ko")
    #expect(events.map(\.place.id) == ["seoul-1"])
    #expect(events[0].event?.dateText == "2026-10-01~2026-10-31")
    #expect(overviewDetailTargets(data.bullets[3], lang: "ko").isEmpty)
}

@Test func overviewDetailTargetNamesMatchTheSentence() throws {
    let data = try #require(try decode(detailFixture).data)
    let lines = buildOverviewLines(data, lang: "en")
    for (bullet, line) in zip(data.bullets, lines) {
        for target in overviewDetailTargets(bullet, lang: "en") {
            #expect(line.text.contains(target.name), "\(target.name) not in \(line.text)")
        }
    }
    #expect(overviewDetailTargets(data.bullets[1], lang: "en").map(\.name) == ["Garam Sikdang"])
    #expect(overviewDetailTargets(data.bullets[0], lang: "en").map(\.name) == ["Gildong"])
}

@Test func overviewWithoutDetailFieldsHasNoTargets() throws {
    // 옵트인 이전 응답(스토어 웹 배포 전)은 대상 0 — 액션 없이 종전 화면 그대로.
    let data = try #require(try decode(fixture).data)
    #expect(data.bullets.allSatisfy { overviewDetailTargets($0, lang: "ko").isEmpty })
}

@Test func nearbySubwayStationDecodesOptionalCoords() throws {
    let json = #"{"stations":[{"stationName":"잠실","lines":["2호선","8호선"],"distanceMeters":120,"arrivalStatus":"unknown","arrivals":[],"lat":37.5133,"lng":127.1001},{"stationName":"잠실나루","lines":["2호선"],"distanceMeters":900,"arrivalStatus":"unknown","arrivals":[]}]}"#
    let r = try JSONDecoder().decode(SubwayNearbyResponse.self, from: Data(json.utf8))
    #expect(r.stations[0].lat == 37.5133 && r.stations[0].lng == 127.1001)
    #expect(r.stations[1].lat == nil)
}


@Test func brokenOptInDetailDropsOnlyThatActionNotTheSentences() throws {
    // 옵트인 재료가 깨져도(필수 키 누락) 문장 재료는 살고, 그 장소의 상세 대상만 빠진다.
    let json = """
    {"data":{"place":null,"radiusMeters":1000,"bullets":[
     {"kind":"food","state":"ok","count":2,"countCapped":false,"nearest":[
       {"name":"가람식당","distanceMeters":40,"bearing":"s","place":{"id":"k1","name":"가람식당"}},
       {"name":"김밥천국","distanceMeters":60,"bearing":"e","place":{"id":"k2","name":"김밥천국","category":"c","address":"","roadAddress":"","lat":37.5,"lng":127.1}}]}
    ]}}
    """
    let data = try #require(try decode(json).data)
    guard case .place(.food, .ok(_, _, let nearest)) = data.bullets[0] else { Issue.record("food"); return }
    #expect(nearest.map(\.name) == ["가람식당", "김밥천국"])
    #expect(overviewDetailTargets(data.bullets[0], lang: "ko").map(\.place.id) == ["k2"])
}

@Test func nearbyStationLineHintPrefersAKnownLine() {
    // 노선 표가 모르는 노선이 앞에 와도 아는 노선을 고른다(전화 조회는 같은 노선 후보만 본다).
    #expect(nearbyStationLineHint(lines: ["미지선", "2호선"]) == "2호선")
    #expect(nearbyStationLineHint(lines: ["2호선", "8호선"]) == "2호선")
    // 아는 노선이 없으면 첫 노선(조회는 "없음"으로 끝난다), 빈 목록은 nil.
    #expect(nearbyStationLineHint(lines: ["미지선"]) == "미지선")
    #expect(nearbyStationLineHint(lines: []) == nil)
}
