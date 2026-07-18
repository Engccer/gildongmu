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
                    // 한 줄=한 객체: 라벨+값 단일 텍스트(웹 미러, span 분절 금지)
                    Text("\(facility.label) \(facility.value)")
                }
                Text(appLocalized("barrierFreeInfo.source"))
            } header: {
                Text(appLocalized("barrierFreeInfo.heading")).accessibilityAddTraits(.isHeader)
            }
        }
    }
}
