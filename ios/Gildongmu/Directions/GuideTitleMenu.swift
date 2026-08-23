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
///
/// 접기 버튼(N1 최소화)은 이 헤더 행의 우측 끝 작은 아이콘이다(위원장 판정 2026-08-23 —
/// 종전 toolbar 배치는 제목 없는 빈 내비게이션 바가 아이콘 하나를 들고 한 행을 차지해
/// 시각적으로 "제목이 빠진 화면"으로 보였다. 유튜브 플레이어의 제목 행 우측 아이콘 동형).
/// 시각 텍스트가 없는 아이콘이라 `accessibilityLabel`이 정당하고, 읽기 순서는 제목 → 접기.
struct GuideTitleMenu<Trailing: View>: View {
    let heading: String
    let label: String
    let onShowDetail: () -> Void
    let onChangeDestination: () -> Void
    /// 헤더 행 우측 끝(접기 아이콘). 도착 종료·핸드오프 화면은 비워 둔다.
    @ViewBuilder let trailing: () -> Trailing

    init(heading: String, label: String,
         onShowDetail: @escaping () -> Void, onChangeDestination: @escaping () -> Void,
         @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.heading = heading
        self.label = label
        self.onShowDetail = onShowDetail
        self.onChangeDestination = onChangeDestination
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Menu(joinText(heading, label)) {
                Button(appLocalized("ios.guide.destMenuDetail"), action: onShowDetail)
                Button(appLocalized("ios.guide.destMenuChange"), action: onChangeDestination)
            }
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            trailing()
        }
    }
}

/// 안내 시트 접기 아이콘(N1 최소화). 착지 바인딩은 호출부가 `.accessibilityFocused`로 단다
/// (도보는 Bool, 대중교통은 `SheetControl` 옵셔널이라 여기서 고정하지 않는다).
struct GuideMinimizeButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down.right.and.arrow.up.left")
                .font(.body)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(appLocalized("guide.minimize"))
    }
}
