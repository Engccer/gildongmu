import SwiftUI
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
/// domainSection: 도메인 전용 최상단 섹션(내 주변 소아 진료 등) — 그 화면에 온 이유이므로 서열 1위.
struct PlaceDetailView<DomainSection: View>: View {
    let place: Place
    @ViewBuilder var domainSection: () -> DomainSection
    @Environment(\.openURL) private var openURL
    /// 역 자동 섹션 4종 모델. 로드는 아래 .task에서 킥오프(역일 때만)
    @State private var stationSections = StationSectionsModel()
    /// 무장애 편의시설 자동 섹션 모델. 역 여부와 무관하게 모든 장소에서 로드
    @State private var barrierFreeInfo = BarrierFreeInfoModel()
    /// 장소 채팅 sheet(M5). 표시마다 새 ChatView = 장소마다 새 대화(웹 계약)
    @State private var isChatPresented = false

    var body: some View {
        List {
            domainSection()
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
                // 홈페이지(비카카오 link 보유 장소만, 웹 RouteLinks 미러) — 카카오 장소의
                // link는 카카오맵 장소 상세라 아래 '카카오맵 장소 정보'와 중복(노출 금지)
                if kakaoPlaceId == nil, let link = place.link, let linkURL = URL(string: link) {
                    Link(appLocalized("place.homepage"), destination: linkURL)
                }
                Button(appLocalized("placeChat.launch")) { isChatPresented = true }
            }

            Section(appLocalized("ios.route.section")) {
                // 길찾기 탭으로 도착지 프리필 진입(Task I4) — 출발 전 미리 듣기는
                // 이 3수단 비교(대중교통·도보·자동차)로 일원화(장소 상세의 단일 수단
                // 브리핑 화면은 중복이라 제거, 2026-07-30). 딥링크는 실주행 위임.
                Button(appLocalized("directions.toHere")) {
                    DirectionsPrefillStore.shared.pending = .place(label: place.name, lat: place.lat, lng: place.lng)
                }
                Button(appLocalized("ios.route.naver")) { openNaverRoute() }
                Button(appLocalized("ios.route.kakao")) { openKakaoRoute() }
                if let kakaoId = kakaoPlaceId {
                    Button(appLocalized("ios.route.kakaoPlace")) { openKakaoPlace(kakaoId) }
                }
            }

            // "이 장소 주변" — 내 주변 화면 3종을 장소 좌표로 앵커해 push(웹 장소 상세의
            // BusArrivals·BikeStations·LocalConditions 대응). 인라인 복제 대신 push인 이유:
            // 기존 화면의 새로고침·상태 오버레이·완료 통지 계약이 그대로 따라오고,
            // 상세 화면이 짧게 유지된다(스크린 리더 선형 주파). 발견 경로는 섹션 heading.
            //
            // ⚠ 위치가 웹과 반대(웹은 역 4종 뒤)인 것은 의도다. 웹의 역 시설 2종은
            // 버튼으로 펼치는 접힌 패널이라 그 아래로 가는 비용이 없지만, iOS
            // StationSectionsView는 전부 인라인 전개라 천호역에서 수백 행이다. 뒤에 두면
            // 선형 주파로 이 3행에 닿는 비용이 3행에서 수백 행으로 뒤집힌다(둘 다 heading
            // 점프로는 동등). 스펙 §2-1 참조 — 순서를 바꾸려면 그 구조 차이부터 확인할 것.
            Section {
                NavigationLink(appLocalized("ios.nearby.bus")) { BusNearbyView(anchor: anchor) }
                NavigationLink(appLocalized("ios.nearby.bike")) { BikeNearbyView(anchor: anchor) }
                NavigationLink(appLocalized("ios.nearby.conditions")) { ConditionsView(anchor: anchor) }
            } header: {
                Text(appLocalized("ios.place.nearbyHeading")).accessibilityAddTraits(.isHeader)
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

    /// "이 장소 주변" 화면들이 쓰는 앵커(현재 위치 대신 이 장소 고정).
    /// 이름을 함께 넘겨 앵커 화면 제목에 기준점이 드러나게 한다.
    private var anchor: PlaceAnchor {
        PlaceAnchor(coord: (lat: place.lat, lng: place.lng), name: place.name)
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
        // 앱 미설치 폴백은 같은 장소의 카카오맵 웹 상세로(경로 폴백은 다른 화면이라 오동작)
        openURL(url) { accepted in
            if !accepted, let fallback = URL(string: "https://place.map.kakao.com/\(id)") {
                openURL(fallback)
            }
        }
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

/// 기존 호출처(`PlaceDetailView(place:)`) 무변경 컴파일용 편의 init — 도메인 섹션 없음.
extension PlaceDetailView where DomainSection == EmptyView {
    init(place: Place) {
        self.init(place: place, domainSection: { EmptyView() })
    }
}
