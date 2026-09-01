import Foundation
import Testing
@testable import GildongmuKit

/// 장면 항목의 `roadRoman`(E28 후속)은 additive — 없으면 nil, 있으면 읽는다.
@Test func surroundingsSceneItemRoadRomanDecodesOptionally() throws {
    let json = #"""
    {"data":{"place":null,"frame":"entrance","total":2,"groups":[{"bucket":"left","items":[
      {"name":"가람식당","distanceMeters":47,"road":"성내로","roadRoman":"Seongnae-ro","category":"restaurant",
       "id":"k1","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null},
      {"name":"카페모퉁이","distanceMeters":58,"road":null,"category":"cafe",
       "id":"k2","lat":37.54,"lng":127.15,"categoryRaw":"","roadAddress":null}]}]}}
    """#
    let scene = try #require(try JSONDecoder().decode(SurroundingsSceneResponse.self, from: Data(json.utf8)).data)
    #expect(scene.groups[0].items[0].roadRoman == "Seongnae-ro")
    #expect(scene.groups[0].items[1].road == nil)
    #expect(scene.groups[0].items[1].roadRoman == nil)
}
