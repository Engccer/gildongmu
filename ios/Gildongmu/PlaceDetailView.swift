import SwiftUI
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
/// domainSection: 도메인 전용 최상단 섹션(내 주변 소아 진료 등) — 그 화면에 온 이유이므로 서열 1위.
///
/// **레이아웃은 둘이다**(E44 spec `2026-09-17-station-detail-reorg-design.md` §3). `stationLayoutKind`가 역(지하철·기차역
/// POI, 경유역)이면 역 정보 → 도착·시간표·교통약자 시설(종류별 접기) → 무장애 → 길찾기 → 이 장소 주변(지하철 없음),
/// 그 밖이면 개편 전 순서 그대로다. ⚠ 넓은 `isStation`으로 레이아웃을 고르지 말 것 — 출구 POI·"철도" 업체·이름만
/// "역"으로 끝나는 장소가 역 모양이 된다(설계 리뷰 M2). 역 섹션 **로드**는 종전대로 `isStation`이다.
struct PlaceDetailView<DomainSection: View>: View {
    let place: Place
    /// 표시용 분류(A28) — 채팅 컨텍스트·역 판정은 `place.category` 원문 그대로.
    private var displayCategory: String {
        pickCategory(lang: AppLanguage.current, category: place.category, categoryEn: place.categoryEn)
    }
    /// 길찾기 프리필 진입 버튼 노출 여부(기본 표시). 안내 시트의 "장소 상세 보기"
    /// 문맥에서만 숨긴다 — 이미 그곳으로 안내 중이라 무의미하고, 누르면 시트 뒤
    /// 길찾기 폼을 조작해 보이지 않는 상태 변화를 만든다(스펙 2026-08-12 §2).
    var showsDirectionsEntry: Bool = true
    /// "이 장소에 관해 물어보기" 노출 여부(기본 표시). 채팅 안에서 연 상세(카드·산문
    /// 액션)에서만 숨긴다 — 채팅 위에 새 채팅 시트를 쌓는 재진입 순환 방지.
    var showsChatEntry: Bool = true
    /// 경유역 전화번호 조회의 노선 힌트(E44 spec §5.2) — 대중교통 안내 시트가 경유역을 열 때만, 누르는 순간 확정한
    /// leg `lineName`을 넘긴다. 그 밖의 상세는 nil(자기 `phone`이 전부다).
    var stationLineHint: String? = nil
    @ViewBuilder var domainSection: () -> DomainSection
    @Environment(\.openURL) private var openURL
    /// 역 자동 섹션 모델. 로드는 아래 .task에서 킥오프(역일 때만)
    @State private var stationSections = StationSectionsModel()
    private let guideSession = GuideSession.shared
    private let phoneStore = StationPhoneStore.shared
    /// 무장애 편의시설 자동 섹션 모델. 역 여부와 무관하게 모든 장소에서 로드
    @State private var barrierFreeInfo = BarrierFreeInfoModel()
    /// 영업시간 한 줄(E24).
    @State private var placeHours = PlaceHoursModel()
    /// 장소 채팅 sheet(M5). 표시마다 새 ChatView = 장소마다 새 대화(웹 계약)
    @State private var isChatPresented = false

    /// 비-ko 병기(E28). 내비게이션 타이틀은 접근 라벨을 따로 줄 수 없어 1순위 이름만 쓰고,
    /// 한글 원문은 바로 아래 보조 줄에 시각 전용(`accessibilityHidden`)으로 둔다.
    private var bilingualTitle: BilingualName { bilingual(place.name, roman: place.nameRoman) }

    private var layoutKind: StationLayoutKind? { stationLayoutKind(place) }

