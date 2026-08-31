import Foundation
import GildongmuKit

/// 앱 타깃 표시 문자열 조회. `String(localized:)`를 쓰지 않는 이유(2026-07-19 실측):
/// `Bundle`은 언어 협상을 **프로세스 시작 시 1회만** 하고 캐싱한다 — 실행 중
/// `AppleLanguages`를 바꿔도 `Bundle.main.preferredLocalizations`는 그대로라
/// `String(localized:)`가 옛 언어를 계속 반환하고, 뷰를 재생성해도 값이 같아
/// 화면이 안 바뀐다(위원장 실기기 보고: 앱을 완전히 닫아야만 반영).
/// 대신 언어별 `.lproj` 하위 번들을 직접 조회하면 즉시 정확한 값이 나온다
/// (실측: 같은 프로세스에서 ko "언어" / en "Language" / fr "Langue").
/// Kit의 `kitLocalized(_:lang:)`와 같은 "명시 언어 조회" 계약이며, 앱 타깃은
/// xcstrings가 `.lproj/Localizable.strings`로 컴파일되므로 번들 조회를 쓴다.
///
/// 키는 항상 문자열 리터럴로 호출한다(check-xcstrings-keys.mjs 린터 계약).
/// 미보유 키는 키 그대로 반환(린터가 머지 게이트에서 차단).
/// 수량 인자는 `Int`로 넘긴다(A29) — 복수 블록(`{N, plural, …}`)의 분기 선택에 쓰이고
/// 표시는 `String(n)`과 같다. `String(n)`을 넘겨도 해석기가 정수로 읽어 분기는 맞지만
/// 타입이 뜻을 말하도록 `Int`로 통일한다.
func appLocalized(_ key: String, _ args: CVarArg...) -> String {
    // Bundle(path:)는 같은 경로에 대해 기존 인스턴스를 돌려주므로 매 호출 생성 비용이 없다.
    let bundle = Bundle.main.path(forResource: AppLanguage.current, ofType: "lproj")
        .flatMap(Bundle.init(path:)) ?? .main
    let format = bundle.localizedString(forKey: key, value: nil, table: nil)
    // 복수 블록 치환·Int 인자 문자열화는 Kit `formatLocalized` 한 곳(A29) — Kit과 같은 해석기.
    return formatLocalized(format, lang: AppLanguage.current, args: args)
}

/// 위치 인자를 배열로 받는 판(Kit이 키·인자를 함께 돌려주는 자리용, `TransitWalkLegText`).
/// 키는 여전히 리터럴로 호출한다 — 이 오버로드가 그 계약을 풀지 않는다.
func appLocalized(_ key: String, arguments: [String]) -> String {
    let bundle = Bundle.main.path(forResource: AppLanguage.current, ofType: "lproj")
        .flatMap(Bundle.init(path:)) ?? .main
    let format = bundle.localizedString(forKey: key, value: nil, table: nil)
    return formatLocalized(format, lang: AppLanguage.current, args: arguments.map { $0 as CVarArg })
}
