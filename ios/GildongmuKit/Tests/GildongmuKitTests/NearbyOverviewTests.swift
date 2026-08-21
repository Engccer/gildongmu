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
 {"kind":"food","state":"ok","count":30,"countCapped":true,"nearest":[{"name":"스타벅스","distanceMeters":40,"bearing":"s"},{"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
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
    #expect(data.bullets.count == 5)
    guard case .transit(let station, let bus) = data.bullets[0] else { Issue.record("transit"); return }
    #expect(station?.name == "길동")
    #expect(station?.line == "5호선")
    guard case .ok(let count, let nearest) = bus else { Issue.record("bus"); return }
    #expect(count == 5)
    #expect(nearest.map(\.name) == ["길동사거리", "길동역"])
    guard case .place(.food, .ok(let fc, let capped, let fn)) = data.bullets[1] else { Issue.record("food"); return }
    #expect(fc == 30 && capped && fn.count == 2)
    guard case .place(.kids, .empty) = data.bullets[2] else { Issue.record("kids"); return }
    guard case .place(.events, .unavailableSeoulOnly) = data.bullets[3] else { Issue.record("events"); return }
    guard case .place(.barrierFree, .failed) = data.bullets[4] else { Issue.record("bf"); return }
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
    let lines = buildOverviewLines(data, lang: "ko")
    #expect(lines == [
        "대중교통: 지하철 길동(5호선) 북동쪽 262m, 버스 정류소 5곳, 가장 가까운 곳은 동쪽 80m 길동사거리, 북쪽 120m 길동역",
        "식당과 카페 30곳 이상, 가장 가까운 곳은 남쪽 40m 스타벅스, 동쪽 60m 김밥천국",
        "아이 놀 곳은 1km 안에 없습니다",
        "문화 행사는 서울에서만 안내합니다",
        "무장애 관광지 정보를 가져오지 못했습니다",
    ])
}

@Test func overviewTransitVariantsKo() throws {
    func line(_ bullets: String) throws -> String {
        let data = try #require(try decode("{\"data\":{\"place\":null,\"radiusMeters\":1000,\"bullets\":[\(bullets)]}}").data)
        return buildOverviewLines(data, lang: "ko")[0]
    }
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":{"state":"none"}}"#)
        == "대중교통: 1km 안에 지하철역이 없고, 버스 정류소가 없습니다")
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":{"state":"uncovered"}}"#)
        == "대중교통: 1km 안에 지하철역이 없고, 버스 정류소 정보는 이 지역에서 제공되지 않습니다")
    #expect(try line(#"{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":{"state":"failed"}}"#)
        == "대중교통: 지하철 용문 서쪽 910m, 버스 정류소 정보를 가져오지 못했습니다")
    #expect(try line(#"{"kind":"transit","state":"ok","station":null,"busStops":null}"#)
        == "대중교통: 1km 안에 지하철역이 없습니다")
    // 버스 조각 자체가 없으면(키 없음) 역 문장만.
    #expect(try line(#"{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":null}"#)
        == "대중교통: 지하철 용문 서쪽 910m")
}

@Test func overviewLinesEnUseLocaleOrder() throws {
    let data = try #require(try decode(fixture).data)
    let lines = buildOverviewLines(data, lang: "en")
    #expect(lines[1] == "Restaurants and cafes: 30 or more, nearest: 스타벅스, 40m to the south, 김밥천국, 60m to the east")
    #expect(lines[2] == "Places for kids: none within 1km")
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
    {"name":"봉래면옥","distanceMeters":62,"road":"명일로","category":"restaurant","id":"kakao-2","lat":37.54,"lng":127.15,"categoryRaw":"음식점 > 한식","roadAddress":null}
    """
    let item = try JSONDecoder().decode(SurroundingsSceneItem.self, from: Data(json.utf8))
    #expect(item.id == "kakao-2")
    #expect(item.roadAddress == nil)
    #expect(item.phone == nil)
}
