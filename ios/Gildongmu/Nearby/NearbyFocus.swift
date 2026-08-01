import SwiftUI

/// "내 주변" 화면 진입 시 로드가 끝나면 첫 결과로 VO 커서를 착지시키는 공유 계층.
///
/// **왜 한 줄 대입으로 안 되는가**(실기기 확정 2026-08-02, `SearchView`·
/// `DirectionsEndpointSearchView` 선례): `List`의 오프스크린 행은 AX 트리에서
/// 컬링되고, 대상이 트리에 없으면 SwiftUI가 포커스 대입을 조용히 되돌린다.
/// 증상이 두 갈래로 갈려(화면 밖이면 무이동, 걸치면 엉뚱한 행 착지) 원인이
/// 보이지 않으므로 정본 순서를 그대로 따른다:
/// **가시화 → 지연 → 대입 → 되돌림 검증 → 1회 재시도.**
///
/// **통지 완료를 기다리지 않는다**(위원장 판정 2026-08-02, 커밋 88b6a65). 포커스
/// 이동이 진행 중인 VO 발화를 가로채 결과 통지가 잘리지만, 안내가 온전히 들리는
/// 것보다 즉시 목록에 닿는 편이 실사용에서 빠르다 — 건수는 부가 정보이고 목록이
/// 목적이다. `awaitAnnouncementFinish`를 되살리지 말 것.
///
/// ⚠ `scrollTo`에 넘기는 값은 **`ForEach` 정체성과 같아야** 한다. 포커스 키를
/// 따로 만들면(복합 키 등) 아무 행에도 안 걸려 가시화가 조용히 실패한다.
/// 이 계층을 쓰는 화면은 포커스 키와 스크롤 키를 같은 값으로 유지한다.
///
/// ⚠ `anchor`를 주지 않는 것이 의도다(최소 스크롤 = 이미 보이면 안 움직임).
/// `SearchView`가 `.top`을 쓰는 것은 첫 결과 **위에** 마이크 행·최근 검색어·필터가
/// 있어 그것들을 밀어내야 하기 때문인데, 이 계층을 쓰는 화면은 착지 대상이 곧
/// 목록의 첫 요소라 밀어낼 것이 없다. `.top`을 주면 sticky 섹션 헤더가 네비게이션
/// 바 뒤로 잘려 들어간다(날씨·공기질 화면 시뮬레이터 실측 2026-08-02).
///
/// ⚠ 시뮬레이터로는 검증되지 않는다 — AX 트리는 "어느 행이 포커스를 주장하는지"를
/// 보여주지 않는다. 판정 정본은 실기기 VoiceOver다.
/// 관찰할 상태가 없어 `@Observable`을 붙이지 않는다 — 이 객체가 하는 일은 진행 중인
/// 착지 Task를 한 개만 유지하는 것뿐이고, 화면이 다시 그려질 이유가 되지 못한다.
@MainActor
final class NearbyFocusLander {
    private var task: Task<Void, Never>?

    /// - Parameters:
    ///   - id: 포커스이자 스크롤 키(`ForEach` 정체성과 동일한 값).
    ///   - proxy: 대상 행을 화면 안으로 올리기 위한 스크롤 프록시.
    ///   - apply: 포커스 대입(경합 바인딩이 있으면 그것을 먼저 놓는 것까지 포함).
    ///   - landed: 대입이 유지됐는지 검사(되돌림 감지). true면 재시도하지 않는다.
    ///
    /// ⚠ `apply`·`landed`는 **`id`를 인자로 받는다**. 호출자가 계산 프로퍼티를 그 자리에서
    /// 다시 읽으면, 스크롤한 대상(호출 시점 값)과 포커스를 준 대상(최대 1.3초 뒤 값)이
    /// 어긋나 "가시화 없이 대입만" 하는 상황이 생긴다 — 이 계층이 막으려던 AX 컬링
    /// 그 자체다. 스냅샷을 넘기는 것은 `SearchView`·`DirectionsEndpointSearchView`가
    /// `let first = firstRow`로 캡처하는 것과 같은 규율이다(리뷰 수용 2026-08-02).
    func land(
        id: String,
        proxy: ScrollViewProxy,
        apply: @escaping @MainActor (String) -> Void,
        landed: @escaping @MainActor (String) -> Bool
    ) {
        task?.cancel()
        task = Task { @MainActor in
            proxy.scrollTo(id)
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            apply(id)
            #if DEBUG
            chatFocusLog("[nearby] assigned first=\(id)")
            #endif

            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, !landed(id) else { return }
            #if DEBUG
            chatFocusLog("[nearby] retry first=\(id) (대입이 되돌려졌다)")
            #endif
            proxy.scrollTo(id)
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            apply(id)
        }
    }

    /// 화면을 떠나면 진행 중인 착지를 멈춘다(사라진 화면으로 커서를 끌지 않는다).
    func cancel() {
        task?.cancel()
        task = nil
    }
}

extension View {
    /// 첫 로드 완료 시 `id`가 가리키는 요소로 VO 커서를 한 번 착지시킨다.
    ///
    /// `id`가 nil→값으로 바뀌는 순간이 곧 "로드 완료"다(0건·실패는 nil로 남아
    /// 이동하지 않는다 — 그 상태는 오버레이 텍스트와 통지가 이미 전달한다).
    ///
    /// **처음으로 결과가 나타나는 순간에만** 착지한다. 이미 목록을 본 뒤의 새로고침은
    /// 사용자가 그 버튼에 커서를 둔 채 일으키는 행동이라, 목록으로 끌고 가면 되레
    /// 맥락을 뺏는다(헌장 §5 유지 우선). 반대로 첫 조회가 0건·실패였다가 새로고침으로
    /// 결과가 처음 생기는 경우는 착지한다 — 그때는 "동적 콘텐츠 등장"이라 헌장 §1의
    /// 포커스 이동이 맞다(빼앗을 맥락이 아직 없다).
    func nearbyFocusOnLoad(
        id: String?,
        lander: NearbyFocusLander,
        proxy: ScrollViewProxy,
        landed: @escaping @MainActor (String) -> Bool,
        apply: @escaping @MainActor (String) -> Void
    ) -> some View {
        modifier(NearbyFocusOnLoad(id: id, lander: lander, proxy: proxy, landed: landed, apply: apply))
    }
}

private struct NearbyFocusOnLoad: ViewModifier {
    let id: String?
    let lander: NearbyFocusLander
    let proxy: ScrollViewProxy
    let landed: @MainActor (String) -> Bool
    let apply: @MainActor (String) -> Void
    @State private var didLand = false

    func body(content: Content) -> some View {
        content
            .onChange(of: id) { _, newValue in
                guard !didLand, let newValue else { return }
                didLand = true
                lander.land(id: newValue, proxy: proxy, apply: apply, landed: landed)
            }
            .onDisappear { lander.cancel() }
    }
}
