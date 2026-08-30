import SwiftUI
import Observation
import GildongmuKit

/// 첫차·막차 시간표 상태. 웹과 달리 조회 실패를 null(미커버)로 뭉개지 않는다
/// (스펙 §2-D: 시간표는 의사결정 정보라 "원래 없음"과 "고장"을 구분해야 한다).
enum TimetableState {
    case hidden // 미커버(null): 섹션 미노출
    case error // 조회 실패: 숨기지 않고 문장 노출(3-state)
    case done(StationTimetable)
}

/// 장소 상세의 역 자동 섹션 5종 모델. 5개 API를 async let으로 병렬 독립 로드,
/// 각각 실패·null이면 해당 섹션만 미노출(자동 등장 보조 정보의 graceful degrade, 웹 미러).
/// 단 시간표는 3-state 유지(위 TimetableState 주석 참고).
/// station 파라미터는 place.name 그대로(매칭은 서버 몫).
@Observable @MainActor
final class StationSectionsModel {
    private(set) var meta: StationMeta?
    private(set) var korailFacilities: StationFacilities?
    private(set) var metroFacilities: SeoulMetroFacilities?
    private(set) var arrivals: StationArrivals?
    private(set) var timetable: TimetableState = .hidden
    private let service = StationService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(stationName: String) async {
        // 한 조각의 실패가 다른 조각을 안 죽인다. 기존 4종은 실패=null과 동일 처리(섹션 미노출),
        // 시간표만 실패를 error로 구분해 보존한다(무운행 위장 금지).
        async let metaTask: StationMeta? = (try? service.meta(station: stationName)) ?? nil
        async let korailTask: StationFacilities? = (try? service.korailFacilities(station: stationName)) ?? nil
        async let metroTask: SeoulMetroFacilities? = (try? service.metroFacilities(station: stationName)) ?? nil
        async let arrivalsTask: StationArrivals? = (try? service.arrivals(station: stationName)) ?? nil
        async let timetableTask: TimetableState = loadTimetable(stationName: stationName)
        meta = await metaTask
        korailFacilities = await korailTask
        metroFacilities = await metroTask
        arrivals = await arrivalsTask
        timetable = await timetableTask
    }

    private func loadTimetable(stationName: String) async -> TimetableState {
        do {
            let result = try await service.timetable(station: stationName)
            return result.map(TimetableState.done) ?? .hidden
        } catch {
            return .error
        }
    }
}

/// 역 자동 섹션 5종. 자동 등장 보조 정보라 로딩 표시·통지 없음(조용히 나타남),
/// 각 섹션 헤더의 heading이 유일한 발견 경로(접근성 헌장 §3, .isHeader 필수).
/// 로드 트리거는 PlaceDetailView의 .task(조건부 섹션만 있는 초기 상태의 뷰에는
/// task를 붙일 자식이 없어 뷰 바깥에서 킥오프).
struct StationSectionsView: View {
    let model: StationSectionsModel

    var body: some View {
        if let meta = model.meta {
            Section {
                // 한 줄=한 객체: 역명·영문명·노선·환승·운영기관을 단일 텍스트로
                Text(joinText(
                    appLocalized("ios.station.nameSuffixed", meta.name), meta.nameEn, meta.lines.joined(separator: ", "),
                    meta.isTransfer ? appLocalized("stationMeta.transfer") : nil, meta.operatorName))
            } header: {
                Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)
            }
        }

        if let arrivals = model.arrivals {
            Section {
                if arrivals.arrivals.isEmpty {
                    // fetch 성공의 0건은 문장으로 노출("조회 실패"와 뭉개지 않는 3-state)
                    Text(appLocalized("ios.station.noArrivals"))
                } else {
                    ForEach(Array(arrivals.arrivals.enumerated()), id: \.offset) { _, arrival in
                        // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수(M2와 동일)
                        Text(joinText(arrival.line, arrival.express ? appLocalized("subwayArrival.express") : nil, arrival.trainLineNm, arrival.message))
                    }
                }
            } header: {
                Text(appLocalized("ios.station.arrivalHeading")).accessibilityAddTraits(.isHeader)
            }
        }

