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
                    "\(meta.name)역", meta.nameEn, meta.lines.joined(separator: ", "),
                    meta.isTransfer ? "환승역" : nil, meta.operatorName))
            } header: {
                Text("역 정보").accessibilityAddTraits(.isHeader)
            }
        }

        if let arrivals = model.arrivals {
            Section {
                if arrivals.arrivals.isEmpty {
                    // fetch 성공의 0건은 문장으로 노출("조회 실패"와 뭉개지 않는 3-state)
                    Text("도착 예정 열차가 없습니다")
                } else {
                    ForEach(Array(arrivals.arrivals.enumerated()), id: \.offset) { _, arrival in
                        // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수(M2와 동일)
                        Text(joinText(arrival.line, arrival.express ? "급행" : nil, arrival.trainLineNm, arrival.message))
                    }
                }
            } header: {
                Text("실시간 도착").accessibilityAddTraits(.isHeader)
            }
        }

        if let facilities = model.korailFacilities {
            Section {
                Text(facilities.accessibleToilet ? "장애인 화장실 있음" : "장애인 화장실 없음")
                // 정수 3-state: nil="정보 없음" ≠ 0="없음" ≠ n="n대"
                Text(countText("휠체어 리프트", facilities.wheelchairLifts))
                Text(facilities.accessibleSlope ? "장애인 경사로 있음" : "장애인 경사로 없음")
                Text(countText("엘리베이터", facilities.elevators))
            } header: {
                Text("교통약자 시설(철도)").accessibilityAddTraits(.isHeader)
            }
        }

        if let facilities = model.metroFacilities {
            Section {
                ForEach(facilities.groups, id: \.kind) { group in
                    // kind 한국어 라벨은 웹 SeoulMetroFacilities.tsx 미러
                    Text("\(metroKindLabel(group.kind)) \(group.facilities.count)곳")
                    ForEach(Array(group.facilities.enumerated()), id: \.offset) { _, facility in
                        Text(joinText(
                            facility.name, facility.location, facility.floors,
                            operatingStatusText(facility.operatingStatus), facility.detail))
                    }
                }
            } header: {
                Text("교통약자 시설(서울 지하철)").accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// 시설 수 3-state 문장: nil="정보 없음" ≠ 0="없음" ≠ n="n대". 절대 뭉개지 않는다.
    private func countText(_ label: String, _ count: Int?) -> String {
        guard let count else { return "\(label) 정보 없음" }
        return count == 0 ? "\(label) 없음" : "\(label) \(count)대"
    }

    /// 가동현황 텍스트(엘리베이터·에스컬레이터만 존재, 그 외 nil은 생략)
    private func operatingStatusText(_ status: String?) -> String? {
        switch status {
        case "normal": "정상 가동"
        case "stopped": "운행 중지"
        default: nil
        }
    }

    /// 시설 종류 한국어 라벨(웹 messages/ko.json subway.kind 미러). 미지의 키는 원문 유지.
    private func metroKindLabel(_ kind: String) -> String {
        switch kind {
        case "elevator": "엘리베이터"
        case "escalator": "에스컬레이터"
        case "wheelchairLift": "휠체어 리프트"
        case "movingWalk": "무빙워크"
        case "wheelchairCharger": "전동휠체어 급속충전기"
        case "safetyPlatform": "안전발판"
        case "signLangPhone": "수어영상전화기"
        case "helper": "교통약자 도우미"
        case "restroom": "장애인 화장실"
        default: kind
        }
    }
}
