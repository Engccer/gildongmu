import SwiftUI
import Observation
import GildongmuKit

/// 최근접 역 낭독 라벨 — 역명(현재 언어)과 노선을 한 텍스트로 합친다.
/// 모델 init의 통지 클로저와 뷰 오버레이가 **같은 문구**를 써야 해서 파일 레벨에 둔다
/// (한쪽만 고치면 들은 것과 보이는 것이 갈린다).
private func nearestLabel(_ station: NearestSubwayStation) -> String {
    // 역명·노선이 **둘 다** 영문일 때만 영어(한 줄 안 언어 혼합 금지, E27) — 통지라 병기 없이 낭독 문자열.
    subwayStationLine(isEn: AppLanguage.dataLocale == "en", stationName: station.stationName, nameEn: station.nameEn,
                      lines: station.lines, linesEn: station.linesEn).spoken
}

/// 역 헤딩 조각 — 시각(`Gangnam (강남), Line 2`)과 낭독(`Gangnam, Line 2`). 영문이 모자라면 둘 다 한국어.
func subwayStationLine(
    isEn: Bool, stationName: String, nameEn: String?, lines: [String], linesEn: [String]?
) -> (visual: String, spoken: String) {
    let ko = joinText(stationName, lines.isEmpty ? nil : lines.joined(separator: ", "))
    let linesReady: [String]? = lines.isEmpty ? [] : linesEn
    guard isEn, let nameEn, !nameEn.isEmpty, let linesReady else { return (ko, ko) }
    // 병기 정본은 E28 `bilingualName`(시각 `display`, 낭독 `primary`) — roman은 seed 영문이 있어 nil.
    let b = bilingualName(lang: AppLanguage.current, ko: stationName, en: nameEn, roman: nil)
    let linesText = linesReady.isEmpty ? nil : linesReady.joined(separator: ", ")
    return (joinText(b.display, linesText), joinText(b.primary, linesText))
}

/// 도착 문장 조각 → 카탈로그 문구. 키 선택은 Kit `subwayArrivalProseSegments`(공유 fixture가 웹과 잠근다)이고
/// 여기서는 **리터럴 `switch`로 조회만** 한다 — 키를 보간으로 조립하면 누락 린터가 못 본다
/// (`TransitWalkLegText`·`TransitGuideTextRenderer` 선례).
private func subwayArrivalSegmentText(_ segment: SubwayArrivalSegment) -> String {
    let args = segment.args
    switch segment.key {
    case "approaching": return appLocalized("subwayArrival.approaching", arguments: args)
    case "arrived": return appLocalized("subwayArrival.arrived", arguments: args)
    case "departed": return appLocalized("subwayArrival.departed", arguments: args)
    case "prevApproaching": return appLocalized("subwayArrival.prevApproaching", arguments: args)
    case "prevArrived": return appLocalized("subwayArrival.prevArrived", arguments: args)
    case "prevDeparted": return appLocalized("subwayArrival.prevDeparted", arguments: args)
    case "departedStopsBack": return appLocalized("subwayArrival.departedStopsBack", arguments: args)
    case "stopsAway": return appLocalized("subwayArrival.stopsAway", arguments: args)
    case "stopsJoin": return appLocalized("subwayArrival.stopsJoin", arguments: args)
    case "etaMin": return appLocalized("subwayArrival.etaMin", arguments: args)
    case "etaMinSec": return appLocalized("subwayArrival.etaMinSec", arguments: args)
    case "etaSec": return appLocalized("subwayArrival.etaSec", arguments: args)
    case "nowAt": return appLocalized("subwayArrival.nowAt", arguments: args)
    default:
        // Kit이 키를 늘렸는데 여기 case가 빠진 것 — 문자열 switch라 컴파일러가 못 잡으므로
        // 디버그에서 즉시 드러내고, 릴리스는 키를 그대로 노출해 침묵을 피한다(선례와 동일).
        // ⚠ 빈 문자열을 돌려주면 릴리스에서만 그 줄이 통째로 사라져 3-state가 무너진다.
        assertionFailure("subwayArrivalProseSegments 키 미매핑: \(segment.key)")
        return segment.key
    }
}

/// 계획 → 메시지 문장(한 접근성 객체 안의 한 조각). `joined`는 쉼표로, `tail`은 공백으로 잇는다.
private func subwayArrivalProseText(_ plan: SubwayArrivalPlan, station: String?) -> String {
    let segs = subwayArrivalProseSegments(plan, station: station)
    let body = segs.joined.map(subwayArrivalSegmentText).joined(separator: ", ")
    guard let tail = segs.tail else { return body }
    return "\(body) \(subwayArrivalSegmentText(tail))"
}

