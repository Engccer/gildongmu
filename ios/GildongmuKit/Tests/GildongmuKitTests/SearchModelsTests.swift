import Testing
import Foundation
@testable import GildongmuKit

@Test func placeDecodesMinimalJSON() throws {
    let json = #"{"id":"k1","name":"강남역","category":"교통","address":"a","roadAddress":"r","lat":37.49,"lng":127.02}"#
    let place = try JSONDecoder().decode(Place.self, from: Data(json.utf8))
    #expect(place.name == "강남역")
    #expect(place.englishAddress == nil)
}

func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: "json")!
    return try Data(contentsOf: url)
}

@Test func placesFixtureDecodes() throws {
    let result = try JSONDecoder().decode(PlaceSearchResult.self, from: fixture("places"))
    #expect(!result.places.isEmpty)
    #expect(result.query == "강남역")
}

@Test func addressFixtureDecodes() throws {
    let result = try JSONDecoder().decode(AddressSearchResponse.self, from: fixture("address"))
    #expect(!result.addresses.isEmpty)
    #expect(result.addresses[0].zipNo.count == 5)
}

@Test func webFixtureDecodes() throws {
    let result = try JSONDecoder().decode(WebSearchResponse.self, from: fixture("web"))
    #expect(result.web.allSatisfy { !$0.url.isEmpty })
}

@Test func attractionsFixtureDecodes() throws {
    let result = try JSONDecoder().decode(PlaceSearchResult.self, from: fixture("attractions"))
    #expect(result.places.allSatisfy { $0.lat > 33 && $0.lat < 39 })
}