        // 첫차·막차: 웹 배선 순서 미러(meta→arrivals→timetable→facilities). 단 3-state 유지
        // (미커버만 미노출, 실패는 문장 노출. 위 TimetableState 주석 참고).
        switch model.timetable {
        case .hidden:
            EmptyView()
        case .error:
            Section {
                Text(appLocalized("timetable.error"))
            } header: {
                Text(appLocalized("timetable.heading")).accessibilityAddTraits(.isHeader)
            }
        case .done(let timetable):
            Section {
                Text(joinText(
                    dailyTypeLabel(timetable.dailyType),
                    timetable.partial == true ? appLocalized("timetable.partial") : nil))
                // 매칭된 노선은 전부 온다(A19). ok만 방향 행이고 나머지는 왜 없는지를 노선명과 함께
                // 한 줄로 — "확인 불가"·"편성 없음"·"조회 실패"가 같은 문장이면 SR 사용자가 못 가른다.
                ForEach(timetable.lines, id: \.lineName) { line in
                    if let text = coverageText(line) {
                        Text(text)
                    } else {
                        ForEach(line.directions, id: \.direction) { direction in
                            // 한 줄=한 객체: 노선·방향·첫차·막차를 단일 텍스트로(웹 StationTimetable.tsx 미러)
                            Text(joinText(
                                "\(lineDisplayName(line)) \(directionLabel(direction.direction))",
                                "\(appLocalized("timetable.first")) \(trainText(direction.first))",
                                "\(appLocalized("timetable.last")) \(trainText(direction.last))"))
                        }
                    }
                }
            } header: {
                Text(appLocalized("timetable.heading")).accessibilityAddTraits(.isHeader)
            }
        }

        if let facilities = model.korailFacilities {
            Section {
                Text(facilities.accessibleToilet ? appLocalized("ios.station.accessibleToiletYes") : appLocalized("ios.station.accessibleToiletNo"))
                // 정수 3-state: nil="정보 없음" ≠ 0="없음" ≠ n="n대"
                Text(countText(appLocalized("station.wheelchairLifts"), facilities.wheelchairLifts))
                Text(facilities.accessibleSlope ? appLocalized("ios.station.accessibleSlopeYes") : appLocalized("ios.station.accessibleSlopeNo"))
                Text(countText(appLocalized("station.elevators"), facilities.elevators))
            } header: {
                Text(appLocalized("ios.station.railFacilities")).accessibilityAddTraits(.isHeader)
            }
        }