/// 도착 한 건 = `Text` 하나 = 접근성 객체 하나. iOS는 웹(두 `div`)과 달리 편성·메시지가 한 객체라 원자 단위도
/// 한 건 전체다 — 서버 영문(E27) 조각이 **전부** 있을 때만 영어이고, 하나라도 없으면 한 건 전체가 한국어
/// (spec 리뷰 검출: 부분 영문이 한 객체 안에 두 언어를 세웠다).
///
/// 메시지 자리는 완성 문장을 읽어 쓴 **우리 문장**(E37)이고, 알아보지 못한 문장만 원문 + A32 꼬리로 간다.
func subwayArrivalLine(_ arrival: SubwayArrival, isEn: Bool) -> String {
    let express = arrival.express ? appLocalized("subwayArrival.express") : nil
    // 웹과 같은 편성 순서: 노선 상·하행, 급행, 행선. 노선·방향이 비어도 joinText 정책을 유지한다.
    let lineAndDirection = arrival.line.map { joinText($0, arrival.direction) } ?? arrival.direction
    // 노선 미매핑(`line` nil)은 ko도 그 조각이 없으므로 영문 요구 대상이 아니다("" 자리 표시).
    let headEnParts: [String?] = [
        arrival.line == nil ? "" : arrival.lineEn,
        arrival.directionEn,
        arrival.trainLineNmEn,
    ]

    // ── 문장형(E37). 편성 조각과 역명이 그 줄의 언어로 다 갖춰졌을 때만 — 하나라도 모자라면 원문 경로로
    // 떨어진다. 문장 틀은 앱 선택 언어 하나뿐이라 "이 줄만 한국어"를 만들 수단이 없기 때문이다(E27 원자성).
    if let plan = subwayArrivalProse(message: arrival.message, currentLocation: arrival.currentLocation) {
        let koStation = subwayArrivalPlanStation(plan)
        let station = isEn ? arrival.currentLocationEn : koStation
        let headReady = !isEn || headEnParts.allSatisfy { $0 != nil }
        if headReady, koStation == nil || station != nil {
            let prose = subwayArrivalProseText(plan, station: station)
            return TransitDisplay.pickLine(
                isEn: isEn, ko: joinText(lineAndDirection, express, arrival.trainLineNm, prose),
                enParts: headEnParts
            ) { p in
                joinText("\(p[0].isEmpty ? "" : "\(p[0]) ")\(p[1])", express, p[2], prose)
            }
        }
    }

    // ── 원문 경로. 현재역 꼬리는 완성 문장이 그 역을 이미 담고 있으면 뗀다(A32) — 판정은 그 줄에 실제로 쓰는
    // 값으로 한다(ko는 원문, en은 영문). ⚠ `enLoc`은 아래 `enParts`에 넘기는 바로 그 값이다.
    // A38: 영문 자리의 결측은 **영문 값 자신**으로 가른다 — 있으면 그 값, 없고 ko도 없으면 자리 표시 `""`,
    // 없는데 ko는 있으면 결측(줄 전체 ko). 종전엔 ko 칸이 비었다는 이유로 영문 현재역을 버렸다.
    let enLoc: String? = arrival.currentLocationEn ?? (arrival.currentLocation == nil ? "" : nil)
    let koTail = subwayShowsCurrentLocationTail(message: arrival.message, currentLocation: arrival.currentLocation)
    let enTail = subwayShowsCurrentLocationTail(message: arrival.messageEn, currentLocation: enLoc)
    let ko = joinText(
        lineAndDirection, express, arrival.trainLineNm, arrival.message,
        koTail ? arrival.currentLocation.map { appLocalized("subwayArrival.currentLocation", $0) } : nil)
    return TransitDisplay.pickLine(
        isEn: isEn, ko: ko,
        enParts: headEnParts + [arrival.messageEn, enLoc]
    ) { p in
        joinText(
            "\(p[0].isEmpty ? "" : "\(p[0]) ")\(p[1])", express, p[2], p[3],
            enTail ? appLocalized("subwayArrival.currentLocation", p[4]) : nil)
    }
}

/// 내 주변 지하철 도착 — NearbyLoadCore 껍데기(규범 원형). 상태 머신·전이표는 Kit 정본.
/// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
@Observable @MainActor
final class SubwayNearbyModel {
    private let core: NearbyLoadCore<SubwayNearbyResult>
    var phase: NearbyLoadPhase<SubwayNearbyResult> { core.phase }

