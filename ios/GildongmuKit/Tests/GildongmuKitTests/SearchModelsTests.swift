import Testing
import Foundation
@testable import GildongmuKit

@Test func placeDecodesMinimalJSON() throws {
    let json = #"{"id":"k1","name":"강남역","category":"교통","address":"a","roadAddress":"r","lat":37.49,"lng":127.02}"#
    let place = try JSONDecoder().decode(Place.self, from: Data(json.utf8))
    #expect(place.name == "강남역")
    #expect(place.englishAddress == nil)
}
