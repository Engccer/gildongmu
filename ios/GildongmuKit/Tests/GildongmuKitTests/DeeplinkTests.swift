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