    init(anchor: PlaceAnchor? = nil) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                return try await service.subwayArrivals(lat: coord.lat, lng: coord.lng, lang: AppLanguage.dataLocale)
            },
            onEvent: nearbyAnnouncer(loaded: { result in
                // 0건이면 최근접 역 거리를 통지에 실어 "1km 안에 없다"와 "이 지역엔
                // 도시철도가 없다"를 가른다(웹 emptyNearest 미러).
                if result.stations.isEmpty, let nearest = result.nearest {
                    return NearbyLoadedNotice(
                        message: appLocalized("ios.nearby.subwayEmptyNearest",
                                              nearestLabel(nearest), formatDistance(nearest.distanceMeters)),
                        haptic: .attention)
                }
                return nearbyLoadedNotice(count: result.stations.count, kind: .stations)
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct SubwayNearbyView: View {
    private let anchor: PlaceAnchor?
    @State private var model: SubwayNearbyModel
    /// 항목 정체성 옵셔널 바인딩 — `Bool`을 여러 행에 붙이면 첫 행 외 전부가
    /// `false`가 되어 초기 상태에서 나머지 행이 포커스를 주장한다(실기기 확정).
    @AccessibilityFocusState private var focusedStation: String?
    @State private var lander = NearbyFocusLander()

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    /// State(initialValue:) 인자는 순수 생성만(부수효과 금지) — [[swiftui-state-initialvalue-side-effect]]
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: SubwayNearbyModel(anchor: anchor))
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if case .loaded(let result) = model.phase {
                    // 역명이 정체성이자 포커스 키다. 근접역 조회가 `dedupeByName`으로
                    // 같은 이름을 하나만 남기므로(`subway-nearby.ts`) 이 목록 안에서는
                    // 중복이 생기지 않는다 — 버스가 nodeId를 쓰는 것과 조건이 다르다.
                    ForEach(result.stations, id: \.stationName) { station in
                        Section {
                            // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수. en은 시각 병기
                            // `Gangnam (강남)` + 낭독 영문만(E27 §3.6, 위원장 판정 4).
                            stationHeading(station)
                                .accessibilityAddTraits(.isHeader)
                                // 첫 로드 착지 대상. 키는 ForEach 정체성과 같은 값이어야 한다.
                                .accessibilityFocused($focusedStation, equals: station.stationName)
                            // 4-state를 뭉개지 않는다(웹 미러): 조회 실패 / 운행 시간 밖 /
                            // 실시간 미제공 / 정상. closed인데 첫차가 없으면 판정 근거가
                            // 반쪽이라 "운행이 끝났다"고 말하지 않고 미제공으로 물러선다.
                            if station.arrivalStatus == "unavailable" {
                                Text(appLocalized("ios.nearby.arrivalUnavailable"))   // 조회 실패 ≠ 열차 없음
                            } else if station.arrivalStatus == "closed", let first = station.firstTime {
                                Text(appLocalized("ios.nearby.subwayClosed", first))
                            } else if station.arrivalStatus == "closed" || station.arrivalStatus == "unknown" {
                                Text(appLocalized("ios.nearby.subwayNoRealtime"))
                            } else if station.arrivals.isEmpty {
                                Text(appLocalized("ios.station.noArrivals"))
                            } else {
                                ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                    // ko는 완성 문장 정본 message 그대로(급행은 텍스트로 흡수), en은 서버 영문(E27).
                                    Text(subwayArrivalLine(arrival, isEn: AppLanguage.dataLocale == "en"))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(nearbyTitle(appLocalized("ios.nearby.subway"), anchor: anchor))
            .nearbyStateOverlay {
                NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                    empty: NearbyOverlayCopy(emptyTitle, systemImage: "tram"),
                    isEmpty: { $0.stations.isEmpty }))
            }
            .task { await model.load() }
            .nearbyRefreshable { await model.load(force: true) }
            .nearbyFocusOnLoad(
                id: firstStationName, lander: lander, proxy: proxy,
                current: { focusedStation },
                apply: { focusedStation = $0 })
        }
    }

    /// 첫 역명 — nil→값 전이가 곧 "로드 완료"다(0건·실패는 nil로 남는다).
    private var firstStationName: String? {
        guard case .loaded(let result) = model.phase else { return nil }
        return result.stations.first?.stationName
    }

    /// 0건 오버레이 제목 — 최근접 역이 있으면 거리를 함께 알린다(통지와 같은 문구).
    private var emptyTitle: String {
        guard case .loaded(let result) = model.phase, let nearest = result.nearest else {
            return appLocalized("ios.nearby.subwayEmpty")
        }
        return appLocalized("ios.nearby.subwayEmptyNearest",
                            nearestLabel(nearest), formatDistance(nearest.distanceMeters))
    }

    /// 역 헤딩 — 역명·노선(현재 언어, 한 줄 한 객체)에 거리. en은 시각 `Gangnam (강남)` 병기, 낭독은 영문만(E27).
    private func stationHeading(_ station: NearbySubwayStation) -> some View {
        let line = subwayStationLine(
            isEn: AppLanguage.dataLocale == "en", stationName: station.stationName, nameEn: station.nameEn,
            lines: station.lines, linesEn: station.linesEn)
        let distance = formatDistance(station.distanceMeters)
        return Text(joinText(line.visual, distance))
            .accessibilityLabel(Text(spokenUnits(joinText(line.spoken, distance))))
    }
}