        if let facilities = model.metroFacilities {
            Section {
                ForEach(facilities.groups, id: \.kind) { group in
                    // kind 한국어 라벨은 웹 SeoulMetroFacilities.tsx 미러
                    Text(appLocalized("ios.station.kindCount", metroKindLabel(group.kind), String(group.facilities.count)))
                    ForEach(Array(group.facilities.enumerated()), id: \.offset) { _, facility in
                        Text(joinText(
                            facilityName(facility), facility.location, facility.floors,
                            operatingStatusText(facility.operatingStatus), facilityDetail(facility)))
                    }
                }
                // 보강 소스(OA-21212) 실패는 은폐하지 않고 문장으로 병기(스펙 §2-C)
                if facilities.supplementFailed == true {
                    Text(appLocalized("subway.supplementFailed"))
                }
                // 음성유도기 데이터 기준일 고지(정적 seed, 웹 미러)
                if facilities.groups.contains(where: { $0.kind == "voiceGuide" }) {
                    Text(appLocalized("subway.voiceGuideSource"))
                }
            } header: {
                Text(appLocalized("ios.station.seoulFacilities")).accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// 시설 수 3-state 문장: nil="정보 없음" ≠ 0="없음" ≠ n="n대". 절대 뭉개지 않는다.
    private func countText(_ label: String, _ count: Int?) -> String {
        guard let count else { return appLocalized("ios.station.countUnknown", label) }
        return count == 0
            ? appLocalized("ios.station.countNone", label)
            : appLocalized("ios.station.countSome", label, String(count))
    }

    /// 가동현황 텍스트(엘리베이터·에스컬레이터만 존재, 그 외 nil은 생략)
    private func operatingStatusText(_ status: String?) -> String? {
        switch status {
        case "normal": appLocalized("ios.station.operatingNormal")
        case "stopped": appLocalized("ios.station.operatingStopped")
        default: nil
        }
    }

    /// 시설 종류 한국어 라벨(웹 messages/ko.json subway.kind 미러). 미지의 키는 원문 유지.
    private func metroKindLabel(_ kind: String) -> String {
        switch kind {
        case "elevator": appLocalized("subway.kind.elevator")
        case "escalator": appLocalized("subway.kind.escalator")
        case "wheelchairLift": appLocalized("subway.kind.wheelchairLift")
        case "movingWalk": appLocalized("subway.kind.movingWalk")
        case "wheelchairCharger": appLocalized("subway.kind.wheelchairCharger")
        case "safetyPlatform": appLocalized("subway.kind.safetyPlatform")
        case "signLangPhone": appLocalized("subway.kind.signLangPhone")
        case "helper": appLocalized("subway.kind.helper")
        case "restroom": appLocalized("subway.kind.restroom")
        case "voiceGuide": appLocalized("subway.kind.voiceGuide")
        case "elevatorLocation": appLocalized("subway.kind.elevatorLocation")
        default: kind
        }
    }

    /// 서비스데이 타입 기준 라벨(웹 messages timetable.dailyType 미러). 미지의 값은 원문 유지.
    private func dailyTypeLabel(_ dailyType: String) -> String {
        switch dailyType {
        case "weekday": appLocalized("timetable.dailyType.weekday")
        case "saturday": appLocalized("timetable.dailyType.saturday")
        case "sunday": appLocalized("timetable.dailyType.sunday")
        default: dailyType
        }
    }

    /// 진행 방향 라벨(웹 timetable.direction 미러). 미지의 값은 원문 유지.
    private func directionLabel(_ direction: String) -> String {
        switch direction {
        case "up": appLocalized("timetable.direction.up")
        case "down": appLocalized("timetable.direction.down")
        default: direction
        }
    }

    /// 첫차·막차 한 편성의 표시 텍스트("00:42 왕십리행"·익일 접두·en 종착지 폴백).
    /// 웹 StationTimetable.tsx의 train() 함수를 그대로 미러.
    /// 방향 행 대신 낼 coverage 문구. nil이면 방향 행을 그린다(coverage "ok").
    /// 구서버(coverage 없음)는 directions 빈 노선을 보내지 않지만, 혹시 그 조합이 오면
    /// 가장 덜 단정적인 "확인 불가"로 떨어뜨린다(운행 없음으로 읽히지 않게). 미지의 값도 같다.
    /// 서버가 "선"을 덧붙인 노선(lineCore)은 접미를 앱 언어로 단다(A26, 웹 `timetableLineItems` 미러).
    /// 노선명 자체는 원문 — 영문화는 E27 소관.
    private func lineDisplayName(_ line: TimetableLine) -> String {
        line.lineCore.map { appLocalized("timetable.lineSuffixed", $0) } ?? line.lineName
    }

    /// 서버 합성 한국어(`name`) 대신 구조화 조각(`parts`, A26)이 있으면 앱 언어로 조립한다
    /// (웹 `metroFacilityGroups.nameOf` 미러). 부재면 문자열 그대로.
    private func facilityName(_ f: SeoulMetroFacility) -> String {
        if let p = f.parts, let compass = p.compass, let meters = p.meters, let direction = compassLabel(compass) {
            return joinText(
                appLocalized("subway.elevatorAt", direction, formatDistance(meters)),
                p.dong)
        }
        if let p = f.parts, let location = p.location {
            return joinText(location, p.line.map { appLocalized("subway.lineNumber", $0) })
        }
        return f.name
    }

    private func facilityDetail(_ f: SeoulMetroFacility) -> String? {
        if let p = f.parts, p.restroomType != nil || p.wheelchairAccessible == true {
            return joinText(
                p.restroomType,
                p.wheelchairAccessible == true ? appLocalized("subway.wheelchairAccessible") : nil)
        }
        return f.detail
    }

    /// 8방위 코드 → 앱 언어 낱말. 키 린터가 리터럴만 스캔하므로 switch로 되받는다.
    /// 모르는 코드는 nil — 호출부가 서버 문장(`name`)으로 폴백한다(틀린 방위를 읽는 것보다 낫다).
    private func compassLabel(_ code: String) -> String? {
        switch code {
        case "n": return appLocalized("subway.direction.n")
        case "ne": return appLocalized("subway.direction.ne")
        case "e": return appLocalized("subway.direction.e")
        case "se": return appLocalized("subway.direction.se")
        case "s": return appLocalized("subway.direction.s")
        case "sw": return appLocalized("subway.direction.sw")
        case "w": return appLocalized("subway.direction.w")
        case "nw": return appLocalized("subway.direction.nw")
        default: return nil
        }
    }

    private func coverageText(_ line: TimetableLine) -> String? {
        let coverage = line.coverage ?? (line.directions.isEmpty ? "unknown" : "ok")
        switch coverage {
        case "ok": return nil
        case "noTrains": return appLocalized("timetable.coverage.noTrains", lineDisplayName(line))
        case "unavailable": return appLocalized("timetable.coverage.unavailable", lineDisplayName(line))
        default: return appLocalized("timetable.coverage.unknown", lineDisplayName(line))
        }
    }

    private func trainText(_ train: TimetableTrain) -> String {
        let time = train.nextDay == true
            ? "\(appLocalized("timetable.nextDay")) \(train.time)"
            : train.time
        let isEn = AppLanguage.current != "ko"
        let terminus = (isEn && train.terminusEn != nil) ? train.terminusEn! : train.terminus
        return "\(time) \(appLocalized("timetable.toTerminus", terminus))"
    }
}
