import Foundation

/// 네이버·카카오 지도 앱 딥링크 빌더. 웹 `src/lib/deeplink.ts`·`deeplink-kakao.ts` 미러.
/// 실주행 내비는 네이티브 지도 앱에 위임한다(spec §4). 권역 밖 목적지는 nil.
/// 좌표 유효 범위 판정은 `Coverage.swift`의 `isInKorea` 사용.

/// 길찾기 이동 수단. rawValue는 nmap route 경로 세그먼트와 일치(publicTransit만 "public").
public enum RouteMode: String, CaseIterable, Sendable {
    case walk, publicTransit = "public", car, bike

    /// kakaomap://route 의 by 파라미터(공식: car, publictransit, foot, bicycle)
    var kakaoBy: String {
        switch self {
        case .walk: "foot"
        case .publicTransit: "publictransit"
        case .car: "car"
        case .bike: "bicycle"
        }
    }

    /// map.kakao.com/link/by/{수단} 경로 세그먼트
    var kakaoWebBy: String {
        switch self {
        case .walk: "walk"
        case .publicTransit: "traffic"
        case .car: "car"
        case .bike: "bicycle"
        }
    }
}

public struct RouteDestination: Sendable {
    public let lat: Double
    public let lng: Double
    public let name: String
    public init(lat: Double, lng: Double, name: String) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

/// 네이버 지도 길찾기 딥링크. 출발지 생략 = 앱이 현재 위치 출발(웹 계약 동일).
/// appname은 nmap 스킴 필수 파라미터.
public func buildNaverRouteDeeplink(mode: RouteMode, dest: RouteDestination, appname: String) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    var components = URLComponents()
    components.scheme = "nmap"
    components.host = "route"
    components.path = "/\(mode.rawValue)"
    components.queryItems = [
        URLQueryItem(name: "dlat", value: String(dest.lat)),
        URLQueryItem(name: "dlng", value: String(dest.lng)),
        URLQueryItem(name: "dname", value: dest.name),
        URLQueryItem(name: "appname", value: appname),
    ]
    return components.url
}

/// 카카오맵 길찾기 딥링크. 출발지(sp) 생략 = 현재 위치 출발.
public func buildKakaoRouteDeeplink(mode: RouteMode, dest: RouteDestination) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    var components = URLComponents()
    components.scheme = "kakaomap"
    components.host = "route"
    components.queryItems = [
        URLQueryItem(name: "ep", value: "\(dest.lat),\(dest.lng)"),
        URLQueryItem(name: "by", value: mode.kakaoBy),
    ]
    return components.url
}

/// 카카오맵 장소 상세 딥링크. 호출 측이 Place.id의 "kakao-" 접두를 제거해 전달한다.
public func buildKakaoPlaceDeeplink(kakaoPlaceId: String) -> URL? {
    var components = URLComponents()
    components.scheme = "kakaomap"
    components.host = "place"
    components.queryItems = [URLQueryItem(name: "id", value: kakaoPlaceId)]
    return components.url
}

/// 길찾기 웹 URL: 카카오맵 미설치 폴백(웹 계약: /link/by/{수단}/{이름},{위도},{경도}).
public func buildKakaoWebRouteUrl(mode: RouteMode, dest: RouteDestination) -> URL? {
    guard isInKorea(lat: dest.lat, lng: dest.lng) else { return nil }
    let name = dest.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? dest.name
    return URL(string: "https://map.kakao.com/link/by/\(mode.kakaoWebBy)/\(name),\(dest.lat),\(dest.lng)")
}
