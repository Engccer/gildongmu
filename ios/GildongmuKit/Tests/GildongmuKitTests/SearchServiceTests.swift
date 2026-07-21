import Testing
import Foundation
@testable import GildongmuKit

@Test func orderedSectionsSortsByCountDesc() {
    let outcome = SearchOutcome(
        places: .loaded([]),
        addresses: .loaded([JusoAddress(roadAddr: "r", roadAddrPart1: "r1", jibunAddr: "j", engAddr: "e", zipNo: "04524", bdNm: "")]),
        web: .loaded([])
    )
    let sections = outcome.orderedSections
    #expect(sections.count == 1)  // 빈 섹션은 제외
    if case .addresses(let a) = sections[0] { #expect(a.count == 1) } else { Issue.record("주소 섹션이 최상단이어야 함") }
}

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
extension StubNetworkTests {
    @Test func webFallbackOnlyWhenBothEmpty() async throws {
        // StubURLProtocol 재사용: places·address 빈 응답, web은 1건
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web":
                return (200, Data(#"{"web":[{"title":"t","url":"https://x","snippet":"s","date":null}]}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.orderedSections.count == 1)
        if case .web(let w) = outcome.orderedSections[0] { #expect(w.count == 1) } else { Issue.record("웹 폴백 섹션이어야 함") }
    }

    @Test func sectionFailureIsIsolated() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                return (502, Data(#"{"error":"실패"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[{"roadAddr":"세종대로 110","roadAddrPart1":"세종대로 110","jibunAddr":"태평로1가","engAddr":"110 Sejong-daero","zipNo":"04524","bdNm":""}],"query":"q"}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.orderedSections.count == 1)  // 주소는 살아 있음(장소 502에 안 죽음)
        #expect(outcome.allFailed == false)          // 한쪽만 실패면 전체 실패 아님
    }

    @Test func partialFailureIsVisiblePerSection() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places": return (502, Data(#"{"error":"실패"}"#.utf8))
            case "/api/address/search": return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web": return (200, Data(#"{"web":[]}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.places.isFailed)
        #expect(!outcome.addresses.isFailed)
        #expect(outcome.allFailed == false)
    }

    @Test func totalFailureIsSignaledNotSilenced() async throws {
        // 3-state 불변식: 정본 두 트랙(장소·주소) 모두 실패는 "결과 없음"이 아니라 "조회 실패"
        StubURLProtocol.handler = { _ in (502, Data(#"{"error":"실패"}"#.utf8)) }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(outcome.allFailed == true)
        #expect(outcome.orderedSections.isEmpty)
    }

    /// 정확도순 전환(웹 스펙 미러): 보유 좌표는 클라 재정렬이 아니라 /api/places
    /// 요청 쿼리로 전달해 서버 정렬을 신뢰한다.
    @Test func coordinatesArePassedToPlacesQuery() async throws {
        var capturedQuery: String?
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                capturedQuery = request.url!.query()
                return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web":
                return (200, Data(#"{"web":[]}"#.utf8))
            default: return (404, Data())
            }
        }
        _ = await SearchService(client: stubbedClient()).search(query: "q", lat: 37.5547, lng: 126.9707, lang: "ko")
        #expect(capturedQuery?.contains("lat=37.5547") == true)
        #expect(capturedQuery?.contains("lng=126.9707") == true)
    }

    /// 길찾기 필드 후보 검색(includeWeb=false): 두 트랙이 비어도 웹 폴백을 타지 않는다
    /// (스텁이 웹 1건을 줘도 소비 안 됨 = 호출 자체가 없었다는 증거).
    @Test func includeWebFalseSkipsWebFallback() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                return (200, Data(#"{"places":[],"provider":"none","query":"q"}"#.utf8))
            case "/api/address/search":
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web":
                return (200, Data(#"{"web":[{"title":"t","url":"https://x","snippet":"s","date":null}]}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient())
            .search(query: "q", lat: nil, lng: nil, lang: "ko", includeWeb: false)
        #expect(outcome.orderedSections.isEmpty)
        #expect(outcome.web.items.isEmpty)
    }

    @Test func geocodeDecodesMatches() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/geocode":
                return (200, Data(#"{"matches":[{"addressName":"서울 강동구 천호대로 1077","roadAddress":"서울 강동구 천호대로 1077","jibunAddress":null,"postalCode":"05340","lat":37.5385,"lng":127.1237}],"query":"천호대로 1077"}"#.utf8))
            default: return (404, Data())
            }
        }
        let matches = try await SearchService(client: stubbedClient()).geocode(query: "천호대로 1077")
        #expect(matches.count == 1)
        #expect(matches.first?.lat == 37.5385)
    }

    /// 지오코딩 실패는 throw(호출자가 coordError 통지). 조용한 빈 배열로 뭉개지 않는다.
    @Test func geocodeFailureThrows() async throws {
        StubURLProtocol.handler = { _ in (502, Data(#"{"error":"주소 변환에 실패했습니다."}"#.utf8)) }
        await #expect(throws: APIError.self) {
            _ = try await SearchService(client: stubbedClient()).geocode(query: "천호대로 1077")
        }
    }
}
