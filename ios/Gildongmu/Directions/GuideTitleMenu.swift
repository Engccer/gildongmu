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
/// 행 배치(접기 아이콘 우측)는 `GuideTitleRow`가 맡는다 — 착지 바인딩을 호출부가 이 뷰에
/// 직접 달 수 있도록 메뉴와 행을 분리했다(도보는 Bool, 대중교통은 `SheetControl` 옵셔널).
struct GuideTitleMenu: View {
    let heading: String
    let label: String
    let onShowDetail: () -> Void
    /// nil이면 「목적지 바꾸기」 항목이 없다 — 여정(E70) 단계 세션은 목적지가 여정 계획의 일부라 바꾸지 않는다.
    let onChangeDestination: (() -> Void)?

    var body: some View {
        Menu(joinText(heading, label)) {
            Button(appLocalized("ios.guide.destMenuDetail"), action: onShowDetail)
            if let onChangeDestination {
                Button(appLocalized("ios.guide.destMenuChange"), action: onChangeDestination)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// 안내 시트 제목 행 — 실험판(E74, `AppConfig.experimentalGuideTitleActionsEnabled`)에서 `GuideTitleMenu` 헤더를
/// 대신하는 **섹션 첫 행**(spec 2026-10-19-e74-guide-title-actions §2). 밀기 버튼은 행에만 붙어 제목이 헤더에서 행으로
/// 내려왔다. 제목은 종전 메뉴 라벨과 같은 합친 한 줄 + 헤딩 trait(헤딩 로터 보존), 오른쪽 끝은 접기 아이콘(종전 배치).
/// VoiceOver 동작 목록은 iOS가 밀기 버튼에서 만든다 — 오른쪽 묶음이 먼저, 묶음 안은 선언 순이라 들리는 순서는
/// 다른 길로 가기 → 경유지 → 목적지 바꾸기 → 장소 상세 보기(판정 3). nil인 동작은 버튼이 없다.
/// 끝까지 밀기 실행은 두 묶음 다 끈다 — 넷 다 되돌릴 수 없다(판정 2).
struct GuideTitleActionsRow: View {
    let heading: String
    let label: String
    /// 「현재 경로와 다른 길로 가기」 — 도보·자동차 상세 안내 중에만(대중교통·간략·최종 접근은 nil).
    let onDifferentRoute: (() -> Void)?
    /// 경유지 추가/바꾸기 — 라벨이 곧 상태(「경유지 추가」 / 「{경유지}, 경유지 바꾸기」). 대중교통·비-ko는 nil.
    let waypoint: (label: String, action: () -> Void)?
    /// 경유지 삭제 — 미도착 경유지가 있을 때만.
    let onRemoveWaypoint: (() -> Void)?
    /// nil이면 「목적지 바꾸기」가 없다 — 여정(E70) 단계 세션(`GuideTitleMenu`와 같은 이유).
    let onChangeDestination: (() -> Void)?
    let onShowDetail: () -> Void
    let onMinimize: () -> Void

    var body: some View {
        // ⚠ 거는 순서는 왼쪽 밀기(안쪽) → 오른쪽 밀기(바깥) — `PlaceRowActions`와 같은 관측 조건.
        GuideTitleRow {
            Text(joinText(heading, label))
                .accessibilityAddTraits(.isHeader)
        } trailing: {
            GuideMinimizeButton(action: onMinimize)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if let onChangeDestination {
                Button(appLocalized("ios.guide.destMenuChange"), action: onChangeDestination)
            }
            Button(appLocalized("ios.guide.destMenuDetail"), action: onShowDetail)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if let onDifferentRoute {
                Button(appLocalized("ios.guide.differentRoute"), action: onDifferentRoute)
            }
            if let waypoint {
                Button(waypoint.label, action: waypoint.action)
            }
            if let onRemoveWaypoint {
                Button(appLocalized("ios.guide.waypointRemove"), action: onRemoveWaypoint)
            }
        }
    }
}

/// 안내 시트 섹션 헤더 행: 제목 메뉴(좌) + 접기 아이콘(우, 선택). 접기 버튼은 이 행의 우측
/// 끝 작은 아이콘이다(위원장 판정 2026-08-23 — 종전 toolbar 배치는 제목 없는 빈 내비게이션
/// 바가 아이콘 하나를 들고 한 행을 차지해 "제목이 빠진 화면"으로 보였다. 유튜브 플레이어의
/// 제목 행 우측 아이콘 동형). 읽기 순서는 제목 → 접기. 도착 종료·핸드오프 화면은 trailing을 비운다.
struct GuideTitleRow<Title: View, Trailing: View>: View {
    @ViewBuilder let title: () -> Title
    @ViewBuilder let trailing: () -> Trailing

    init(@ViewBuilder title: @escaping () -> Title,
         @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            title()
            Spacer(minLength: 8)
            trailing()
        }
    }
}

/// 안내 시트 접기 아이콘(N1 최소화). 착지 대상이 아니다 — 띠바 복귀도 첫 정보 행에 앉는다(E57 위원장 판정 Q1).
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

/// 안내 종료 버튼 — 목록 밖 **화면 최하단 고정**(위원장 판정 2026-08-23). 상단 섹션의 버튼
/// 행(경유지·진행 상황·주변 확인·재조회)이 늘면서 목록 2번째 행의 종료를 VoiceOver로
/// 되찾는 비용이 커졌다. 목록 밖 마지막 객체로 두면 내용 행 수와 무관하게 위치가 고정되고
/// 네 손가락 한 번 탭(화면 아래쪽)이 곧 지름길이다. 목록 마지막 행으로 넣지 말 것 — 행 수가
/// 상황마다 달라 위치가 흔들리고 그 지름길이 성립하지 않는다. 호출부는 `List`에
/// `.safeAreaInset(edge: .bottom)`으로 붙이고 착지 바인딩을 단다.
struct GuideStopButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(appLocalized("beacon.stop"))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.bar, ignoresSafeAreaEdges: [])
    }
}
