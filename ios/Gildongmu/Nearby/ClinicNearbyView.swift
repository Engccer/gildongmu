import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 내 주변 소아 야간진료. SubwayNearbyModel 규범 패턴 미러(3-state 권한 거부/조회 실패/0건).
/// 진료 상태 3-state(open/closed/unknown)를 문장으로 분리한다.
/// 병합 응답 메타 — 화면이 밝히는 두 값만(웹 Status.done 미러, 위원장 판정 2026-07-26:
/// 절단 수치·소스 구분은 목록 미표기 — 진료중 우선 정렬이 "열린 곳 절단" 실패를
/// 구조적으로 제거해 화면 수치가 지키는 것이 없다).
struct ClinicSummary {
    /// "holiday" | "weekday"
    let basis: String
    let supplementFailed: Bool
}

@Observable @MainActor
final class ClinicNearbyModel {
    private(set) var state: NearbyLoadState<NightClinic> = .idle
    /// loaded와 함께 갱신 — 절단·소스 구분 표기용(구버전 응답이면 nil 유지 필드 폴백).
    private(set) var summary: ClinicSummary?
    private let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러): 로드 진행 중 재호출은 즉시 무시
    private var isLoadingInFlight = false

    func load(force: Bool = false) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외(첫 로드·실패 후 재시도)는 로딩 표시
        if case .loaded = state {} else { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            let response = try await service.clinics(lat: coord.lat, lng: coord.lng)
            let clinics = response.clinics
            summary = ClinicSummary(
                basis: response.basis ?? "weekday",
                supplementFailed: response.supplementFailed ?? false)
            state = .loaded(clinics)
            announceLoaded(count: clinics.count, unit: appLocalized("ios.nearby.unitPlace"))
        } catch let error as LocationService.LocationError {
            if case .denied = error {
                // loaded에서 권한 취소로 전락하면 목록이 통째로 사라진다 — 무신호 화면 전환 방지 통지
                if case .loaded = state { announcePermissionLost() }
                state = .denied
            } else if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        } catch {
            // 조회 실패: 직전 성공 데이터가 있으면 유지(새로고침=재조회이지 데이터 포기 아님)
            if case .loaded = state { announceRefreshFailed() } else { state = .failed }
        }
    }
}

struct ClinicNearbyView: View {
    @State private var model = ClinicNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?

    var body: some View {
        List {
            // 공휴일 기준으로 읽은 날·보완 실패만 밝힌다(조건부라 잡음 아님, 웹 미러).
            if case .loaded(let clinics) = model.state, !clinics.isEmpty,
               let summary = model.summary,
               summary.basis == "holiday" || summary.supplementFailed {
                Section {
                    if summary.basis == "holiday" {
                        Text(appLocalized("clinicNearby.basisHoliday"))
                    }
                    if summary.supplementFailed {
                        Text(appLocalized("clinicNearby.supplementFailedNotice"))
                    }
                }
            }
            if case .loaded(let clinics) = model.state {
                ForEach(clinics) { clinic in
                    Section {
                        // 진료 상태 3-state: "마감"과 "정보 없음"을 뭉개지 않고 문장으로 분리.
                        // 달빛 지정 여부는 목록 미표기(위원장 판정 2026-07-26) — 데이터는 보존,
                        // 상세 이식 시 조건부 노출.
                        Text(clinicStatusText(clinic.openStatus))
                        if !clinic.address.isEmpty {
                            Text(clinic.address)
                        }
                        if !clinic.directions.isEmpty {
                            Text(clinic.directions)
                        }
                        // 전화는 인터랙티브 요소라 별도 객체로 분리(합치지 않음). 표시 라벨은 원문, tel URL만 하이픈 제거
                        if !clinic.phone.isEmpty,
                           let url = URL(string: "tel:\(clinic.phone.replacingOccurrences(of: "-", with: ""))") {
                            Link(appLocalized("ios.place.callLine", clinic.phone), destination: url)
                        }
                    } header: {
                        // 기관명만 heading(웹 h4 규칙). 종별·거리는 같은 줄에 흡수.
                        Text(joinText(clinic.name, clinic.kind, "\(clinic.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
                            // 채팅 진입: 시각(길게 눌러 메뉴) + VoiceOver 로터, 동일 라벨(웹 placeChat.launchFor 미러)
                            .contextMenu {
                                Button(chatLabel(clinic.name)) { chatPlace = nightClinicToPlace(clinic) }
                            }
                            .accessibilityAction(named: Text(chatLabel(clinic.name))) {
                                chatPlace = nightClinicToPlace(clinic)
                            }
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.clinic"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }

    private func chatLabel(_ name: String) -> String { "\(name)에 관해 물어보기" }

    /// 진료 상태 3-state 문장. open이면 종료시각까지, closed/unknown은 각각의 문장으로.
    private func clinicStatusText(_ status: NightClinic.OpenStatus) -> String {
        switch status.state {
        case "open":
            if let end = status.end {
                return joinText(appLocalized("clinicNearby.open"), endTimeText(end))
            }
            return appLocalized("clinicNearby.open")
        case "closed":
            return appLocalized("ios.nearby.clinicClosed")
        default:
            return appLocalized("ios.nearby.clinicUnknown")
        }
    }

    /// HHMM 정수를 "HH시 MM분까지"로. 2400은 자정을 뜻해 "자정까지".
    private func endTimeText(_ hhmm: Int) -> String {
        if hhmm == 2400 { return appLocalized("ios.nearby.untilMidnight") }
        return appLocalized("ios.nearby.untilTime", String(hhmm / 100), String(hhmm % 100))
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.state {
        case .loading: ProgressView(appLocalized("ios.common.checking"))
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        case .failed:
            ContentUnavailableView(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        case .loaded(let clinics) where clinics.isEmpty:
            ContentUnavailableView(appLocalized("ios.nearby.clinicEmpty"), systemImage: "cross.case")
        default: EmptyView()
        }
    }
}
