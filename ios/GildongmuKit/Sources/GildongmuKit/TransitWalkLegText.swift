import Foundation

/// 대중교통 도보 구간 한 줄의 문구 키와 위치 인자(D8, 2026-08-17 — 앱 타깃의
/// `transitLegText` 도보 4분기를 테스트 가능한 자리로 옮겼다).
///
/// 판정 축은 둘뿐이다: 행선지 이름이 있는가, 거리가 있는가. 거리는 3-state라 필드가
/// 없으면 "0m"가 아니라 거리 없는 문구로 떨어진다(조립은 `formatDistance` 정본).
///
/// ⚠ 인자 순서는 **ko 문장의 플레이스홀더 등장 순서**가 정본이다 —
///   ko "{name}까지 도보 {minutes}분, {distance}" → (name, minutes, distance).
///   어순이 다른 로케일은 변환 스크립트가 인덱스를 재배치하므로 호출부는 로케일과
///   무관하게 이 순서 하나만 지킨다. 여기 테스트가 잠그는 것이 정확히 "맞는 키에
///   맞는 순서의 인자"다(다른 위험은 Swift 망라성·키 린터가 이미 막는다).
///
/// 로컬라이즈는 하지 않는다. 키·인자 결정만 Kit이 맡고 문구 조회는 앱 타깃이 한다
/// (`TransitAlternativeName` 동형 — 앱 카탈로그 키는 리터럴로만 호출한다는 린터 계약).
public enum TransitWalkLegText {
    /// 마지막 도보(행선지 없음) 줄이 실을 목적지 이름(A52). provider가 이름을 주지 않아 소비자가 아는
    /// 목적지 라벨을 쓰는데, 영어 줄이면 **라틴 표기만** 싣는다 — 한 줄 안에서 언어를 섞지 않는다(E27).
    /// 라틴 표기는 E28 `bilingualName`의 1순위 이름(로마자·원천 병기·원래 라틴 이름)이고, 그래도 한글이면
    /// nil이라 "목적지까지" 문구로 떨어진다. 병기 괄호는 붙이지 않는다(이름 뒤에 거리가 이어진다).
    /// `english`는 호출부가 기존 영어 자격 판정(`transitLegUsesEnglish`)으로 정한 값이다.
    /// 규칙표는 웹·안드로이드와 공유하는 fixture `transit-walk-destination-cases.json`.
    public static func destinationName(label: String?, roman: String?, english: Bool) -> String? {
        guard let label = transitBriefingName(label) else { return nil }
        guard english else { return label }
        let primary = bilingualName(lang: "en", ko: label, en: nil, roman: roman).primary
        return hasHangul(primary) ? nil : transitBriefingName(primary)
    }

    /// `boardExit`은 **다음 구간의 승차 출구**(E25)다 — 걷는 동안 듣고 바로 그 행동을 하므로
    /// 이 줄이 싣는다. 행선지 이름이 없는 마지막 도보에는 붙일 자리가 없어 종전 문구로 떨어진다.
    /// ko 순서는 "{name} {exit}번 출구까지 도보 {minutes}분, {distance}" → (name, exit, minutes, distance).
    public static func resolve(
        name: String?, distance: String?, minutes: Int, boardExit: String? = nil
    ) -> (key: String, args: [String]) {
        let name = transitBriefingName(name)
        let boardExit = (boardExit?.isEmpty == false) ? boardExit : nil
        let minutes = String(minutes)
        switch (name, distance) {
        case let (name?, distance?):
            guard let boardExit else { return ("route.transit.legWalkTo", [name, minutes, distance]) }
            return ("route.transit.legWalkToExit", [name, boardExit, minutes, distance])
        case let (name?, nil):
            guard let boardExit else { return ("route.transit.legWalkToNoDistance", [name, minutes]) }
            return ("route.transit.legWalkToExitNoDistance", [name, boardExit, minutes])
        case let (nil, distance?):
            return ("route.transit.legWalkToDest", [minutes, distance])
        case (nil, nil):
            return ("route.transit.legWalkToDestNoDistance", [minutes])
        }
    }
}
