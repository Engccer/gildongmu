import Testing
import Foundation
@testable import GildongmuKit

@Test func orderedSectionsSortsByCountDesc() {
    let sections = orderedSections(
        places: [],
        addresses: [JusoAddress(roadAddr: "r", roadAddrPart1: "r1", jibunAddr: "j", engAddr: "e", zipNo: "04524", bdNm: "")],
        web: []
    )
    #expect(sections.count == 1)  // 빈 섹션은 제외
    if case .addresses(let a) = sections[0] { #expect(a.count == 1) } else { Issue.record("주소 섹션이 최상단이어야 함") }
}

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
extension StubNetworkTests {
    @Test func webFallbackOnlyWhenBothEmpty() async throws {
        // StubURLProtocol 재사용: places·address 빈 응답, web은 1건
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places", "/api/places/attractions":
                return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web":
                return (200, Data(#"{"web":[{"title":"t","url":"https://x","snippet":"s","date":null}]}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.sections.count == 1)
        if case .web(let w) = outcome.sections[0] { #expect(w.count == 1) } else { Issue.record("웹 폴백 섹션이어야 함") }
    }

    @Test func attractionsRideSeparateTrack() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places/attractions":
                return (200, Data(#"{"places":[{"id":"a1","name":"경복궁","category":"여행 > 관광,명소","address":"a","roadAddress":"r","lat":37.58,"lng":126.98}],"provider":"kakao-attractions","query":"q"}"#.utf8))
            case "/api/places":
                return (200, Data(#"{"places":[{"id":"p1","name":"경복궁역","category":"교통","address":"a","roadAddress":"r","lat":37.57,"lng":126.97}],"provider":"kakao-local","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.attractions.count == 1)   // 명소는 별도 트랙(최상단 병치는 뷰 책임)
        #expect(outcome.sections.count == 1)      // 웹 폴백 미발동(장소 1건 존재)
    }

    @Test func sectionFailureIsIsolated() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                return (502, Data(#"{"error":"실패"}"#.utf8))
            case "/api/places/attractions":
                return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[{"roadAddr":"세종대로 110","roadAddrPart1":"세종대로 110","jibunAddr":"태평로1가","engAddr":"110 Sejong-daero","zipNo":"04524","bdNm":""}],"query":"q"}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.sections.count == 1)  // 주소는 살아 있음(장소 502에 안 죽음)
    }
}
