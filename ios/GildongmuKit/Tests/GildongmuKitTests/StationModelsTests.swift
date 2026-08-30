import Testing
import Foundation
@testable import GildongmuKit

// 역·환경 계약 테스트: Fixtures/station-*.json·air-nearby.json·weather-nearby.json
// (prod 실캡처)이 계약 정본. 옵셔널 여부는 fixture + 웹 src/lib/types.ts 대조.

// MARK: - fixture 6종 디코딩

@Test func stationMetaFixtureDecodes() throws {
    let result = try JSONDecoder().decode(StationMetaResponse.self, from: fixture("station-meta"))
    let meta = try #require(result.meta)
    #expect(meta.name == "강동")
    #expect(meta.nameEn == "Gangdong")
    #expect(meta.lines == ["5호선"])
    #expect(meta.isTransfer == false)
    #expect(meta.operatorName == "서울교통공사")
    #expect(meta.nameHanja == "江東")
}

@Test func stationFacilitiesFixtureDecodes() throws {
    let result = try JSONDecoder().decode(StationFacilitiesResponse.self, from: fixture("station-facilities"))
    let facilities = try #require(result.facilities)
    #expect(facilities.stationName == "서울")
    #expect(facilities.accessibleToilet == true)
    // Int? 3-state: 값이 있으면 수, 없으면 nil="정보 없음"("0대"와 절대 뭉개지 않음)
    #expect(facilities.wheelchairLifts == 1)
    #expect(facilities.elevators == 18)
    #expect(facilities.accessibleSlope == true)
}

@Test func stationMetroFacilitiesFixtureDecodes() throws {
    let result = try JSONDecoder().decode(SeoulMetroFacilitiesResponse.self, from: fixture("station-metro-facilities"))
    let facilities = try #require(result.facilities)
    #expect(facilities.stationName == "강동")
    #expect(facilities.line == "5호선")
    #expect(!facilities.groups.isEmpty)
    #expect(facilities.groups.allSatisfy { !$0.facilities.isEmpty })
    // operatingStatus는 normal/stopped/nil(엘리베이터·에스컬레이터만 존재), fixture에 stopped 실측
    let statuses = facilities.groups.flatMap(\.facilities).compactMap(\.operatingStatus)
    #expect(Set(statuses).isSubset(of: ["normal", "stopped"]))
    #expect(statuses.contains("stopped"))
    // location·floors·detail 옵셔널: 안전발판은 이름만(실제 결측이 있어야 옵셔널 계약 검증)
    #expect(facilities.groups.flatMap(\.facilities).contains { $0.location == nil })
    // fixture는 구버전 캡처라 supplementFailed 필드 자체가 없음. 구서버 호환 옵션 계약 검증
    #expect(facilities.supplementFailed == nil)
}

@Test func stationMetroFacilitiesSupplementFailedDecodes() throws {
    // 보강 소스(OA-21212) 실패 시 groups는 남고 supplementFailed=true(실패 은폐 금지, 스펙 §2-C)
    let json = #"{"facilities":{"stationName":"봉은사","line":null,"groups":[],"supplementFailed":true}}"#
    let result = try JSONDecoder().decode(SeoulMetroFacilitiesResponse.self, from: Data(json.utf8))
    let facilities = try #require(result.facilities)
    #expect(facilities.groups.isEmpty)
    #expect(facilities.supplementFailed == true)
}

@Test func stationTimetableFixtureDecodes() throws {
    // fixture는 prod 실호출 캡처(강동역 5호선, 2026-07-22)
    let result = try JSONDecoder().decode(StationTimetableResponse.self, from: fixture("station-timetable"))
    let timetable = try #require(result.timetable)
    #expect(timetable.stationName == "강동역 5호선")
    #expect(timetable.dailyType == "weekday")
    // partial 부재: 전 노선·방향 성공이면 필드 자체가 없다(true만 존재하는 계약)
    #expect(timetable.partial == nil)
    #expect(timetable.lines.count == 1)
    let line = timetable.lines[0]
    #expect(line.lineName == "5호선")
    #expect(line.directions.count == 2)
    let up = try #require(line.directions.first { $0.direction == "up" })
    // 첫차는 nextDay 부재(정상 시간대), 막차는 심야 편성이라 nextDay=true(서비스데이 보정 표기)
    #expect(up.first.nextDay == nil)
    #expect(up.first.time == "05:32")
    #expect(up.first.terminus == "방화")
    #expect(up.first.terminusEn == "Banghwa")
    #expect(up.last.nextDay == true)
    #expect(up.last.time == "00:42")
    #expect(up.last.terminusEn == "Wangsimni")
}