    var body: some View {
        List {
            if let secondary = bilingualTitle.secondary {
                Section {
                    Text(secondary)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            domainSection()
            if let kind = layoutKind {
                // 역 상세(E44 §3.2). 교통약자 시설을 접어 두므로 역 섹션을 앞에 둬도 주변·길찾기까지의 거리가
                // 짧다 — 종전 "주변 먼저" 배치의 근거(펼친 수백 행)가 사라졌다. 이 장소 주변은 최하단(판정 ⑤).
                stationInfoSection(kind)
                StationDetailSections(model: stationSections)
                BarrierFreeInfoSection(model: barrierFreeInfo)
                routeSection
                nearbySection(includesSubway: false)
            } else {
                generalInfoSection
                routeSection
                nearbySection(includesSubway: true)
                // 역이면 역 정보·실시간 도착·교통약자 시설이 자동 등장(조용히 나타남, M3) — 출구 POI 등 드문 경우.
                if isStation(place) {
                    StationMetaSection(model: stationSections)
                    StationDetailSections(model: stationSections)
                }
                // 무장애 편의시설도 자동 등장(조용히 나타남, 역 여부 무관)
                BarrierFreeInfoSection(model: barrierFreeInfo)
            }
        }
        .navigationTitle(bilingualTitle.primary)
        .navigationBarTitleDisplayMode(.large)
        .task {
            if isStation(place) {
                await stationSections.load(stationName: place.name)
            }
        }
        .task {
            await barrierFreeInfo.load(lat: place.lat, lng: place.lng, name: place.name)
        }
        .task {
            await placeHours.load(place: place)
        }
        .task {
            await lookupStationPhoneIfNeeded()
        }
        .sheet(isPresented: $isChatPresented) {
            ChatView(place: place)
        }
    }

    // MARK: 현행 분기

    /// 개편 전 기본 정보 섹션(분류·주소·영업시간·전화·홈페이지·물어보기). 순서를 바꾸지 않는다.
    private var generalInfoSection: some View {
        Section {
            categoryRow
            addressRows
            // 영업시간(E24): 전화 링크 앞 — 시각이 틀릴 수 있어 확인 경로와 짝짓는다.
            PlaceHoursLine(model: placeHours)
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                Link(appLocalized("ios.place.callLine", phone), destination: telURL)
            }
            homepageRow
            chatRow
        }
    }

    // MARK: 역 분기

    /// 역 정보 섹션(E44 §3.2 1). 제목은 역 상세면 항상 선다. 전화 줄이 맨 위("가장 많이 쓸 메뉴", 위원장).
    private func stationInfoSection(_ kind: StationLayoutKind) -> some View {
        Section {
            stationPhoneRow
            StationMetaLine(model: stationSections)
            // 분류 줄은 기차역만 — `KTX정차역` 같은 정보가 여기뿐이다. 지하철은 합성값이거나 메타 줄 노선과 중복.
            if kind == .rail { categoryRow }
            addressRows
            PlaceHoursLine(model: placeHours)
            homepageRow
            chatRow
        } header: {
            Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)
        }
    }

    /// 전화 줄(E44 §5.5): 자기 번호가 있으면 그것, 경유역이면 조회 결과. 대표번호는 밝힌다(판정 ⑥),
    /// 조회 실패는 없음과 가른다(3-state). 줄은 조용히 나타난다(자동 등장 보조 정보, 통지 없음).
    @ViewBuilder private var stationPhoneRow: some View {
        if let phone = place.phone, !phone.isEmpty {
            stationPhoneLink(phone)
        } else if let line = stationLineHint, place.id.hasPrefix("transit-stop:") {
            switch phoneStore.result(stationName: place.name, lat: place.lat, lng: place.lng, lineName: line) {
            case .direct(let phone)?, .representative(let phone)?:
                stationPhoneLink(phone)
            case .failed?:
                Text(appLocalized("ios.station.phoneError"))
            case .unavailable?, nil:
                EmptyView()
            }
        }
    }

