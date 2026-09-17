import Foundation

// 역 장소 상세 개편(E44) — spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md §3.1·§5.
// 순수 판정 + 얇은 조회 서비스. ⚠ 안드로이드 :kit 이식 규칙상 정규식 약칭 클래스를 쓰지 않는다(문자 필터).

/// 역 상세 레이아웃 종류(spec §3.1). `isStation`보다 좁다 — 출구 POI·시공업체·이름만 `역`으로 끝나는 장소는 nil이고
/// nil 장소의 상세는 개편 전 레이아웃 그대로다.
public enum StationLayoutKind: Sendable, Equatable {
    case subway
    case rail
}

public func stationLayoutKind(_ place: Place) -> StationLayoutKind? {
    if place.id.hasPrefix("transit-stop:") { return .subway }
    let segments = place.category.split(separator: ">").map { $0.trimmingCharacters(in: .whitespaces) }
    if segments.contains("지하철,전철"), let last = segments.last, last != "지하철출구", last != "지하철,전철" {
        return .subway
    }
    if segments.contains("기차역") { return .rail }
    return nil
}

/// 역 이름 비교 키(spec §5.4-1): 괄호 부기·공백·`.`·`·` 제거 뒤 끝 `역` 한 글자를 뗀다.
public func stationNameKey(_ raw: String) -> String {
    var out = ""
    var depth = 0
    for ch in raw {
        if ch == "(" { depth += 1; continue }
        if ch == ")" { depth = max(0, depth - 1); continue }
        if depth > 0 || ch == " " || ch == "." || ch == "·" { continue }
        out.append(ch)
    }
    if out.count > 1, out.hasSuffix("역") { out.removeLast() }
    return out
}

/// 카카오 검색어 — 괄호 부기를 뺀 역 이름에 `역`을 한 번만 붙인다(표기 구두점은 남긴다).
public func stationPhoneQuery(_ raw: String) -> String {
    var out = ""
    var depth = 0
    for ch in raw {
        if ch == "(" { depth += 1; continue }
        if ch == ")" { depth = max(0, depth - 1); continue }
        if depth == 0 { out.append(ch) }
    }
    let trimmed = out.trimmingCharacters(in: .whitespaces)
    return trimmed.hasSuffix("역") ? trimmed : trimmed + "역"
}

/// 노선 정체성(spec §5.4-2) — 웹 `subwayLineKey`와 같은 정규화(공백·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거) 뒤
/// 노선명 표의 영문 값. 미지 표기는 nil.
public func subwayLineIdentity(_ raw: String) -> String? {
    var s = String(raw.filter { $0 != " " && $0 != "." })
    if s.hasPrefix("수도권") { s.removeFirst(3) }
    if s.hasSuffix("(급행)") { s.removeLast(4) }
    return subwayLineIdentityTable[s]
}

/// 웹 `src/lib/subway-line-names.ts` `LINE_EN` 미러 — 항목 동일은 `station-phone-line-table-drift.test.ts`가 강제한다.
/// ⚠ 줄 모양 `"키": "값",` 한 줄 하나를 지킨다(드리프트 테스트가 그 모양으로 읽는다).
let subwayLineIdentityTable: [String: String] = [
    "1호선": "Line 1",
    "2호선": "Line 2",
    "3호선": "Line 3",
    "4호선": "Line 4",
    "5호선": "Line 5",
    "6호선": "Line 6",
    "7호선": "Line 7",
    "8호선": "Line 8",
    "9호선": "Line 9",
    "도시철도7호선": "Line 7",
    "광역철도8호선": "Line 8",
    "도시철도9호선": "Line 9",
    "서울도시철도9호선": "Line 9",
    "경의중앙선": "Gyeongui-Jungang Line",
    "경의중앙": "Gyeongui-Jungang Line",
    "중앙선": "Jungang Line",
    "경춘선": "Gyeongchun Line",
    "경춘": "Gyeongchun Line",
    "수인분당선": "Suin-Bundang Line",
    "수인분당": "Suin-Bundang Line",
    "분당선": "Bundang Line",
    "수인선": "Suin Line",
    "신분당선": "Shinbundang Line",
    "신분당": "Shinbundang Line",
    "경강선": "Gyeonggang Line",
    "경강": "Gyeonggang Line",
    "서해선": "Seohae Line",
    "서해": "Seohae Line",
    "우이신설선": "Ui-Sinseol Line",
    "우이신설": "Ui-Sinseol Line",
    "신림선": "Sillim Line",
    "신림": "Sillim Line",
    "경량도시철도신림선": "Sillim Line",
    "공항철도": "AREX",
    "공항": "AREX",
    "공항선": "AREX",
    "인천국제공항선": "AREX",
    "GTX-A": "GTX-A",
    "GTX-A선": "GTX-A",
    "김포도시철도": "Gimpo Goldline",
    "김포골드라인": "Gimpo Goldline",
    "의정부": "Uijeongbu LRT",
    "의정부경전철": "Uijeongbu LRT",
    "에버라인": "EverLine",
    "용인에버라인": "EverLine",
    "진접선": "Jinjeop Line",
    "경부선": "Gyeongbu Line",
    "경원선": "Gyeongwon Line",
    "경인선": "Gyeongin Line",
    "안산과천선": "Ansan-Gwacheon Line",
    "일산선": "Ilsan Line",
    "장항선": "Janghang Line",
    "인천지하철1호선": "Incheon Line 1",
    "인천지하철2호선": "Incheon Line 2",
    "인천1호선": "Incheon Line 1",
    "인천2호선": "Incheon Line 2",
    "자기부상철도": "Incheon Airport Maglev",
    "부산도시철도1호선": "Busan Line 1",
    "부산도시철도2호선": "Busan Line 2",
    "부산도시철도3호선": "Busan Line 3",
    "부산경량도시철도4호선": "Busan Line 4",
    "부산1호선": "Busan Line 1",
    "부산2호선": "Busan Line 2",
    "부산3호선": "Busan Line 3",
    "부산4호선": "Busan Line 4",
    "부산김해경전철": "Busan-Gimhae LRT",
    "동해선": "Donghae Line",
    "동해": "Donghae Line",
    "대구도시철도1호선": "Daegu Line 1",
    "대구도시철도2호선": "Daegu Line 2",
    "대구도시철도3호선": "Daegu Line 3",
    "대구1호선": "Daegu Line 1",
    "대구2호선": "Daegu Line 2",
    "대구3호선": "Daegu Line 3",
    "대경선": "Daegyeong Line",
    "대전도시철도1호선": "Daejeon Line 1",
    "대전1호선": "Daejeon Line 1",
    "광주도시철도1호선": "Gwangju Line 1",
    "광주1호선": "Gwangju Line 1",
]