@Test func stationTimetablePartialAndMissingTerminusEnDecode() throws {
    // partial:true + terminusEn 결측(seed 미매칭 폴백, 스펙 §7-17) 합성 케이스
    let json = #"""
    {"timetable":{"stationName":"동두천역","dailyType":"weekday","partial":true,
      "lines":[{"lineName":"1호선","directions":[
        {"direction":"up","first":{"time":"05:10","terminus":"동두천"},"last":{"time":"23:40","terminus":"동두천"}}
      ]}]}}
    """#
    let result = try JSONDecoder().decode(StationTimetableResponse.self, from: Data(json.utf8))
    let timetable = try #require(result.timetable)
    #expect(timetable.partial == true)
    let train = timetable.lines[0].directions[0].first
    #expect(train.terminusEn == nil)
    #expect(train.nextDay == nil)
}

@Test func stationTimetableLineCoverageDecodesOptionally() throws {
    // A19: 신서버는 coverage를 싣고 0행 노선도 lines에 남긴다. 구서버(필드 없음)도 디코딩돼야 한다.
    let json = #"""
    {"timetable":{"stationName":"홍대입구","dailyType":"weekday",
      "lines":[{"lineName":"2호선","coverage":"unknown","directions":[]},
               {"lineName":"공항철도","directions":[
        {"direction":"up","first":{"time":"05:10","terminus":"인천공항2터미널"},"last":{"time":"23:40","terminus":"인천공항2터미널"}}]}]}}
    """#
    let tt = try #require(try JSONDecoder().decode(StationTimetableResponse.self, from: Data(json.utf8)).timetable)
    #expect(tt.lines[0].coverage == "unknown")
    #expect(tt.lines[0].directions.isEmpty)
    #expect(tt.lines[1].coverage == nil)
    #expect(tt.lines[1].directions.count == 1)
}

@Test func stationTimetableEmptyLinesAndNullEnvelopeDecode() throws {
    // 전 호출 성공·유효 행 0(§2-A 표): lines 빈 배열, null과 구분되는 상태
    let empty = try JSONDecoder().decode(
        StationTimetableResponse.self,
        from: Data(#"{"timetable":{"stationName":"x","dailyType":"sunday","lines":[]}}"#.utf8))
    #expect(empty.timetable?.lines.isEmpty == true)
    // 미커버 역 graceful null(4종 기존 계약과 동형)
    let uncovered = try JSONDecoder().decode(
        StationTimetableResponse.self, from: Data(#"{"timetable":null}"#.utf8))
    #expect(uncovered.timetable == nil)
}

@Test func stationArrivalFixtureDecodes() throws {
    let result = try JSONDecoder().decode(StationArrivalResponse.self, from: fixture("station-arrival"))
    let arrivals = try #require(result.arrivals)
    #expect(arrivals.stationName == "강동")
    // 도착 낭독 정본은 완성 문장 message(arvlMsg2), 비어 있으면 계약 위반
    #expect(!arrivals.arrivals.isEmpty)
    #expect(arrivals.arrivals.allSatisfy { !$0.message.isEmpty })
}

@Test func airNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(AirNearbyResponse.self, from: fixture("air-nearby"))
    let air = try #require(result.air)
    #expect(air.stationName == "천호대로")
    #expect(air.distanceKm == 0.3)
    #expect(!air.dataTime.isEmpty)
    #expect(air.khai.value == 59)
}

@Test func weatherNearbyFixtureDecodes() throws {
    let result = try JSONDecoder().decode(WeatherNearbyResponse.self, from: fixture("weather-nearby"))
    let weather = try #require(result.weather)
    #expect(weather.sky.label == "cloudy")
    #expect(weather.precipitation.label == "rain")
    #expect(weather.tempC == 24.2)
    #expect(weather.baseTime == "07:00")
    #expect(weather.grid.nx == 63)
}

// MARK: - isStation 3케이스

@Test func isStationJudgesCategoryAndNameSuffix() {
    func place(name: String, category: String) -> Place {
        Place(id: "t", name: name, category: category, address: "", roadAddress: "",
              englishAddress: nil, lat: 37.5, lng: 127.1, phone: nil, link: nil, distanceMeters: nil)
    }
    // 카테고리 "지하철" → 역
    #expect(isStation(place(name: "강동역 5호선", category: "교통,수송 > 지하철,전철 > 수도권5호선")))
    // "Stationery"(문구)를 역으로 오판하지 않음("Station"은 카테고리 판정에서 제외)
    #expect(!isStation(place(name: "문구점 Stationery", category: "가정,생활 > 문구,사무용품 Stationery")))
    // 이름이 "역"으로 끝나면 카테고리 없이도 역
    #expect(isStation(place(name: "서울역", category: "")))
}

// MARK: - 등급·null 심층 검증

@Test func airGradeWordsAreCanonicalAndValueNullable() throws {
    // 등급 단어가 낭독 정본: fixture 실측값은 5종 등급 집합 안에 있어야 한다
    let result = try JSONDecoder().decode(AirNearbyResponse.self, from: fixture("air-nearby"))
    let air = try #require(result.air)
    let validGrades = Set(["good", "moderate", "bad", "veryBad", "unknown"])
    #expect(validGrades.contains(air.khai.grade))
    #expect(validGrades.contains(air.pm10.grade))
    #expect(validGrades.contains(air.pm25.grade))
    // 측정 장애: value null이어도 grade 단어는 남는다(웹 AirPollutant 계약)
    let broken = try JSONDecoder().decode(AirPollutant.self, from: Data(#"{"value":null,"grade":"unknown"}"#.utf8))
    #expect(broken.value == nil)
    #expect(broken.grade == "unknown")
}

@Test func weatherPartialNullsDecode() throws {
    // 부분 성공 계약: tempMin null(fixture 실측), 없는 값은 nil로 남고 나머지는 유효
    let result = try JSONDecoder().decode(WeatherNearbyResponse.self, from: fixture("weather-nearby"))
    let weather = try #require(result.weather)
    #expect(weather.tempMin == nil)
    #expect(weather.tempMax == 31)
    // sky.code도 null 가능(예보 부재 → label "unknown")
    let degraded = try JSONDecoder().decode(
        WeatherNearbyResponse.self,
        from: Data(#"{"weather":{"sky":{"code":null,"label":"unknown"},"precipitation":{"code":0,"label":"none"},"tempC":null,"tempMax":null,"tempMin":null,"humidity":null,"precipProbability":null,"baseTime":"07:00","grid":{"nx":63,"ny":126}}}"#.utf8))
    #expect(degraded.weather?.sky.code == nil)
    #expect(degraded.weather?.tempC == nil)
}

// 미커버 역 graceful null: 4개 라우트 공통 envelope 계약
@Test func stationEnvelopesDecodeNullBodies() throws {
    #expect(try JSONDecoder().decode(StationMetaResponse.self, from: Data(#"{"meta":null}"#.utf8)).meta == nil)
    #expect(try JSONDecoder().decode(StationFacilitiesResponse.self, from: Data(#"{"facilities":null}"#.utf8)).facilities == nil)
    #expect(try JSONDecoder().decode(SeoulMetroFacilitiesResponse.self, from: Data(#"{"facilities":null}"#.utf8)).facilities == nil)
    #expect(try JSONDecoder().decode(StationArrivalResponse.self, from: Data(#"{"arrivals":null}"#.utf8)).arrivals == nil)
}

/// 서버 합성 한국어의 구조화 원재료(A26). 선택 디코딩 — 구버전 응답엔 없다.
@Test func stationMetroFacilityPartsDecodeOptionally() throws {
    let json = #"""
    {"facilities":{"stationName":"강동","groups":[
      {"kind":"elevatorLocation","facilities":[
        {"name":"역 중심 기준 북동쪽 약 120m, 성내동","parts":{"compass":"ne","meters":120,"dong":"성내동"}}]},
      {"kind":"voiceGuide","facilities":[
        {"name":"3번 출구 5호선","parts":{"location":"3번 출구","line":"5"}},
        {"name":"4번 출구"}]},
      {"kind":"restroom","facilities":[
        {"name":"장애인화장실","detail":"남녀구분 · 휠체어 접근 가능","parts":{"restroomType":"남녀구분","wheelchairAccessible":true}}]}
    ]}}
    """#
    let f = try #require(try JSONDecoder().decode(SeoulMetroFacilitiesResponse.self, from: Data(json.utf8)).facilities)
    #expect(f.groups[0].facilities[0].parts?.compass == "ne")
    #expect(f.groups[0].facilities[0].parts?.meters == 120)
    #expect(f.groups[0].facilities[0].parts?.dong == "성내동")
    #expect(f.groups[1].facilities[0].parts?.line == "5")
    #expect(f.groups[1].facilities[1].parts == nil)
    #expect(f.groups[2].facilities[0].parts?.wheelchairAccessible == true)
    #expect(f.groups[2].facilities[0].parts?.restroomType == "남녀구분")
}

/// 서버가 "선"을 덧붙인 노선만 lineCore가 온다(A26). 없으면 lineName 그대로 쓴다.
@Test func stationTimetableLineCoreDecodesOptionally() throws {
    let json = #"""
    {"timetable":{"stationName":"왕십리","dailyType":"weekday","lines":[
      {"lineName":"수인분당선","lineCore":"수인분당","coverage":"unknown","directions":[]},
      {"lineName":"2호선","coverage":"unknown","directions":[]}]}}
    """#
    let tt = try #require(try JSONDecoder().decode(StationTimetableResponse.self, from: Data(json.utf8)).timetable)
    #expect(tt.lines[0].lineCore == "수인분당")
    #expect(tt.lines[1].lineCore == nil)
}

// E27: 영문 additive 필드 디코딩 — ⚠ 선언하지 않으면 서버가 실어도 값이 오지 않는다(additive 계약).
@Test func stationMetaLinesEnDecodesOptionally() throws {
    let json = #"""
    {"meta":{"name":"강남","nameEn":"Gangnam","lines":["2호선","신분당선"],"linesEn":["Line 2","Shinbundang Line"],"isTransfer":true,"operator":"서울교통공사"}}
    """#
    let meta = try #require(try JSONDecoder().decode(StationMetaResponse.self, from: Data(json.utf8)).meta)
    #expect(meta.linesEn == ["Line 2", "Shinbundang Line"])
    let koJson = #"""
    {"meta":{"name":"강남","nameEn":"Gangnam","lines":["2호선"],"isTransfer":false,"operator":"서울교통공사"}}
    """#
    let ko = try #require(try JSONDecoder().decode(StationMetaResponse.self, from: Data(koJson.utf8)).meta)
    #expect(ko.linesEn == nil)
}

@Test func stationTimetableLineNameEnDecodesOptionally() throws {
    let json = #"""
    {"timetable":{"stationName":"서울숲","dailyType":"weekday","lines":[
      {"lineName":"수인분당선","lineCore":"수인분당","lineNameEn":"Suin-Bundang Line","coverage":"unknown","directions":[]},
      {"lineName":"화성선","coverage":"unknown","directions":[]}]}}
    """#
    let tt = try #require(try JSONDecoder().decode(StationTimetableResponse.self, from: Data(json.utf8)).timetable)
    #expect(tt.lines[0].lineNameEn == "Suin-Bundang Line")
    #expect(tt.lines[1].lineNameEn == nil)
}

@Test func stationArrivalEnFieldsDecodeOptionally() throws {
    let json = #"""
    {"arrivals":{"stationName":"강남","arrivals":[
      {"line":"2호선","lineEn":"Line 2","direction":"외선","directionEn":"Outer Circle","trainLineNm":"성수행 - 역삼방면","trainLineNmEn":"To Seongsu via Yeoksam","destination":"성수","message":"강남 도착","messageEn":"Arrived at Gangnam","currentLocation":"강남","currentLocationEn":"Gangnam","arrivalSeconds":0,"express":false},
      {"line":"2호선","direction":"외선","trainLineNm":"성수행 - 역삼방면","destination":"성수","message":"7분 후","arrivalSeconds":420,"express":false}]}}
    """#
    let a = try #require(try JSONDecoder().decode(StationArrivalResponse.self, from: Data(json.utf8)).arrivals)
    #expect(a.arrivals[0].messageEn == "Arrived at Gangnam")
    #expect(a.arrivals[0].lineEn == "Line 2")
    #expect(a.arrivals[0].directionEn == "Outer Circle")
    #expect(a.arrivals[0].trainLineNmEn == "To Seongsu via Yeoksam")
    #expect(a.arrivals[0].currentLocationEn == "Gangnam")
    #expect(a.arrivals[0].message == "강남 도착")
    #expect(a.arrivals[1].messageEn == nil)
}
