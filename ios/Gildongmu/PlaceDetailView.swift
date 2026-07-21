import SwiftUI
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
                // 주소는 종류마다 "줄 + 그 줄 전용 복사 버튼"을 인접 배치한다. 도로명과
                // 지번은 쓰임이 달라(택배·행정서식) 둘 다 복사할 수 있어야 하고, 버튼이
                // 자기 주소 바로 뒤에 와야 스와이프 순서에서 짝이 유지된다(웹 동형).
                // 보유한 주소만 낸다(빈 주소 = 죽은 버튼). 인터랙티브는 텍스트와 합치지
                // 않는다 — 별도 접근성 객체가 정상(웹 정본 규칙).
                if !place.roadAddress.isEmpty {
                    Text(appLocalized("ios.place.roadAddressLine", place.roadAddress))
                    Button(appLocalized("place.copyRoadAddress")) { copyAddressToPasteboard(place.roadAddress) }
                }
                if !place.address.isEmpty {
                    Text(appLocalized("ios.place.jibunAddressLine", place.address))
                    Button(appLocalized("place.copyJibunAddress")) { copyAddressToPasteboard(place.address) }
                }
                if let english = place.englishAddress, !english.isEmpty {
                    Text(appLocalized("ios.place.englishAddressLine", english))
                    Button(appLocalized("place.copyEnglishAddress")) { copyAddressToPasteboard(english) }
                }
                if let phone = place.phone, !phone.isEmpty,
                   let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                    // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                    Link(appLocalized("ios.place.callLine", phone), destination: telURL)
                }
                Button(appLocalized("placeChat.launch")) { isChatPresented = true }
            }

            Section(appLocalized("ios.route.section")) {
                // 길찾기 탭으로 도착지 프리필 진입(Task I4). 딥링크·브리핑은 각각
                // 외부 앱 위임/단일 수단 미리보기이고, 이건 3수단(대중교통·도보·자동차)을
                // 앱 안에서 한 번에 비교하는 유일한 경로라 목록 맨 위에 둔다.
                Button(appLocalized("directions.toHere")) {
                    DirectionsPrefillStore.shared.pending = .place(label: place.name, lat: place.lat, lng: place.lng)
                }
                Button(appLocalized("ios.route.naver")) { openNaverRoute() }
                Button(appLocalized("ios.route.kakao")) { openKakaoRoute() }
                if let kakaoId = kakaoPlaceId {
                    Button(appLocalized("ios.route.kakaoPlace")) { openKakaoPlace(kakaoId) }
                }
                // 출발 전 미리 듣기 텍스트 브리핑(M4). 실주행은 위 딥링크 위임 유지
                NavigationLink(appLocalized("ios.route.carBriefing")) { CarBriefingView(place: place) }
                NavigationLink(appLocalized("ios.route.transitBriefing")) { TransitBriefingView(place: place) }
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
