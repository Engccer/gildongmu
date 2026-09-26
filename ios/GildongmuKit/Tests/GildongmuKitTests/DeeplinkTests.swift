import Testing
import Foundation
@testable import GildongmuKit

private let gangnam = RouteDestination(lat: 37.4979, lng: 127.0276, name: "강남역")

@Test func naverRouteDeeplinkMirrorsWebFormat() {
    let url = buildNaverRouteDeeplink(mode: .walk, dest: gangnam, appname: "space.dodoplanet.gildongmu")
    let s = url!.absoluteString
    #expect(s.hasPrefix("nmap://route/walk?"))
    #expect(s.contains("dlat=37.4979") && s.contains("dlng=127.0276"))
    #expect(s.contains("appname=space.dodoplanet.gildongmu"))
    // 출발지 생략 = 현재 위치 출발(웹 계약)
    #expect(!s.contains("slat="))
}

@Test func kakaoRouteDeeplinkUsesOfficialByParams() {
    let url = buildKakaoRouteDeeplink(mode: .publicTransit, dest: gangnam)
    let s = url!.absoluteString
    #expect(s.hasPrefix("kakaomap://route?"))
    #expect(s.contains("ep=37.4979,127.0276"))
    #expect(s.contains("by=publictransit"))
}

@Test func outsideKoreaReturnsNil() {
    let paris = RouteDestination(lat: 48.85, lng: 2.35, name: "Paris")
    #expect(buildNaverRouteDeeplink(mode: .car, dest: paris, appname: "a") == nil)
    #expect(buildKakaoRouteDeeplink(mode: .car, dest: paris) == nil)
    #expect(isInKorea(lat: 37.5, lng: 127.0) == true)
}

@Test func kakaoPlaceDeeplinkAndWebFallback() {
    #expect(buildKakaoPlaceDeeplink(kakaoPlaceId: "26338954")!.absoluteString == "kakaomap://place?id=26338954")
    let web = buildKakaoWebRouteUrl(mode: .walk, dest: gangnam)!.absoluteString
    #expect(web.hasPrefix("https://map.kakao.com/link/by/walk/"))
    #expect(web.contains("37.4979"))
}

/// 쿼리 값의 `=`·`&`·`+` 인코딩은 Foundation `URLComponents.queryItems`가 정한다(E43 iOS 확인 후보 ①) — 안드로이드
/// `:kit` `Deeplink.kt`의 `URL_QUERY_ITEM_ALLOWED`(`.urlQueryAllowed`에서 `&`·`=`을 뺀 집합)가 이 결과를 미러한다.
/// `=`·`&`는 값 안에서 인코딩되고 `+`·`;`·`?`·`/`는 그대로다(웹 `URLSearchParams`는 `+`를 `%2B`로 — 지도 앱은 둘 다 읽는다).
@Test func deeplinkQueryEncodingFollowsURLComponents() {
    let dest = RouteDestination(lat: 37.4979, lng: 127.0276, name: "a=b+c&d e;f?g/h")
    let s = buildNaverRouteDeeplink(mode: .walk, dest: dest, appname: "a")!.absoluteString
    #expect(s.contains("dname=a%3Db+c%26d%20e;f?g/h&appname=a"), "\(s)")
    let place = buildKakaoPlaceDeeplink(kakaoPlaceId: "1=2+3")!.absoluteString
    #expect(place == "kakaomap://place?id=1%3D2+3")
}
