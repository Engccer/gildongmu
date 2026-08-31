import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `kakao-category.test.ts`와 같은 fixture — `pickCategory` 규칙이 한 벌임을 강제(A28).
private struct PickCase: Decodable {
    let id: String
    let locale: String
    let category: String
    let categoryEn: String?
    let expected: String
}

private struct PickCaseFile: Decodable {
    let cases: [PickCase]
}

private func loadPickCases() throws -> [PickCase] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }  // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/kakao-category-pick-cases.json")
    return try JSONDecoder().decode(PickCaseFile.self, from: Data(contentsOf: url)).cases
}

@Suite("KakaoCategory — 공유 fixture·디코딩·투영")
struct KakaoCategoryTests {
    @Test func matchesSharedFixture() throws {
        let cases = try loadPickCases()
        #expect(cases.count >= 6)
        for c in cases {
            #expect(pickCategory(lang: c.locale, category: c.category, categoryEn: c.categoryEn) == c.expected, Comment(rawValue: c.id))
        }
    }

    /// 구버전 서버 응답(필드 부재)과 신버전(필드 있음) 둘 다 디코딩된다 — 4모델 전부.
    @Test func modelsDecodeWithAndWithoutCategoryEn() throws {
        let dec = JSONDecoder()
        let placeNew = #"{"id":"kakao-1","name":"신명중학교","category":"교육,학문 > 학교 > 중학교","categoryEn":"Education & Academia > School > Middle School","address":"","roadAddress":"","englishAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null,"distanceMeters":null}"#
        let placeOld = #"{"id":"kakao-1","name":"신명중학교","category":"교육,학문 > 학교 > 중학교","address":"","roadAddress":"","englishAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null,"distanceMeters":null}"#
        #expect(try dec.decode(Place.self, from: Data(placeNew.utf8)).categoryEn == "Education & Academia > School > Middle School")
        #expect(try dec.decode(Place.self, from: Data(placeOld.utf8)).categoryEn == nil)

        let kidsNew = #"{"id":"kakao-2","name":"키즈카페","category":"가정,생활 > 유아 > 놀이시설 > 키즈카페","categoryEn":"Home & Living > Kids > Play Facility > Kids Cafe","kind":"kidscafe","indoorOutdoor":"indoor","distanceMeters":120,"address":"지번","roadAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null}"#
        let kidsOld = #"{"id":"kakao-2","name":"키즈카페","category":"가정,생활 > 유아 > 놀이시설 > 키즈카페","kind":"kidscafe","indoorOutdoor":"indoor","distanceMeters":120,"address":"지번","roadAddress":null,"lat":37.5,"lng":127.1,"phone":null,"link":null}"#
        #expect(try dec.decode(KidsPlace.self, from: Data(kidsNew.utf8)).categoryEn?.hasPrefix("Home & Living") == true)
        #expect(try dec.decode(KidsPlace.self, from: Data(kidsOld.utf8)).categoryEn == nil)

        let aroundNew = #"{"id":"kakao-3","name":"강동역 3번출구","category":"subway","categoryRaw":"교통,수송 > 지하철,전철 > 수도권5호선","categoryEn":"Transportation > Subway > Line 5","distanceMeters":30,"bearing":"n","lat":37.5,"lng":127.1,"phone":null,"link":null}"#
        let aroundOld = #"{"id":"kakao-3","name":"강동역 3번출구","category":"subway","categoryRaw":"교통,수송 > 지하철,전철 > 수도권5호선","distanceMeters":30,"bearing":"n","lat":37.5,"lng":127.1,"phone":null,"link":null}"#
        #expect(try dec.decode(SurroundingPlace.self, from: Data(aroundNew.utf8)).categoryEn == "Transportation > Subway > Line 5")
        #expect(try dec.decode(SurroundingPlace.self, from: Data(aroundOld.utf8)).categoryEn == nil)

        let sceneNew = #"{"name":"CU","nameRoman":null,"distanceMeters":40,"road":null,"category":"convenience","id":"kakao-4","lat":37.5,"lng":127.1,"categoryRaw":"가정,생활 > 편의점 > CU","categoryEn":"Home & Living > Convenience Store > CU","roadAddress":null,"phone":null,"link":null}"#
        let sceneOld = #"{"name":"CU","nameRoman":null,"distanceMeters":40,"road":null,"category":"convenience","id":"kakao-4","lat":37.5,"lng":127.1,"categoryRaw":"가정,생활 > 편의점 > CU","roadAddress":null,"phone":null,"link":null}"#
        #expect(try dec.decode(SurroundingsSceneItem.self, from: Data(sceneNew.utf8)).categoryEn == "Home & Living > Convenience Store > CU")
        #expect(try dec.decode(SurroundingsSceneItem.self, from: Data(sceneOld.utf8)).categoryEn == nil)
    }

    /// 투영 3종이 `categoryEn`을 그대로 나르고 `category`(판정 축)는 종전 그대로다.
    @Test func projectionsCarryCategoryEnAndKeepRawCategory() {
        let kids = KidsPlace(
            id: "kakao-1", name: "키즈카페", category: "가정,생활 > 유아 > 놀이시설 > 키즈카페",
            categoryEn: "Home & Living > Kids > Play Facility > Kids Cafe", kind: "kidscafe", indoorOutdoor: "indoor",
            distanceMeters: 150, address: "", roadAddress: nil, lat: 37.5, lng: 127.1, phone: nil, link: nil)
        let kp = kidsPlaceToPlace(kids)
        #expect(kp.category == "가정,생활 > 유아 > 놀이시설 > 키즈카페")
        #expect(kp.categoryEn == "Home & Living > Kids > Play Facility > Kids Cafe")

        let around = SurroundingPlace(
            id: "kakao-3", name: "강동역 3번출구", category: "subway", categoryRaw: "교통,수송 > 지하철,전철 > 수도권5호선",
            categoryEn: "Transportation > Subway > Line 5", distanceMeters: 30, bearing: "n", lat: 37.5, lng: 127.1,
            phone: nil, link: nil)
        let ap = surroundingPlaceToPlace(around)
        #expect(ap.category == "교통,수송 > 지하철,전철 > 수도권5호선")
        #expect(ap.categoryEn == "Transportation > Subway > Line 5")
        // 역 판정은 원문 축 — 영문이 실려도 결과 불변.
        #expect(isStation(ap))

        let item = SurroundingsSceneItem(
            name: "CU", distanceMeters: 40, road: nil, category: "convenience", id: "kakao-4", lat: 37.5, lng: 127.1,
            categoryRaw: "가정,생활 > 편의점 > CU", categoryEn: "Home & Living > Convenience Store > CU",
            roadAddress: nil, phone: nil, link: nil)
        let sp = sceneItemToPlace(item)
        #expect(sp.category == "가정,생활 > 편의점 > CU")
        #expect(sp.categoryEn == "Home & Living > Convenience Store > CU")
        #expect(!isStation(sp))
    }
}
