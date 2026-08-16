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
    public static func resolve(
        name: String?, distance: String?, minutes: Int
    ) -> (key: String, args: [String]) {
        let name = (name?.isEmpty == false) ? name : nil
        let minutes = String(minutes)
        switch (name, distance) {
        case let (name?, distance?):
            return ("route.transit.legWalkTo", [name, minutes, distance])
        case let (name?, nil):
            return ("route.transit.legWalkToNoDistance", [name, minutes])
        case let (nil, distance?):
            return ("route.transit.legWalkToDest", [minutes, distance])
        case (nil, nil):
            return ("route.transit.legWalkToDestNoDistance", [minutes])
        }
    }
}
