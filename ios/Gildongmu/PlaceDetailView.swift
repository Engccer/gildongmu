import SwiftUI
import UIKit
import Accessibility
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
struct PlaceDetailView: View {
    let place: Place
    @Environment(\.openURL) private var openURL
    /// 역 자동 섹션 4종 모델. 로드는 아래 .task에서 킥오프(역일 때만)
    @State private var stationSections = StationSectionsModel()
    /// 무장애 편의시설 자동 섹션 모델. 역 여부와 무관하게 모든 장소에서 로드
    @State private var barrierFreeInfo = BarrierFreeInfoModel()
    /// 장소 채팅 sheet(M5). 표시마다 새 ChatView = 장소마다 새 대화(웹 계약)
    @State private var isChatPresented = false

    var body: some View {
        List {
            Section {
                // 한 줄=한 객체: 라벨 볼드 분절 대신 단일 텍스트(웹 정본 규칙)
                if !place.category.isEmpty { Text(place.category) }
                if !place.roadAddress.isEmpty { Text(String(format: String(localized: "ios.place.roadAddressLine"), place.roadAddress)) }
                if !place.address.isEmpty { Text(String(format: String(localized: "ios.place.jibunAddressLine"), place.address)) }
                if let english = place.englishAddress, !english.isEmpty {
                    Text(String(format: String(localized: "ios.place.englishAddressLine"), english))
                }
                // 별도 접근성 객체(인터랙티브는 텍스트와 합치지 않음, 웹 정본 규칙)
                Button(String(localized: "ios.place.copyAddress")) {
                    UIPasteboard.general.string = copyableAddress
                    AccessibilityNotification.Announcement(String(localized: "place.addressCopied")).post()
                }
                if let phone = place.phone, !phone.isEmpty,
                   let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                    // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                    Link(String(format: String(localized: "ios.place.callLine"), phone), destination: telURL)
                }
                Button(String(localized: "placeChat.launch")) { isChatPresented = true }
            }

            Section(String(localized: "ios.route.section")) {
                Button(String(localized: "ios.route.naver")) { openNaverRoute() }
                Button(String(localized: "ios.route.kakao")) { openKakaoRoute() }
                if let kakaoId = kakaoPlaceId {
                    Button(String(localized: "ios.route.kakaoPlace")) { openKakaoPlace(kakaoId) }
                }
                // 출발 전 미리 듣기 텍스트 브리핑(M4). 실주행은 위 딥링크 위임 유지
                NavigationLink(String(localized: "ios.route.carBriefing")) { CarBriefingView(place: place) }
                NavigationLink(String(localized: "ios.route.transitBriefing")) { TransitBriefingView(place: place) }
            }

            // 역이면 역 정보·실시간 도착·교통약자 시설이 자동 등장(조용히 나타남, M3)
            if isStation(place) {
                StationSectionsView(model: stationSections)
            }

            // 무장애 편의시설도 자동 등장(조용히 나타남, 역 여부 무관)
            BarrierFreeInfoSection(model: barrierFreeInfo)
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.large)
        .task {
            if isStation(place) {
                await stationSections.load(stationName: place.name)
            }
        }
        .task {
            await barrierFreeInfo.load(lat: place.lat, lng: place.lng, name: place.name)
        }
        .sheet(isPresented: $isChatPresented) {
            ChatView(place: place)
        }
    }

    /// Place.id "kakao-" 접두가 있을 때만 카카오 장소 상세 체인 유효(웹 계약)
    private var kakaoPlaceId: String? {
        place.id.hasPrefix("kakao-") ? String(place.id.dropFirst("kakao-".count)) : nil
    }

    /// 복사 대상 주소 우선순위: 영문 주소 > 도로명 > 지번(웹 PlaceDetail.tsx:81-99 미러)
    private var copyableAddress: String {
        if let english = place.englishAddress, !english.isEmpty { return english }
        return place.roadAddress.isEmpty ? place.address : place.roadAddress
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
