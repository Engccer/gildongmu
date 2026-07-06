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

// MARK: - isStation 3케이스 + 정규화

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

    // 정규화: 접미사 제거·trim·소문자(매칭 키)
    #expect(normalizeStationName("강동역") == "강동")
    #expect(normalizeStationName("Seoul Station") == "seoul")
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
