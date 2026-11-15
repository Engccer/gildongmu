import Foundation

// 「도착지와 수단으로 안내 시작」(E83 R10·R11)이 길찾기 화면과 함께 쓰는 판정 — 순수 함수.
// 길찾기 화면의 시작 버튼과 그 화면 밖 시작 자리(채팅 경로 카드 등)가 같은 함수를 지나야 조건이 갈리지 않는다.

/// 자동차 실시간 안내를 시작할 수 있는가: 한국어 데이터 ∧ Tmap 경로(카카오 폴백은 기하 미지원이라 누르자마자 강등되는 죽은 버튼이 된다).
/// ⚠ 인자에 기본값을 두지 않는다 — 생략이 조용히 「늘 시작 가능」이 되지 않게.
public func canStartCarGuide(dataLocale: String, provider: String?) -> Bool {
    dataLocale == "ko" && provider == "tmap"
}

extension WalkLineKind {
    /// 조회 화면 도보 줄 목록의 첫 줄 = 그 화면의 첫 도보 안내 시작 버튼(서버 `getWalkRouteLines`의 순서: ko `[shortest, …]`,
    /// 그 밖 `[recommended, shortest]`). 줄 목록을 조회하지 않고 도보 안내를 시작하는 자리의 기본 줄이다.
    public static func firstLine(dataLocale: String) -> WalkLineKind {
        dataLocale == "ko" ? .shortest : .recommended
    }

    /// 도착지와 수단만으로 시작하는 도보 안내의 줄: 계단 회피를 청했으면 그 줄, 아니면 조회 화면의 첫 줄.
    public static func startLine(accessible: Bool, dataLocale: String) -> WalkLineKind {
        accessible ? .accessible : firstLine(dataLocale: dataLocale)
    }
}
