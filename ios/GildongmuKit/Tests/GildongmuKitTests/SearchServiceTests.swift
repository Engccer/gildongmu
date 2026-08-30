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

    @Test func reviewSortSendsSortParamOnlyToPlacesAndKeepsProvider() async throws {
        // spec 2026-08-17 §6: sort=.review는 /api/places에만 sort=review, 주소·웹엔 없음.
        // provider는 그대로 outcome에 실려 토글 노출 판정(네이버 키 관측)에 쓰인다.
        nonisolated(unsafe) var placesQuery = ""
        nonisolated(unsafe) var addressQuery = ""
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/places":
                placesQuery = request.url!.query() ?? ""
                return (200, Data(#"{"places":[],"provider":"naver-local","query":"q"}"#.utf8))
            case "/api/address/search":
                addressQuery = request.url!.query() ?? ""
                return (200, Data(#"{"addresses":[],"query":"q"}"#.utf8))
            case "/api/search/web":
                return (200, Data(#"{"web":[]}"#.utf8))
            default: return (404, Data())
            }
        }
        let outcome = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko", sort: .review)
        #expect(placesQuery.contains("sort=review"))
        #expect(!addressQuery.contains("sort="))
        #expect(outcome.placesProvider == "naver-local")

        let plain = await SearchService(client: stubbedClient()).search(query: "q", lat: nil, lng: nil, lang: "ko")
        #expect(!placesQuery.contains("sort="))
        #expect(plain.placesProvider == "naver-local")
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

    @Test func reverseGeocodeDecodesAddress() async throws {
        StubURLProtocol.handler = { request in
            switch request.url!.path() {
            case "/api/geocode/reverse":
                return (200, Data(#"{"address":"서울 강동구 천호대로 1077"}"#.utf8))
            default: return (404, Data())
            }
        }
        let response = try await SearchService(client: stubbedClient()).reverseGeocode(lat: 37.5385, lng: 127.1237, lang: "ko")
        #expect(response.address == "서울 강동구 천호대로 1077")
        #expect(response.english == nil)
    }

    /// en 요청은 lang을 싣고 공식 영문(addressEn) → 로마자(addressRoman) 순으로 `english`를 낸다(E28).
    @Test func reverseGeocodeEnCarriesEnglish() async throws {
        nonisolated(unsafe) var seenQuery = ""
        StubURLProtocol.handler = { request in
            seenQuery = request.url!.query() ?? ""
            return (200, Data(#"{"address":"서울 강동구 천호대로 1077","addressEn":"1077 Cheonho-daero, Gangdong-gu, Seoul"}"#.utf8))
        }
        let response = try await SearchService(client: stubbedClient()).reverseGeocode(lat: 37.5385, lng: 127.1237, lang: "en")
        #expect(seenQuery.contains("lang=en"))
        #expect(response.english == "1077 Cheonho-daero, Gangdong-gu, Seoul")
        StubURLProtocol.handler = { _ in (200, Data(#"{"address":"서울 강동구 길동 123","addressRoman":"Seoul Gangdong-gu Gil-dong 123"}"#.utf8)) }
        let roman = try await SearchService(client: stubbedClient()).reverseGeocode(lat: 37.5385, lng: 127.1237, lang: "en")
        #expect(roman.english == "Seoul Gangdong-gu Gil-dong 123")
    }

    /// 매칭 없음(null)은 성공의 nil — 실패(throw)와 뭉개지 않는다(3-state).
    @Test func reverseGeocodeNoMatchIsNil() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"address":null}"#.utf8)) }
        let response = try await SearchService(client: stubbedClient()).reverseGeocode(lat: 37.5385, lng: 127.1237, lang: "ko")
        #expect(response.address == nil)
    }
}

extension StubNetworkTests {
    /// A11 출입구 승격 조회. **판정은 서버가 소유**하므로 Kit이 검증할 것은 셋뿐이다:
    /// 요청 파라미터가 맞게 나가는가, 응답이 디코딩되는가, 그리고 **부재·실패가 같은
    /// nil로 수렴하는가**(둘 다 "대표 좌표로 안내"라는 같은 행동이라 호출자가 가를
    /// 이유가 없다).
    @Test func destinationEntranceDecodesMatch() async throws {
        var seen: URL?
        StubURLProtocol.handler = { request in
            seen = request.url
            return (200, Data(#"{"entrance":{"name":"신명중학교 정문","lat":37.5416844,"lng":127.1489539,"meters":56}}"#.utf8))
        }
        let match = await SearchService(client: stubbedClient()).destinationEntrance(
            name: "신명중학교", lat: 37.5414909, lng: 127.1495375, fromLat: 37.5352, fromLng: 127.1441
        )
        #expect(match?.name == "신명중학교 정문")
        #expect(match?.meters == 56)
        let query = seen?.query ?? ""
        #expect(query.contains("fromLat=37.5352"))
        #expect(query.contains("fromLng=127.1441"))
    }

    @Test func destinationEntranceOmitsOriginWhenUnknown() async throws {
        var seen: URL?
        StubURLProtocol.handler = { request in
            seen = request.url
            return (200, Data(#"{"entrance":null}"#.utf8))
        }
        let match = await SearchService(client: stubbedClient()).destinationEntrance(
            name: "천호역", lat: 37.5385, lng: 127.1239, fromLat: nil, fromLng: nil
        )
        #expect(match == nil)  // 출입구 없음
        let query = seen?.query ?? ""
        #expect(query.contains("fromLat") == false)
    }

    @Test func destinationEntranceFailureIsNil() async throws {
        StubURLProtocol.handler = { _ in (502, Data(#"{"error":"실패"}"#.utf8)) }
        let match = await SearchService(client: stubbedClient()).destinationEntrance(
            name: "신명중학교", lat: 37.5414909, lng: 127.1495375, fromLat: nil, fromLng: nil
        )
        #expect(match == nil)  // 실패도 부재와 같은 행동(원래 목적지로 조회)
    }
}
