import GildongmuKit
import SwiftUI

/// 안내 시트 추적 섹션 헤더의 제목 메뉴(스펙 2026-08-12 §1). 라벨은 종전 헤더와 같은
/// 합친 한 줄이라 VoiceOver가 "수단 안내, 목적지, 팝업 버튼"으로 낭독하고, 헤딩
/// trait를 유지해 헤딩 로터 항행을 보존한다(GildongmuTitleMenu 선례의 시트 판).
/// 실기기 판정 대상: 헤딩+팝업 버튼 조합 낭독이 어색하면 폴백 — 헤더는 텍스트 유지
/// + 섹션 첫 행 메뉴 버튼(스펙 §8 ①).
///
/// 도착 종료·핸드오프 화면의 헤더에는 붙이지 않는다 — 세션이 끝난 화면이라
/// "목적지 바꾸기"가 성립하지 않는다(스펙 §1).
struct GuideTitleMenu: View {
    let heading: String
    let label: String
    let onShowDetail: () -> Void
    let onChangeDestination: () -> Void

    var body: some View {
        Menu(joinText(heading, label)) {
            Button(appLocalized("ios.guide.destMenuDetail"), action: onShowDetail)
            Button(appLocalized("ios.guide.destMenuChange"), action: onChangeDestination)
        }
        .accessibilityAddTraits(.isHeader)
    }
}
