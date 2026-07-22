import SwiftUI
import Observation
import GildongmuKit

/// 장소 상세의 역 자동 섹션 4종 모델. 4개 API를 async let으로 병렬 독립 로드,
/// 각각 실패·null이면 해당 섹션만 미노출(자동 등장 보조 정보의 graceful degrade, 웹 미러).
/// station 파라미터는 place.name 그대로(매칭은 서버 몫).
@Observable @MainActor
final class StationSectionsModel {
    private(set) var meta: StationMeta?
    private(set) var korailFacilities: StationFacilities?
    private(set) var metroFacilities: SeoulMetroFacilities?
    private(set) var arrivals: StationArrivals?
    private let service = StationService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(stationName: String) async {
        // 한 조각의 실패가 다른 조각을 안 죽인다. 실패는 null과 동일 처리(섹션 미노출)
        async let metaTask: StationMeta? = (try? service.meta(station: stationName)) ?? nil
        async let korailTask: StationFacilities? = (try? service.korailFacilities(station: stationName)) ?? nil
        async let metroTask: SeoulMetroFacilities? = (try? service.metroFacilities(station: stationName)) ?? nil
        async let arrivalsTask: StationArrivals? = (try? service.arrivals(station: stationName)) ?? nil
        meta = await metaTask
        korailFacilities = await korailTask
        metroFacilities = await metroTask
        arrivals = await arrivalsTask
    }
}

/// 역 자동 섹션 4종. 자동 등장 보조 정보라 로딩 표시·통지 없음(조용히 나타남),
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
                            facility.name, facility.location, facility.floors,
                            operatingStatusText(facility.operatingStatus), facility.detail))
                    }
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
}
