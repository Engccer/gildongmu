import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 문화행사 — NearbyLoadCore 껍데기(KidsNearbyModel 규범 패턴 미러).
/// 오늘 진행 중인 행사만 서버가 판정해 내려주므로 앱에서 날짜를 다시 해석하지 않는다.
@Observable @MainActor
final class EventsNearbyModel {
    private var core: NearbyLoadCore<[CultureEvent]>!   // willCommit이 self 캡처 — IUO 2단 초기화
    private(set) var window = RevealWindow()
    var phase: NearbyLoadPhase<[CultureEvent]> { core.phase }
    var visibleCount: Int { window.visibleCount }

    init() {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                return try await service.cultureEvents(lat: coord.lat, lng: coord.lng)
            },
            willCommit: { [weak self] _ in self?.window.reset() },   // 커밋과 원자
            onEvent: nearbyAnnouncer(loaded: { events in
                nearbyLoadedMessage(count: events.count, unit: appLocalized("ios.nearby.unitEvent"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// "더 보기": 공개 수를 늘리고 첫 새 항목 id를 반환한다(VO 포커스 이동 대상).
    func revealMore() -> String? {
        guard case .loaded(let events) = phase,
              let firstNewIndex = window.revealMore(totalCount: events.count) else { return nil }
        return events[firstNewIndex].id
    }
}

struct EventsNearbyView: View {
    @State private var model = EventsNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?
    /// "더 보기" 후 첫 새 행으로 VO 커서 이동(웹 포커스 계약 미러).
    @AccessibilityFocusState private var focusedEventID: String?
    @State private var lander = NearbyFocusLander()

    /// 첫 항목 ID. nil→값 전이가 곧 "로드 완료"다(0건·실패는 nil 유지, 이동 없음).
    private var firstRowID: String? {
        guard case .loaded(let events) = model.phase else { return nil }
        return events.first?.id
    }

    var body: some View {
        // ScrollViewReader+proxy.scrollTo 선행(ClinicNearbyView 미러): List는 화면 밖
        // 행을 AX 트리에서 컬링하므로 scrollTo로 먼저 가시화한 뒤에 포커스를 대입한다.
        ScrollViewReader { proxy in
            List {
                if case .loaded(let events) = model.phase {
                    ForEach(events.prefix(model.visibleCount)) { event in
                        NavigationLink {
                            PlaceDetailView(place: cultureEventToPlace(event)) {
                                CultureEventSection(event: event)
                            }
                        } label: {
                            // 목록 행은 "탭할지 말지"를 가르는 것만: 분류·요금·거리.
                            // 기간·시간·대상은 상세 도메인 섹션이 맡는다(행 과밀 방지).
                            PlaceRow(
                                place: cultureEventToPlace(event),
                                secondaryOverride: joinText(
                                    event.category,
                                    eventFeeText(event),
                                    appLocalized("place.distance", formatDistance(event.distanceMeters))),
                                onAskAbout: { chatPlace = cultureEventToPlace(event) })
                        }
                        .id(event.id)
                        .accessibilityFocused($focusedEventID, equals: event.id)
                    }
                    if events.count > model.visibleCount {
                        Button(appLocalized("actions.showMore")) {
                            if let id = model.revealMore() {
                                proxy.scrollTo(id, anchor: .top)
                                DispatchQueue.main.async { focusedEventID = id }
                            }
                        }
                    }
                }
            }
            .nearbyFocusOnLoad(
                id: firstRowID, lander: lander, proxy: proxy,
                landed: { focusedEventID == $0 },
                apply: { focusedEventID = $0 })
        }
        .navigationTitle(appLocalized("ios.nearby.events"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.eventsEmpty"), systemImage: "theatermasks"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }
}

/// 요금 문구 — 무료면 "무료"만(요금 원문 중복 낭독 금지), 유료면 원문을 붙인다.
/// 유료인데 요금 문구가 없는 행사는 실측 0건이지만, 있어도 꼬리 공백이 남지 않게 다듬는다.
func eventFeeText(_ e: CultureEvent) -> String {
    if e.isFree { return appLocalized("eventsNearby.free") }
    return appLocalized("eventsNearby.paid", e.fee ?? "")
        .trimmingCharacters(in: .whitespaces)
}

/// 문화행사 도메인 섹션 — 장소 상세 최상단(이 화면에 온 이유가 행사이므로).
/// 전부 평문 단일 텍스트. 값이 빈 필드는 줄 자체를 만들지 않는다(빈 낭독 금지).
struct CultureEventSection: View {
    let event: CultureEvent

    var body: some View {
        Section {
            // 개최 장소는 주소가 아니라 시설 설명이라 주소 슬롯이 아닌 여기서 밝힌다.
            let venue = joinText(event.place, event.district)
            if !venue.isEmpty { Text(venue) }
            // dateText는 원본 완성 표기(2026-06-04~2026-08-23) — 재조합 금지.
            let when = joinText(event.dateText, event.timeText)
            if !when.isEmpty { Text(when) }
            Text(eventFeeText(event))
            if !event.target.isEmpty {
                Text(appLocalized("eventsNearby.target", event.target))
            }
        }
    }
}
