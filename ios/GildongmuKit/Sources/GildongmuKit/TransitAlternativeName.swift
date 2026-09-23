import Foundation

/// 대안 경로의 표시 이름 조각(spec `2026-09-24-transit-alternatives-reasoned-design.md` §4.1,
/// 웹 `src/lib/transit-alternative-name.ts` 미러).
///
/// 서버가 준 축(`highlight`)을 문구 키로 옮기기만 한다. 어떤 경로가 최단인지·버스만 타는지의 판정은
/// 전부 서버가 끝냈다. 조합마다 키를 두지 않고 **축 하나에 조각 하나**를 조립 순서로 내고, 앱이
/// 쉼표로 이어 한 줄로 만든다(한 줄 = 한 접근성 객체, 가운뎃점·사유 문장 금지). `fastest`와
/// `fewestTransfers`가 함께 있을 때만 기존 조합 키 하나를 쓴다(기존 문구 보존).
///
/// 산출을 한 곳에 모으는 이유는 같은 이름이 세 자리에 쓰이기 때문이다:
/// disclosure 라벨, 안내 시작 버튼 라벨, 그리고 그 둘을 훑는 VoiceOver 로터.
/// 이름이 갈리면 로터에서 고른 버튼과 화면의 항목이 다른 것으로 들린다.
///
/// 로컬라이즈는 하지 않는다. 키 결정만 Kit이 맡고 문구 조회는 앱 타깃이 한다
/// (Kit 카탈로그와 앱 카탈로그가 다르고, 이 문구들은 앱 카탈로그에 있다).
/// 규칙은 공유 fixture `src/lib/__tests__/fixtures/transit-alternative-name-cases.json`이 잠근다.
public enum TransitAlternativeName {
    private static let axisKeys: [(axis: String, key: String)] = [
        ("fastest", "route.transit.alternativeFastest"),
        ("fewestTransfers", "route.transit.alternativeFewestTransfers"),
        ("leastWalk", "route.transit.alternativeLeastWalk"),
        ("busOnly", "route.transit.alternativeBusOnly"),
        ("subwayOnly", "route.transit.alternativeSubwayOnly"),
    ]

    /// 축·번호 → 조립 순서의 로컬라이즈 키 조각. `index`가 nil이 아니면 그 키가 번호 인자를 받는다.
    ///
    /// ⚠ 모르는 축 문자열은 무시하고, 아는 축이 하나도 없으면 번호로 떨어진다. 서버가 축을 늘렸을 때
    ///   구버전 앱이 원문 축 이름을 그대로 낭독하는 것을 막는다(스토어 1.18·1.19가 이 동작으로 새 축을 받는다).
    public static func parts(
        highlight: [String]?, displayIndex: Int?
    ) -> [(key: String, index: Int?)] {
        let axes = Set(highlight ?? [])
        var keys = axisKeys.filter { axes.contains($0.axis) }.map(\.key)
        if axes.contains("fastest") && axes.contains("fewestTransfers") {
            keys = ["route.transit.alternativeFastestFewestTransfers"]
                + keys.filter {
                    $0 != "route.transit.alternativeFastest" && $0 != "route.transit.alternativeFewestTransfers"
                }
        }
        if keys.isEmpty { return [("route.transit.alternativeHeading", displayIndex ?? 1)] }
        return keys.map { ($0, nil) }
    }
}
