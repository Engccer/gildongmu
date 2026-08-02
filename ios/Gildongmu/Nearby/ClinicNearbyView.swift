import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 소아 야간진료 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 진료 상태 3-state(open/closed/unknown)를 문장으로 분리한다.
/// 병합 응답 메타 — 화면이 밝히는 두 값만(웹 Status.done 미러, 위원장 판정 2026-07-26:
/// 절단 수치·소스 구분은 목록 미표기 — 진료중 우선 정렬이 "열린 곳 절단" 실패를
/// 구조적으로 제거해 화면 수치가 지키는 것이 없다).
struct ClinicSummary: Sendable {
    /// "holiday" | "weekday"
    let basis: String
    let supplementFailed: Bool
}

/// clinics+summary를 한 커밋으로 묶는 payload — "loaded와 함께 갱신"이 phase 대입 자체로
/// 보장된다(구버전의 별도 summary 필드+nil 폴백을 대체).
struct ClinicPayload: Sendable {
    let clinics: [NightClinic]
    let summary: ClinicSummary
}

@Observable @MainActor
final class ClinicNearbyModel {
    private var core: NearbyLoadCore<ClinicPayload>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<ClinicPayload> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                let response = try await service.clinics(lat: coord.lat, lng: coord.lng)
                return ClinicPayload(
                    clinics: response.clinics,
                    summary: ClinicSummary(
                        basis: response.basis ?? "weekday",
                        supplementFailed: response.supplementFailed ?? false))
            },
            willCommit: { [weak self] _ in self?.window.reset() },   // 커밋과 원자(스펙 §4)
            onEvent: nearbyAnnouncer(loaded: { payload in
                nearbyLoadedMessage(count: payload.clinics.count, unit: appLocalized("ios.nearby.unitPlace"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
    func revealMore() -> String? {
        guard case .loaded(let payload) = phase,
              let firstNewIndex = window.revealMore(totalCount: payload.clinics.count) else { return nil }
        return payload.clinics[firstNewIndex].id
    }
}

struct ClinicNearbyView: View {
    @State private var model = ClinicNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?
    /// "더 보기" 후 첫 새 행으로 VO 커서 이동(웹 포커스 계약 미러).
    @AccessibilityFocusState private var focusedClinicID: String?
    @State private var lander = NearbyFocusLander()

    /// 첫 항목 ID. nil→값 전이가 곧 "로드 완료"다(0건·실패는 nil 유지, 이동 없음).
    private var firstRowID: String? {
        guard case .loaded(let payload) = model.phase else { return nil }
        return payload.clinics.first?.id
    }

    var body: some View {
        // ScrollViewReader+proxy.scrollTo 선행(ChatConversationView 전례 미러): List는
        // 화면 밖 행을 AX 트리에서 컬링하므로, "더 보기"로 공개된 첫 새 행이 화면
        // 밖이면 scrollTo 없이 바로 AccessibilityFocusState를 대입해도 조용히
        // 실패할 수 있다 — scrollTo로 먼저 가시화한 뒤에 포커스를 대입한다.
        ScrollViewReader { proxy in
            List {
                // 공휴일 기준으로 읽은 날·보완 실패만 밝힌다(조건부라 잡음 아님, 웹 미러).
                if case .loaded(let payload) = model.phase, !payload.clinics.isEmpty,
                   payload.summary.basis == "holiday" || payload.summary.supplementFailed {
                    Section {
                        if payload.summary.basis == "holiday" {
                            Text(appLocalized("clinicNearby.basisHoliday"))
                        }
                        if payload.summary.supplementFailed {
                            Text(appLocalized("clinicNearby.supplementFailedNotice"))
                        }
                    }
                }
                if case .loaded(let payload) = model.phase {
                    // 평면 1행=1객체(검색 탭 동형). 항목 heading·주소·전화 행은 상세로 이동
                    // — M2·M3 "평면 리스트 heading 잉여" 결정 동형. 실기기 VO 확인 게이트.
                    ForEach(payload.clinics.prefix(model.visibleCount)) { clinic in
                        NavigationLink {
                            PlaceDetailView(place: nightClinicToPlace(clinic)) {
                                ClinicDomainSection(clinic: clinic)
                            }
                        } label: {
                            PlaceRow(
                                place: nightClinicToPlace(clinic),
                                secondaryOverride: joinText(
                                    clinic.kind,
                                    clinicStatusText(clinic.openStatus),
                                    appLocalized("place.distance", formatDistance(clinic.distanceMeters))),
                                onAskAbout: { chatPlace = nightClinicToPlace(clinic) })
                        }
                        .id(clinic.id)
                        .accessibilityFocused($focusedClinicID, equals: clinic.id)
                    }
                    if payload.clinics.count > model.visibleCount {
                        Button(appLocalized("actions.showMore")) {
                            if let id = model.revealMore() {
                                proxy.scrollTo(id, anchor: .top)
                                DispatchQueue.main.async { focusedClinicID = id }
                            }
                        }
                    }
                }
            }
            .nearbyFocusOnLoad(
                id: firstRowID, lander: lander, proxy: proxy,
                current: { focusedClinicID },
                apply: { focusedClinicID = $0 })
        }
        .navigationTitle(appLocalized("ios.nearby.clinic"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.clinicEmpty"), systemImage: "cross.case"),
                isEmpty: { $0.clinics.isEmpty }))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }
}

/// 진료 상태 3-state 문장 — 목록 행 보조 텍스트와 상세 도메인 섹션이 공유.
/// open이면 종료시각까지, closed/unknown은 각각의 문장으로.
func clinicStatusText(_ status: NightClinic.OpenStatus) -> String {
    switch status.state {
    case "open":
        if let end = status.end {
            return joinText(appLocalized("clinicNearby.open"), clinicEndTimeText(end))
        }
        return appLocalized("clinicNearby.open")
    case "closed":
        return appLocalized("ios.nearby.clinicClosed")
    default:
        return appLocalized("ios.nearby.clinicUnknown")
    }
}

/// HHMM 정수를 "HH시 MM분까지"로. 2400은 자정을 뜻해 "자정까지".
private func clinicEndTimeText(_ hhmm: Int) -> String {
    if hhmm == 2400 { return appLocalized("ios.nearby.untilMidnight") }
    return appLocalized("ios.nearby.untilTime", String(hhmm / 100), String(hhmm % 100))
}

/// 소아 진료 도메인 섹션 — 장소 상세 최상단(진료 여부가 이 화면에 온 이유).
/// 전부 평문 단일 텍스트. 달빛 지정은 true일 때만(위원장 판정 2026-07-26: 목록 미표기·상세 조건부).
struct ClinicDomainSection: View {
    let clinic: NightClinic

    var body: some View {
        Section {
            Text(clinicStatusText(clinic.openStatus))
            if !clinic.directions.isEmpty {
                Text(appLocalized("clinicNearby.directions", clinic.directions))
            }
            if clinic.designated == true {
                Text(appLocalized("ios.clinic.designated"))
            }
        }
    }
}
