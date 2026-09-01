import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `src/lib/__tests__/clinic-kind.test.ts` 미러 — 두 값만 키, 그 밖은 nil.
@Test func clinicKindKeyMapsOnlyTwoValues() {
    #expect(clinicKindKey("의원") == "clinic")
    #expect(clinicKindKey(" 병원 ") == "hospital")
    #expect(clinicKindKey("종합병원") == nil)
    #expect(clinicKindKey("보건소") == nil)
    #expect(clinicKindKey("") == nil)
}

/// 장면 항목의 `roadRoman`(E28 후속)은 additive — 없으면 nil, 있으면 읽는다.
@Test func surroundingsSceneItemRoadRomanDecodesOptionally() throws {
    let json = #"""
    {"data":{"place":null,"frame":"entrance","total":2,"groups":[{"bucket":"left","items":[
      {"name":"봉래면옥","distanceMeters":62,"road":"명일로","roadRoman":"Myeongil-ro","category":"restaurant",
       "id":"k1","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null},
      {"name":"카페만월경","distanceMeters":58,"road":null,"category":"cafe",
       "id":"k2","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null}]}]}}
    """#
    let scene = try #require(try JSONDecoder().decode(SurroundingsSceneResponse.self, from: Data(json.utf8)).data)
    #expect(scene.groups[0].items[0].roadRoman == "Myeongil-ro")
    #expect(scene.groups[0].items[1].road == nil)
    #expect(scene.groups[0].items[1].roadRoman == nil)
}
