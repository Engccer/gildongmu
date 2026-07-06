import SwiftUI
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
struct PlaceDetailView: View {
    let place: Place
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            Section {
                // 한 줄=한 객체: 라벨 볼드 분절 대신 단일 텍스트(웹 정본 규칙)
                if !place.category.isEmpty { Text(place.category) }
                if !place.roadAddress.isEmpty { Text("도로명 주소, \(place.roadAddress)") }
                if !place.address.isEmpty { Text("지번 주소, \(place.address)") }
                if let english = place.englishAddress, !english.isEmpty {
                    Text("영문 주소, \(english)")
                }
                if let phone = place.phone, !phone.isEmpty,
                   let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                    // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                    Link("전화 걸기, \(phone)", destination: telURL)
                }
            }

            Section("길찾기") {
                Button("네이버 지도 길찾기") { openNaverRoute() }
                Button("카카오맵 길찾기") { openKakaoRoute() }
                if let kakaoId = kakaoPlaceId {
                    Button("카카오맵 장소 정보") { openKakaoPlace(kakaoId) }
                }
            }
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.large)
    }

    /// Place.id "kakao-" 접두가 있을 때만 카카오 장소 상세 체인 유효(웹 계약)
    private var kakaoPlaceId: String? {
        place.id.hasPrefix("kakao-") ? String(place.id.dropFirst("kakao-".count)) : nil
    }

    private var destination: RouteDestination {
        RouteDestination(lat: place.lat, lng: place.lng, name: place.name)
    }

    /// 도보 기본(1급 사용자 주 시나리오). 모드 선택 UI는 M4 경로 브리핑에서.
    private func openNaverRoute() {
        guard let url = buildNaverRouteDeeplink(mode: .walk, dest: destination, appname: AppConfig.appIdentifier) else { return }
        openWithFallback(url)
    }

    private func openKakaoRoute() {
        guard let url = buildKakaoRouteDeeplink(mode: .walk, dest: destination) else { return }
        openWithFallback(url)
    }

    private func openKakaoPlace(_ id: String) {
        guard let url = buildKakaoPlaceDeeplink(kakaoPlaceId: id) else { return }
        openWithFallback(url)
    }

    /// 앱 미설치(스킴 미처리) 시 카카오 웹 지도로 폴백. canOpenURL 화이트리스트 불필요.
    private func openWithFallback(_ url: URL) {
        openURL(url) { accepted in
            if !accepted, let fallback = buildKakaoWebRouteUrl(mode: .walk, dest: destination) {
                openURL(fallback)
            }
        }
    }
}