    @ViewBuilder private func stationPhoneLink(_ phone: String) -> some View {
        if let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
            if isRepresentativePhone(phone) {
                Link(appLocalized("ios.place.callRepresentativeLine", phone), destination: telURL)
            } else {
                Link(appLocalized("ios.place.callLine", phone), destination: telURL)
            }
        }
    }

    /// 경유역만 조회한다(E44 §5.2) — 검색 탭·채팅에서 연 역은 이미 카카오 POI라 다시 찾아도 같다.
    /// 화면에 떠 있는 동안 `recheckSeconds`마다 다시 부른다 — 신선하면 네트워크 없이 돌아오고, 낡으면 저장소 보관 한도 전에 갱신한다.
    private func lookupStationPhoneIfNeeded() async {
        guard (place.phone ?? "").isEmpty, place.id.hasPrefix("transit-stop:"), let line = stationLineHint else { return }
        while !Task.isCancelled {
            await phoneStore.resolve(stationName: place.name, lat: place.lat, lng: place.lng, lineName: line)
            try? await Task.sleep(for: .seconds(StationPhoneStore.recheckSeconds))
        }
    }

    // MARK: 공용 행·섹션

    /// 한 줄=한 객체: 라벨 볼드 분절 대신 단일 텍스트(웹 정본 규칙). 분류는 비-ko에서 서버 영문(categoryEn, A28)을
    /// 우선한다. 영문이 없어 한국어가 남는 폴백에만 언어 태깅 후보 ①(KoreanText, 실기기 판정 항목).
    @ViewBuilder private var categoryRow: some View {
        if !displayCategory.isEmpty {
            if AppLanguage.current != "ko", hasHangul(displayCategory) {
                KoreanText(displayCategory)
            } else {
                Text(displayCategory)
            }
        }
    }

    /// 주소는 종류마다 "줄 + 그 줄 전용 복사 버튼"을 인접 배치한다(택배·행정서식은 지번 필요, 웹 동형).
    /// 보유한 주소만 낸다(빈 주소 = 죽은 버튼). 인터랙티브는 텍스트와 합치지 않는다.
    @ViewBuilder private var addressRows: some View {
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
    }

    /// 홈페이지(비카카오 link 보유 장소만, 웹 RouteLinks 미러) — 카카오 장소의 link는 카카오맵 장소 상세라
    /// 아래 '카카오맵 장소 정보'와 중복(노출 금지).
    @ViewBuilder private var homepageRow: some View {
        if kakaoPlaceId == nil, let link = place.link, let linkURL = URL(string: link) {
            Link(appLocalized("place.homepage"), destination: linkURL)
        }
    }

    @ViewBuilder private var chatRow: some View {
        if showsChatEntry {
            Button(appLocalized("placeChat.launch")) { isChatPresented = true }
        }
    }

    /// 길찾기 섹션. 제목은 명시 heading(E44 §3.2 7 — 역 상세에선 화면 아래로 내려가 제목 점프 의존이 커진다).
    private var routeSection: some View {
        Section {
            // 길찾기 탭으로 도착지 프리필 진입(Task I4) — 출발 전 미리 듣기는 이 3수단 비교로 일원화.
            // 두 버튼은 별개 접근성 객체다 — 라벨이 각각 동작의 범위를 말한다. "여기부터"는 도착지 입력으로 착지(E32).
            if showsDirectionsEntry {
                Button(appLocalized("directions.toHere")) {
                    DirectionsPrefillStore.shared.pending = DirectionsPrefill(
                        role: .to, endpoint: .place(label: place.name, lat: place.lat, lng: place.lng))
                }
                Button(appLocalized("directions.fromHere")) {
                    DirectionsPrefillStore.shared.pending = DirectionsPrefill(
                        role: .from, endpoint: .place(label: place.name, lat: place.lat, lng: place.lng))
                }
            }
            // 안내 중에만(N1 spec §2.5): 진행 중인 세션의 목적지를 이 장소로 바꾼다. 비콘은 같은 세션의 경로 재획득,
            // 대중교통은 2단(후보 선택)이라 준비만 하고 통지한다 — 시트를 자동으로 올리지 않는다(설계 리뷰 M3).
            if showsDirectionsEntry, guideSession.beacon.isTracking || guideSession.transit.isTracking {
                Button(appLocalized("guide.changeDestHere")) {
                    let dest = BeaconDest(lat: place.lat, lng: place.lng)
                    if guideSession.beacon.isTracking {
                        if guideSession.beacon.changeDestination(dest: dest, label: place.name) {
                            GuideFormSyncStore.shared.post(.place(label: place.name, lat: place.lat, lng: place.lng))
                        }
                    } else {
                        guideSession.transit.prepareDestinationChange(dest: dest, label: place.name)
                        guideSession.beacon.announceNow(
                            appLocalized("guide.transitDestChangePrepared"),
                            highPriority: true, bypassSuppression: true)
                    }
                }
                // 경유지 추가·변경(N4 spec §4.5): 동작이 교체라 기존 경유지가 있으면 라벨이 그것을 말한다.
                if guideSession.waypointAvailable {
                    Button(appLocalized(
                        guideSession.beacon.waypoint == nil ? "guide.addWaypointHere" : "guide.changeWaypointHere"
                    )) {
                        if guideSession.beacon.setWaypoint(
                            dest: BeaconDest(lat: place.lat, lng: place.lng), label: place.name
                        ) {
                            GuideFormSyncStore.shared.postWaypoint(
                                .place(label: place.name, lat: place.lat, lng: place.lng))
                        }
                    }
                }
            }
            if let url = buildNaverRouteDeeplink(mode: .walk, dest: destination, appname: AppConfig.appIdentifier) {
                Button(appLocalized("ios.route.naver")) { openWithFallback(url) }
            }
            if let url = buildKakaoRouteDeeplink(mode: .walk, dest: destination) {
                Button(appLocalized("ios.route.kakao")) { openWithFallback(url) }
            }
            if let kakaoId = kakaoPlaceId, let url = buildKakaoPlaceDeeplink(kakaoPlaceId: kakaoId) {
                Button(appLocalized("ios.route.kakaoPlace")) { openKakaoPlace(kakaoId, url: url) }
            }
        } header: {
            Text(appLocalized("ios.route.section")).accessibilityAddTraits(.isHeader)
        }
    }

    /// "이 장소 주변" — 내 주변 화면을 장소 좌표로 앵커해 push. 인라인 복제 대신 push인 이유: 기존 화면의 새로고침·
    /// 상태 오버레이·완료 통지 계약이 그대로 따라오고 상세가 짧게 유지된다. 발견 경로는 섹션 heading.
    /// 역 상세는 지하철 도착 행을 뺀다(E44 판정 ④ — 같은 역 도착이 위 "실시간 도착"에 이미 있고, 역 상세끼리는
    /// 구성이 같다). 그 밖의 장소는 종류와 무관하게 종전 4종(이용 빈도순, 지하철 먼저)을 종전 자리에 둔다 — 역 섹션이 함께
    /// 뜨는 출구 POI에서도 근접 2개 역은 새 정보(도보권 환승 대안)이고, 장소 종류에 따라 행이 사라지거나 자리가 바뀌면
    /// 위치를 외워 쓰는 스크린 리더 탐색이 무너진다(리뷰 지적 수용 판정 2026-08-02).
    private func nearbySection(includesSubway: Bool) -> some View {
        Section {
            if includesSubway {
                NavigationLink(appLocalized("ios.nearby.subway")) { SubwayNearbyView(anchor: anchor) }
            }
            NavigationLink(appLocalized("ios.nearby.bus")) { BusNearbyView(anchor: anchor) }
            NavigationLink(appLocalized("ios.nearby.bike")) { BikeNearbyView(anchor: anchor) }
            NavigationLink(appLocalized("ios.nearby.conditions")) { ConditionsView(anchor: anchor) }
        } header: {
            Text(appLocalized("ios.place.nearbyHeading")).accessibilityAddTraits(.isHeader)
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
    private var anchor: PlaceAnchor {
        PlaceAnchor(coord: (lat: place.lat, lng: place.lng), name: place.name, nameRoman: place.nameRoman)
    }

    private func openKakaoPlace(_ id: String, url: URL) {
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

/// 시트로 띄운 장소 상세 — 닫기 버튼을 단다(시트 툴바 관례 `.cancellationAction`, `ChatView` 동형).
/// ⚠ 시트 안에 장소 상세를 넣는 자리는 전부 이것을 지난다 — 아래로 쓸기·VO 문지르기만 남기면 스크린 리더
/// 사용자는 빠져나오는 수단을 찾지 못한다(2026-09-16 실승차: 안내 시트의 역 상세에서 닫기를 못 찾았다).
/// push(`NavigationLink`·`navigationDestination`)는 뒤로 버튼이 있어 해당 없다. 가드 `place-detail-sheet-guard.test.ts`.
struct PlaceDetailSheet: View {
    let place: Place
    var showsDirectionsEntry: Bool = true
    var showsChatEntry: Bool = true
    var stationLineHint: String? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PlaceDetailView(
                place: place, showsDirectionsEntry: showsDirectionsEntry, showsChatEntry: showsChatEntry,
                stationLineHint: stationLineHint)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(appLocalized("actions.close")) { dismiss() }
                    }
                }
        }
    }
}

/// 기존 호출처(`PlaceDetailView(place:)`) 무변경 컴파일용 편의 init — 도메인 섹션 없음.
extension PlaceDetailView where DomainSection == EmptyView {
    init(
        place: Place, showsDirectionsEntry: Bool = true, showsChatEntry: Bool = true,
        stationLineHint: String? = nil
    ) {
        self.init(
            place: place, showsDirectionsEntry: showsDirectionsEntry,
            showsChatEntry: showsChatEntry, stationLineHint: stationLineHint, domainSection: { EmptyView() })
    }
}