/// 전국 대표번호(15xx·16xx·18xx 8자리) 판별(판정 ⑥).
public func isRepresentativePhone(_ phone: String) -> Bool {
    let digits = phone.filter { $0 >= "0" && $0 <= "9" }
    guard digits.count == 8 else { return false }
    return ["15", "16", "18"].contains(String(digits.prefix(2)))
}

/// 조회 결과 3상태(spec §5.5) — 번호는 직통/대표번호로 갈린다. `.failed`는 서비스만 낸다.
public enum StationPhoneResult: Sendable, Equatable {
    case direct(String)
    case representative(String)
    case unavailable
    case failed
}

/// 동명이역 차단 상한(spec §5.4-3).
public let stationPhoneMaxMeters: Double = 1_000

/// 후보 선택(spec §5.4): 역 키·노선 키 일치 ∧ 1,000m 이내인 지하철역 POI 중 번호 있는 것의 최근접.
/// 다른 노선 번호로 떨어지지 않는다(리뷰 M1).
public func pickStationPhone(
    places: [Place], stationName: String, lat: Double, lng: Double, lineName: String
) -> StationPhoneResult {
    let key = stationNameKey(stationName)
    guard !key.isEmpty, let line = subwayLineIdentity(lineName) else { return .unavailable }
    var best: (phone: String, meters: Double)?
    for place in places {
        guard !place.id.hasPrefix("transit-stop:"), stationLayoutKind(place) == .subway,
              let space = place.name.lastIndex(of: " ") else { continue }
        let head = String(place.name[..<space])
        let tail = String(place.name[place.name.index(after: space)...])
        guard stationNameKey(head) == key, subwayLineIdentity(tail) == line else { continue }
        let meters = haversineMeters(lat1: lat, lng1: lng, lat2: place.lat, lng2: place.lng)
        guard meters <= stationPhoneMaxMeters,
              let phone = place.phone?.trimmingCharacters(in: .whitespaces), !phone.isEmpty else { continue }
        if best == nil || meters < best!.meters { best = (phone, meters) }
    }
    guard let best else { return .unavailable }
    return isRepresentativePhone(best.phone) ? .representative(best.phone) : .direct(best.phone)
}

/// 경유역 전화번호 조회(spec §5.3): `/api/places` 장소 트랙만(주소·유료 웹검색 호출 없음), 3초 상한, 언어는 항상 ko.
public struct StationPhoneService: Sendable {
    let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func lookup(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult {
        let query = [
            URLQueryItem(name: "query", value: stationPhoneQuery(stationName)),
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "lang", value: "ko"),
        ]
        do {
            let result: PlaceSearchResult = try await client.get("/api/places", query: query, timeout: 3)
            return pickStationPhone(
                places: result.places, stationName: stationName, lat: lat, lng: lng, lineName: lineName)
        } catch {
            return .failed
        }
    }
}
