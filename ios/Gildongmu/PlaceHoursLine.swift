import SwiftUI
import Observation
import GildongmuKit

/// 장소 상세 영업시간 한 줄 모델(E24, 실험판 전용). 실패·부재·매칭 실패·쿼터 소진을 구분하지
/// 않고 nil = 줄 없음(침묵). 로드 트리거는 PlaceDetailView의 `.task`(실험판에서만 건다).
@Observable @MainActor
final class PlaceHoursModel {
    private(set) var hours: PlaceHoursToday?
    private let service = PlaceHoursService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(place: Place) async {
        hours = await service.today(lat: place.lat, lng: place.lng, name: place.name, roadAddress: place.roadAddress)
    }
}

/// 한 줄 = 한 객체. 시간표형만 쓰고 단정형("지금 영업 중")은 쓰지 않는다(위험 방향 9.1% —
/// E24 표기 규칙). "Google Maps"는 attribution 의무 표기라 번역·변형하지 않는다.
/// 로딩 표시·통지 없음(조용히 나타나는 보조 정보). 전화 링크 바로 앞에 놓는다 — 불확실한
/// 시각은 전화로 확인 가능한 자리에 있을 때만 정직하다.
struct PlaceHoursLine: View {
    let model: PlaceHoursModel

    var body: some View {
        if let hours = model.hours {
            Text(Self.lineText(hours))
        }
    }

    static func lineText(_ hours: PlaceHoursToday) -> String {
        if hours.allDay {
            return appLocalized("ios.placeHours.line", appLocalized("ios.placeHours.allDay"))
        }
        if hours.ranges.isEmpty {
            return appLocalized("ios.placeHours.closed")
        }
        let ranges = hours.ranges.map { r -> String in
            let close = r.closesNextDay ? appLocalized("ios.placeHours.nextDay", r.close) : r.close
            return "\(r.open)~\(close)"
        }.joined(separator: ", ")
        return appLocalized("ios.placeHours.line", ranges)
    }
}
