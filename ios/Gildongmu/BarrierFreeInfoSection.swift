import SwiftUI
import Observation
import GildongmuKit

/// 장소 상세의 무장애 편의시설 자동 섹션 모델. match는 비-throw(BarrierFreeService.swift
/// 계약) — 매칭 실패·네트워크 오류·시설 0건을 구분하지 않고 전부 nil로 수렴해 무음
/// 미노출한다(틀린 무장애 정보가 정보 없음보다 위험, 웹 BarrierFreeInfo.tsx 미러).
/// place 변경 대응은 별도 리셋 로직 없이 뷰 정체성(`.navigationDestination(for: Place.self)`가
/// 장소마다 새 뷰·새 모델 인스턴스를 만든다)으로 자연 해소된다.
@Observable @MainActor
final class BarrierFreeInfoModel {
    private(set) var detail: BarrierFreeDetail?
    private let service = BarrierFreeService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    func load(lat: Double, lng: Double, name: String) async {
        let result = await service.match(lat: lat, lng: lng, name: name)
        // 시설 0건도 노이즈이므로 숨김(웹과 동일 판정)
        detail = (result?.facilities.isEmpty == false) ? result : nil
    }
}

/// 무장애 편의시설 자동 섹션. 자동 등장 보조 정보라 로딩 표시·통지 없음(조용히 나타남),
/// Section 헤더의 heading이 유일한 발견 경로(접근성 헌장 §3, .isHeader 필수).
/// 로드 트리거는 PlaceDetailView의 .task.
struct BarrierFreeInfoSection: View {
    let model: BarrierFreeInfoModel

    var body: some View {
        if let detail = model.detail {
            Section {
                ForEach(detail.facilities, id: \.key) { facility in
                    // 한 줄=한 객체: 라벨+값 단일 텍스트(웹 미러, span 분절 금지).
                    // 라벨은 key→앱 언어(A26), 값은 서버 한국어 서술 원문.
                    Text("\(barrierFreeFacilityLabel(facility)) \(facility.value)")
                }
                Text(appLocalized("barrierFreeInfo.source"))
            } header: {
                Text(appLocalized("barrierFreeInfo.heading")).accessibilityAddTraits(.isHeader)
            }
        }
    }
}

/// 무장애 편의시설 라벨 — 응답 `key`를 `barrierFreeInfo.facility.*`로(A26, 웹 `barrierFreeLines` 미러).
/// 모르는 key는 서버 한글 라벨 폴백(빈 라벨보다 낫다). 키 린터(`check-xcstrings-keys.mjs`)가 리터럴만
/// 스캔하므로 `appLocalized(변수)`가 아니라 switch로 27종을 되받는다(`transitAlternativeName` 선례).
func barrierFreeFacilityLabel(_ facility: BarrierFreeFacility) -> String {
    switch facility.key {
    case "wheelchair": return appLocalized("barrierFreeInfo.facility.wheelchair")
    case "restroom": return appLocalized("barrierFreeInfo.facility.restroom")
    case "elevator": return appLocalized("barrierFreeInfo.facility.elevator")
    case "parking": return appLocalized("barrierFreeInfo.facility.parking")
    case "route": return appLocalized("barrierFreeInfo.facility.route")
    case "exit": return appLocalized("barrierFreeInfo.facility.exit")
    case "publictransport": return appLocalized("barrierFreeInfo.facility.publictransport")
    case "ticketoffice": return appLocalized("barrierFreeInfo.facility.ticketoffice")
    case "auditorium": return appLocalized("barrierFreeInfo.facility.auditorium")
    case "room": return appLocalized("barrierFreeInfo.facility.room")
    case "handicapetc": return appLocalized("barrierFreeInfo.facility.handicapetc")
    case "braileblock": return appLocalized("barrierFreeInfo.facility.braileblock")
    case "audioguide": return appLocalized("barrierFreeInfo.facility.audioguide")
    case "brailepromotion": return appLocalized("barrierFreeInfo.facility.brailepromotion")
    case "guidehuman": return appLocalized("barrierFreeInfo.facility.guidehuman")
    case "helpdog": return appLocalized("barrierFreeInfo.facility.helpdog")
    case "bigprint": return appLocalized("barrierFreeInfo.facility.bigprint")
    case "guidesystem": return appLocalized("barrierFreeInfo.facility.guidesystem")
    case "blindhandicapetc": return appLocalized("barrierFreeInfo.facility.blindhandicapetc")
    case "signguide": return appLocalized("barrierFreeInfo.facility.signguide")
    case "videoguide": return appLocalized("barrierFreeInfo.facility.videoguide")
    case "hearingroom": return appLocalized("barrierFreeInfo.facility.hearingroom")
    case "hearinghandicapetc": return appLocalized("barrierFreeInfo.facility.hearinghandicapetc")
    case "lactationroom": return appLocalized("barrierFreeInfo.facility.lactationroom")
    case "stroller": return appLocalized("barrierFreeInfo.facility.stroller")
    case "babysparechair": return appLocalized("barrierFreeInfo.facility.babysparechair")
    case "infantsfamilyetc": return appLocalized("barrierFreeInfo.facility.infantsfamilyetc")
    default: return facility.label
    }
}
