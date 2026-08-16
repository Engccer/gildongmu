import SwiftUI
import UIKit
import Accessibility
import GildongmuKit

/// 앱 전용 설정 화면을 연다(공식 API, 심사 안전). "정확한 위치" 토글이 있는
/// 위치 설정은 열린 화면의 "위치" 행 바로 안이다.
/// ⚠ 위치 설정 화면으로 **직접** 가는 딥링크(`App-Prefs:` 류)는 비공개 API여서
/// 심사 거절 사유다. 쓰지 않는다.
@MainActor
func openAppSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
}

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

    /// 기본 실패 카피(8종 리스트 도메인의 구 .failed와 동일).
    /// ⚠ 부연을 붙이지 않는다 — 제목이 이미 실패를 말하고, "잠시 후 다시 시도"는
    /// 새 정보가 없는 꼬리 문장이다(2026-08-02 정리 규칙, D7로 뒤늦게 소화).
    static var defaultFailure: NearbyOverlayCopy {
        NearbyOverlayCopy(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark")
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
    /// 임시 정밀 허가 성공 시 재조회 트리거(reduced 오버레이 전용, 기본 no-op).
    var onPreciseGranted: (() -> Void)? = nil
    let descriptor: NearbyOverlayDescriptor<Payload>

    var body: some View {
        switch phase {
        case .loading:
            ProgressView(descriptor.loadingText)
        // "설정 앱에서 …" 안내에는 그 화면을 여는 버튼을 함께 둔다(위원장 피드백
        // 2026-08-02): 스크린 리더로 설정 앱을 열고 길동무 항목을 찾아가는 비용이
        // 크다. 버튼 한 번이면 그 자리다("정확한 위치" 토글은 열린 화면의 "위치" 행).
        case .denied:
            ContentUnavailableView {
                Label(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash")
            } description: {
                Text(appLocalized("ios.common.geoDeniedDesc"))
            } actions: {
                // 기본 스타일은 텍스트 높이(실측 18pt)라 터치 타깃 44pt 미달(리뷰 M-1)
                Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
        // 권한은 있으나 "정확한 위치"가 꺼진 상태. denied와 카피를 공유하지 않는다 —
        // 켜야 할 스위치가 다르고, 이걸 뭉개면 사용자가 이미 켜 둔 권한을 다시 찾는다.
        case .reducedAccuracy:
            ContentUnavailableView {
                Label(appLocalized("ios.common.geoReducedTitle"), systemImage: "location.circle")
            } description: {
                Text(appLocalized("ios.common.geoReducedDesc"))
            } actions: {
                // "설정 열기"가 아니라 그 자리 시스템 팝업이다. openSettingsURLString이
                // 여는 화면에는 정확한 위치 토글이 없다(위원장 실기기 확인 2026-08-02).
                // 거부·재프롬프트 불가 시에는 설명 문구의 경로 안내가 폴백이고, 버튼
                // 무반응처럼 보이지 않게 그 경로를 통지로 재발화한다.
                Button(appLocalized("ios.common.allowPrecise")) {
                    Task { @MainActor in
                        // 보이는 안내문과 같은 문장을 통지로 재발화하는 것은 의식적
                        // 결정이다: 사용자 행동(버튼 탭)의 응답이라 무반응 방지가
                        // "보이는 콘텐츠 복제 금지"보다 우선한다(리뷰 Minor 2 판단 기록).
                        switch await LocationService.shared.requestTemporaryPreciseAccuracy() {
                        case .granted: onPreciseGranted?()
                        case .denied:
                            AccessibilityNotification.Announcement(appLocalized("ios.common.geoReducedDesc")).post()
                        case .alreadyInFlight: break
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
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

    /// 제목·설명의 거리 표기를 낭독에서 풀어 쓴다(지하철 최근접 emptyTitle이 대상:
    /// 같은 문장의 통지는 변환되는데 화면만 약어면 둘이 어긋난다, 리뷰 I-2).
    /// 거리 없는 카피에는 no-op이라 전 오버레이 일괄 적용이 무해하다.
    /// ⚠ 낭독 라벨은 **제목 Text에만** 건다. `Label(title, systemImage:)` 전체에
    /// 걸면 ContentUnavailableView가 Label을 아이콘·제목으로 분해해 배치하면서
    /// 수정자가 두 조각 모두에 내려가고, 아이콘이 제목 문장 전체를 라벨로 갖게
    /// 되어 오버레이마다 같은 문장이 두 번 낭독될 수 있다(리뷰 실측 2026-08-02:
    /// 아이콘 노드 라벨이 심볼 설명에서 제목 문장으로 바뀌는 것 확인).
    @ViewBuilder private func copyView(_ copy: NearbyOverlayCopy) -> some View {
        if let description = copy.description {
            ContentUnavailableView {
                Label {
                    Text(copy.title).accessibilityLabel(Text(spokenUnits(copy.title)))
                } icon: {
                    Image(systemName: copy.systemImage)
                }
            } description: {
                Text(description).accessibilityLabel(Text(spokenUnits(description)))
            }
        } else {
            ContentUnavailableView {
                Label {
                    Text(copy.title).accessibilityLabel(Text(spokenUnits(copy.title)))
                } icon: {
                    Image(systemName: copy.systemImage)
                }
            }
        }
    }
}
