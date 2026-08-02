import Foundation
import SwiftUI
import Accessibility
import GildongmuKit

// 내 주변 도메인 공통 부속. 상태 타입 자체는 GildongmuKit의 NearbyLoadPhase/NearbyLoadEvent가
// 정본(전 화면 이관 완료)이며, 이 파일은 그 위에 얹는 좌표 어댑터·이벤트→VO 통지 매퍼·문구 조립만 둔다.

/// nil·빈 문자열 조각을 제거하고 ", "로 결합(웹 `joinText` 미러).
/// 한 줄 = 한 접근성 객체: 시각 목적 인라인 분절 대신 단일 텍스트로 합친다.
/// 구분자는 쉼표(가운뎃점은 일부 스크린 리더가 단어로 낭독해 금지).
func joinText(_ parts: String?...) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// 낭독 전용: 거리 단위 약어를 로케일 단어로 풀어 쓴다.
/// iOS VoiceOver가 숫자 뒤 "m"을 meters가 아니라 **minutes로 낭독**하는 시스템
/// 버그 대응(실기기 관찰 2026-08-02: km는 정확히 읽으면서 m만 오독). 시각 표기는
/// `formatDistance` 원문을 유지하고 이 결과는 낭독 채널(라벨·통지)에만 쓴다.
@MainActor
func spokenUnits(_ text: String) -> String {
    spokenDistanceUnits(text, meters: appLocalized("ios.unit.spokenMeters"))
}

/// 거리 표기가 든 행 텍스트: 시각은 원문, 낭독은 단위 풀어쓰기.
@MainActor
func distanceText(_ s: String) -> some View {
    Text(s).accessibilityLabel(Text(spokenUnits(s)))
}

/// 새로고침 실패 통지: 직전 성공 데이터 유지와 짝(데이터 포기 아님을 함께 알린다).
@MainActor
func announceRefreshFailed() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshFailed")).post()
}

/// 권한 취소 전락 통지: loaded 중 새로고침에서 위치 권한 거부를 만나면 목록이
/// denied 화면으로 통째로 바뀐다 — 무신호 화면 전환(SR 맥락 상실) 방지.
@MainActor
func announcePermissionLost() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshDenied")).post()
}

/// 정밀 위치 상실 전락 통지. **화면 오버레이와 같은 원인을 말해야 한다** —
/// `announcePermissionLost`를 재사용하면 화면은 "정확한 위치가 꺼져 있습니다"인데
/// 낭독은 "권한이 꺼져 있어"라서 둘이 서로 다른 원인을 지목한다.
@MainActor
func announceAccuracyLost() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshReduced")).post()
}

/// 서비스 지역 밖 전락 통지(웹 tCommon("outOfCoverage") 미러): loaded 중 새로고침에서
/// 커버리지 밖 좌표를 만나면 목록이 통째로 사라진다 — announcePermissionLost 동형.
/// 오류가 아니라 안내이므로 같은 문구를 그대로 쓴다.
@MainActor
func announceOutOfCoverage() {
    AccessibilityNotification.Announcement(appLocalized("ios.common.outOfCoverage")).post()
}

/// NearbyLoadCore 좌표 소스 어댑터. currentCoordinate는 typed throws(LocationError)라
/// 취소가 오류로 나올 수 없고(커밋 게이트가 방어 정본), denied/unavailable만 번역한다.
extension LocationService {
    static func nearbyCoordinateSource() -> NearbyCoordinateSource {
        .current { force in
            do {
                return try await LocationService.shared.currentCoordinate(force: force)
            } catch {
                // catch 변수는 any Error로 추론되므로 캐스팅해 판별한다. denied만 번역하고
                // 나머지는 전부 unavailable — 위치 오류가 코어 default 분기로 새어
                // 서버 실패 카피로 낭독되는 일이 없도록 total하게 닫는다.
                if let locationError = error as? LocationService.LocationError {
                    switch locationError {
                    case .denied: throw NearbyLocationError.denied
                    // 정밀 위치 꺼짐은 권한 거부와 별개 축이다. unavailable로 뭉개면
                    // "조회 실패" 카피가 낭독되어 사용자가 원인을 알 수 없다.
                    case .reducedAccuracy: throw NearbyLocationError.reducedAccuracy
                    case .unavailable: throw NearbyLocationError.unavailable
                    }
                }
                throw NearbyLocationError.unavailable
            }
        }
    }
}

/// 장소 앵커 — 좌표와 그 좌표의 이름을 함께 옮긴다(장소 상세 "이 장소 주변").
/// 이름이 딸려 오는 이유: 앵커 화면의 문구는 전부 "주변 …"인데 그 기준점이 현재
/// 위치가 아니라는 사실이 화면 어디에도 없으면, 스크린 리더 사용자는 "주변에 대여소가
/// 없습니다"를 자기 주변으로 읽는다(뒤로 가기 라벨은 되돌아가야 얻는 맥락이다).
/// 카피는 그대로 두고 화면 제목에만 병기해 기준점을 밝힌다.
struct PlaceAnchor {
    let coord: NearbyCoord
    let name: String
}

/// 앵커 화면 제목: 기본 제목에 기준 장소명을 쉼표로 흡수(한 줄=한 객체).
/// 현재 위치 화면(anchor nil)은 기본 제목 그대로 — 허브 호출처 문자열 불변.
@MainActor
func nearbyTitle(_ base: String, anchor: PlaceAnchor?) -> String {
    joinText(base, anchor?.name)
}

/// 완료 통지 문구 조립부(문자열 불변). 0건도 문장으로.
@MainActor
func nearbyLoadedMessage(count: Int, unit: String) -> String {
    count == 0
        ? appLocalized("ios.nearby.announceEmpty")
        : appLocalized("ios.nearby.announceCount", unit, String(count))
}

/// 이벤트→VO 발화 매퍼 1벌(스펙 §4): 전락 통지 3종은 기존 announce* 그대로,
/// loaded 문구만 도메인 클로저. emptyResult는 WhereAmI만 문구를 준다.
@MainActor
func nearbyAnnouncer<Payload: Sendable>(
    loaded: @escaping @MainActor (Payload) -> String,
    emptyResult: @autoclosure @escaping () -> String? = nil
) -> @MainActor (NearbyLoadEvent<Payload>) -> Void {
    { event in
        switch event {
        case .loaded(let payload):
            // 통지도 낭독 채널이다: 거리 포함 문구(지하철 최근접 등)의 단위를 풀어 쓴다
            AccessibilityNotification.Announcement(spokenUnits(loaded(payload))).post()
        case .emptyResult:
            if let message = emptyResult() {
                AccessibilityNotification.Announcement(spokenUnits(message)).post()
            }
        case .refreshFailed: announceRefreshFailed()
        case .permissionLost: announcePermissionLost()
        case .accuracyLost: announceAccuracyLost()
        case .wentOutOfCoverage: announceOutOfCoverage()
        }
    }
}
