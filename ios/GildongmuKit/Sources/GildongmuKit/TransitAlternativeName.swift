import Foundation

/// 대안 경로의 표시 이름 키(spec §4.1, 웹 `src/lib/transit-alternative-name.ts` 미러).
///
/// 서버가 준 축(`highlight`)과 표시 번호(`displayIndex`)를 문구 키로 옮기기만 한다.
/// 어떤 경로가 최단인지·환승이 가장 적은지의 판정은 전부 서버가 끝냈다.
///
/// 산출을 한 곳에 모으는 이유는 같은 이름이 세 자리에 쓰이기 때문이다:
/// disclosure 라벨, 안내 시작 버튼 라벨, 그리고 그 둘을 훑는 VoiceOver 로터.
/// 이름이 갈리면 로터에서 고른 버튼과 화면의 항목이 다른 것으로 들린다.
///
/// 로컬라이즈는 하지 않는다. 키 결정만 Kit이 맡고 문구 조회는 앱 타깃이 한다
/// (Kit 카탈로그와 앱 카탈로그가 다르고, 이 문구들은 앱 카탈로그에 있다).
public enum TransitAlternativeName {
    /// 축·번호 조합 → 로컬라이즈 키. `index`가 nil이 아니면 그 키가 번호 인자를 받는다.
    ///
    /// ⚠ 모르는 축 문자열은 무시하고 번호로 떨어진다. 서버가 축을 늘렸을 때
    ///   구버전 앱이 원문 축 이름을 그대로 낭독하는 것을 막는다.
    public static func key(
        highlight: [String]?, displayIndex: Int?
    ) -> (key: String, index: Int?) {
        let axes = highlight ?? []
        let fast = axes.contains("fastest")
        let few = axes.contains("fewestTransfers")
        if fast && few { return ("route.transit.alternativeFastestFewestTransfers", nil) }
        if few { return ("route.transit.alternativeFewestTransfers", nil) }
        if fast { return ("route.transit.alternativeFastest", nil) }
        return ("route.transit.alternativeHeading", displayIndex ?? 1)
    }
}
