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

/// 장소명 병기(E28) — 앱 언어를 넣은 Kit `bilingualName` 축약. 비-ko에서 en 원천 → 로마자 → 한글.
@MainActor
func bilingual(_ ko: String, en: String? = nil, roman: String?) -> BilingualName {
    bilingualName(lang: AppLanguage.current, ko: ko, en: en, roman: roman)
}

/// 병기 이름이 든 한 줄: 시각은 `Roman (한글)`을 품은 문장, 낭독은 괄호 없는 문장(위원장 판정 ③ —
/// 접근 가능한 이름은 괄호 앞만). 단일 `Text`라 한 객체이고 거리 단위 정정도 함께 건다.
@MainActor
func bilingualLine(visible: String, accessible: String) -> some View {
    Text(visible).accessibilityLabel(Text(spokenUnits(accessible)))
}

/// 비-ko UI에 한글이 그대로 남는 자리(병기 불가 폴백·한국어 분류)의 언어 태깅 후보 ①(E28).
/// `.environment(\.locale, ko)`가 VoiceOver 발화 엔진을 실제로 바꾸는지는 **실기기 판정 항목**
/// (`docs/BACKLOG.md` E28 종결 기록). 후보 ②는 `AttributedString.languageIdentifier`.
struct KoreanText: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(verbatim: text).environment(\.locale, Locale(identifier: "ko"))
    }
}

/// 새로고침 실패 통지: 직전 성공 데이터 유지와 짝(데이터 포기 아님을 함께 알린다).
/// ⚠ 기본 우선순위를 유지한다 — 목록이 그대로 남아 포커스가 움직이지 않으므로
/// 잠식될 착지 낭독이 없다(아래 전락 3종과 갈리는 정확한 판별선, D24).
@MainActor
func announceRefreshFailed() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshFailed")).post()
}

/// 목록이 통째로 오버레이로 교체되는 전락 통지 3종의 공통 게시(D24, 2026-08-17).
/// 화면 교체로 포커스가 옮겨가고 VO가 착지 라벨을 낭독하는데, 기본 우선순위면
/// "왜 화면이 바뀌었는가"를 말하는 이 통지가 거기에 잠식돼 무발화된다(헌장 §6 —
/// 포커스가 움직이고 그 통지가 착지 라벨로 대체될 수 없을 때는 `.high`).
@MainActor
private func announceListReplaced(_ text: String) {
    var attributed = AttributedString(text)
    attributed.accessibilitySpeechAnnouncementPriority = .high
    AccessibilityNotification.Announcement(attributed).post()
}

/// 권한 취소 전락 통지: loaded 중 새로고침에서 위치 권한 거부를 만나면 목록이
/// denied 화면으로 통째로 바뀐다 — 무신호 화면 전환(SR 맥락 상실) 방지.
@MainActor
func announcePermissionLost() {
    announceListReplaced(appLocalized("ios.nearby.refreshDenied"))
}

/// 정밀 위치 상실 전락 통지. **화면 오버레이와 같은 원인을 말해야 한다** —
/// `announcePermissionLost`를 재사용하면 화면은 "정확한 위치가 꺼져 있습니다"인데
/// 낭독은 "권한이 꺼져 있어"라서 둘이 서로 다른 원인을 지목한다.
@MainActor
func announceAccuracyLost() {
    announceListReplaced(appLocalized("ios.nearby.refreshReduced"))
}

/// 서비스 지역 밖 전락 통지(웹 tCommon("outOfCoverage") 미러): loaded 중 새로고침에서
/// 커버리지 밖 좌표를 만나면 목록이 통째로 사라진다 — announcePermissionLost 동형.
/// 오류가 아니라 안내이므로 같은 문구를 그대로 쓴다.
@MainActor
func announceOutOfCoverage() {
    announceListReplaced(appLocalized("ios.common.outOfCoverage"))
}

/// NearbyLoadCore 좌표 소스 어댑터. currentCoordinate는 typed throws(LocationError)라
/// 취소가 오류로 나올 수 없고(커밋 게이트가 방어 정본), denied/unavailable만 번역한다.
///
/// 수동 위치가 있으면 그 좌표를 쓴다(`ManualLocationJudge`). `.fixed`(장소 앵커)는
/// 이 클로저를 아예 거치지 않으므로 **앵커 > 수동 > GPS** 우선순위가
/// `NearbyLoadCore`의 switch에서 구조적으로 성립한다.
extension LocationService {
    static func nearbyCoordinateSource() -> NearbyCoordinateSource {
        .current { force in
            do {
                return try await ManualLocationJudge.effectiveCoordinate(force: force)
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
    /// 이름 로마자(E28) — 화면 제목은 라벨 분리 수단이 없어 비-ko는 1순위 이름만 쓴다.
    var nameRoman: String? = nil
}

/// 앵커 화면 제목: 기본 제목에 기준 장소명을 쉼표로 흡수(한 줄=한 객체).
/// 현재 위치 화면(anchor nil)은 기본 제목 그대로 — 허브 호출처 문자열 불변.
@MainActor
func nearbyTitle(_ base: String, anchor: PlaceAnchor?) -> String {
    joinText(base, anchor.map { bilingual($0.name, roman: $0.nameRoman).primary })
}

/// 완료 통지의 대상 종류. 종류별 완성 문장 키(A29) — 종전 "{count} {unit} nearby" +
/// 단위 낱말 합성은 en "1 place nearby"를 만들 수 없고 fr은 어순까지 달랐다.
enum NearbyCountKind {
    case places, bikeStations, busStops, stations, events
}

/// 완료 통지 문구 조립부. 0건도 문장으로. 키는 리터럴 switch(check-xcstrings-keys 린터 계약).
@MainActor
func nearbyLoadedMessage(count: Int, kind: NearbyCountKind) -> String {
    guard count > 0 else { return appLocalized("ios.nearby.announceEmpty") }
    switch kind {
    case .places: return appLocalized("ios.nearby.announcePlaces", count)
    case .bikeStations: return appLocalized("ios.nearby.announceBikes", count)
    case .busStops: return appLocalized("ios.nearby.announceStops", count)
    case .stations: return appLocalized("ios.nearby.announceStations", count)
    case .events: return appLocalized("ios.nearby.announceEvents", count)
    }
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
