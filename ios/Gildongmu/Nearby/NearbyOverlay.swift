import SwiftUI
import GildongmuKit

/// 오버레이 한 칸의 카피(제목·아이콘·설명) — 전부 현행 switch에서 그대로 이관.
struct NearbyOverlayCopy {
    let title: String
    let systemImage: String
    let description: String?

    init(_ title: String, systemImage: String, description: String? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.description = description
    }

    /// 기본 실패 카피(8종 리스트 도메인의 구 .failed와 동일)
    static var defaultFailure: NearbyOverlayCopy {
        NearbyOverlayCopy(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                          description: appLocalized("ios.common.retryLater"))
    }
}

/// 상태 오버레이 디스크립터 — 전용 팩토리 3종만 허용(불법 조합 타입 차단):
/// list = 리스트 도메인(0건 카피 필수), plain = 비리스트(0건·부재 없음),
/// absentCapable = WhereAmI(.empty 카피 보유).
struct NearbyOverlayDescriptor<Payload> {
    let loadingText: String
    let isEmpty: (Payload) -> Bool
    let emptyList: NearbyOverlayCopy?
    let failedLocation: NearbyOverlayCopy
    let failedServer: NearbyOverlayCopy
    let absent: NearbyOverlayCopy?

    /// 암묵 memberwise init(internal)을 봉인한다 — 이게 없으면 앱 단일 모듈 어디서나
    /// 팩토리를 우회해 불법 조합(리스트인데 emptyList nil 등)을 만들 수 있다.
    private init(
        loadingText: String,
        isEmpty: @escaping (Payload) -> Bool,
        emptyList: NearbyOverlayCopy?,
        failedLocation: NearbyOverlayCopy,
        failedServer: NearbyOverlayCopy,
        absent: NearbyOverlayCopy?
    ) {
        self.loadingText = loadingText
        self.isEmpty = isEmpty
        self.emptyList = emptyList
        self.failedLocation = failedLocation
        self.failedServer = failedServer
        self.absent = absent
    }

    static func list(
        empty: NearbyOverlayCopy,
        isEmpty: @escaping (Payload) -> Bool,
        loadingText: String = appLocalized("ios.common.checking"),
        failedLocation: NearbyOverlayCopy = .defaultFailure,
        failedServer: NearbyOverlayCopy = .defaultFailure
    ) -> Self {
        Self(loadingText: loadingText, isEmpty: isEmpty, emptyList: empty,
             failedLocation: failedLocation, failedServer: failedServer, absent: nil)
    }

    static func plain(
        loadingText: String = appLocalized("ios.common.checking"),
        failedLocation: NearbyOverlayCopy = .defaultFailure,
        failedServer: NearbyOverlayCopy = .defaultFailure
    ) -> Self {
        Self(loadingText: loadingText, isEmpty: { _ in false }, emptyList: nil,
             failedLocation: failedLocation, failedServer: failedServer, absent: nil)
    }

    static func absentCapable(
        absent: NearbyOverlayCopy,
        failedLocation: NearbyOverlayCopy,
        failedServer: NearbyOverlayCopy
    ) -> Self {
        Self(loadingText: appLocalized("ios.common.checking"), isEmpty: { _ in false }, emptyList: nil,
             failedLocation: failedLocation, failedServer: failedServer, absent: absent)
    }
}

/// 공유 상태 오버레이 — 구 11벌 stateOverlay switch의 정본.
/// denied·outOfCoverage 카피는 전 도메인 동일이라 고정(현행과 byte-identical).
struct NearbyStateOverlayView<Payload: Sendable>: View {
    let phase: NearbyLoadPhase<Payload>
    let descriptor: NearbyOverlayDescriptor<Payload>

    var body: some View {
        switch phase {
        case .loading:
            ProgressView(descriptor.loadingText)
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        // 권한은 있으나 "정확한 위치"가 꺼진 상태. denied와 카피를 공유하지 않는다 —
        // 켜야 할 스위치가 다르고, 이걸 뭉개면 사용자가 이미 켜 둔 권한을 다시 찾는다.
        case .reducedAccuracy:
            ContentUnavailableView(appLocalized("ios.common.geoReducedTitle"), systemImage: "location.circle",
                description: Text(appLocalized("ios.common.geoReducedDesc")))
        case .outOfCoverage:
            ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")
        // 서비스 지역 미제공. 어느 서비스인지는 네비게이션 타이틀이 이미 말하므로
        // 도메인 이름을 문구에 넣지 않는다(자명한 것을 다시 설명하지 않는다). 다만
        // **사유는 서로 다른 사실**이라 갈라 말한다: 서울 전용 서비스인지, 이 지역
        // 데이터가 없는지에 따라 사용자가 할 수 있는 일이 다르다.
        case .unavailableHere(let reason):
            ContentUnavailableView(unavailableHereTitle(reason), systemImage: "mappin.slash")
        case .failedLocation:
            copyView(descriptor.failedLocation)
        case .failedServer:
            copyView(descriptor.failedServer)
        case .empty:
            if let absent = descriptor.absent { copyView(absent) }
        case .loaded(let payload):
            if descriptor.isEmpty(payload), let empty = descriptor.emptyList { copyView(empty) }
        case .idle:
            EmptyView()
        }
    }

    /// ⚠ 키를 보간(`"...\(reason.rawValue)"`)하지 않는다: `check-xcstrings-keys.mjs`가
    /// 정적 참조만 검사하므로 보간 키는 린터의 사각지대가 되고, 카탈로그 누락이
    /// 빌드가 아니라 화면에서 키 문자열 낭독으로 드러난다.
    private func unavailableHereTitle(_ reason: UnavailableHereReason) -> String {
        switch reason {
        case .seoulOnly: appLocalized("ios.common.unavailableHere.seoulOnly")
        case .noBusData: appLocalized("ios.common.unavailableHere.noBusData")
        }
    }

    @ViewBuilder private func copyView(_ copy: NearbyOverlayCopy) -> some View {
        if let description = copy.description {
            ContentUnavailableView(copy.title, systemImage: copy.systemImage,
                description: Text(description))
        } else {
            ContentUnavailableView(copy.title, systemImage: copy.systemImage)
        }
    }
}
