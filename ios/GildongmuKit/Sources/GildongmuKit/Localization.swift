import Foundation

// Kit 표시 문자열 조회. Kit는 lang을 항상 명시 인자로 받으므로 Apple 로컬라이즈
// 파이프라인(Bundle 언어 해석)을 쓰지 않고 카탈로그 JSON을 데이터로 직접 파싱한다.
// 이유(결정론): SPM `swift test`는 xcstrings를 .lproj로 컴파일하지 않아 lproj 조회가
// 테스트에서 실패한다 — JSON 직접 조회로 테스트를 결정론화한다. 다만 **Xcode 앱
// 빌드는 정반대**로, `.copy` 선언과 무관하게 xcstrings를 String Catalog로 컴파일해
// 원본 JSON을 번들에서 없앤다(lproj만 남음). 그래서 두 경로를 모두 둔다:
// JSON 우선, 없으면 lproj. 호스트 언어 무관.

private struct StringUnit: Decodable { let value: String }
private struct Localization: Decodable { let stringUnit: StringUnit }
private struct CatalogEntry: Decodable { let localizations: [String: Localization]? }
private struct Catalog: Decodable { let strings: [String: CatalogEntry] }

/// key → (lang → 문구). 앱 수명 1회 로드(230키 수준, 실패 시 빈 사전 = 키 그대로 노출).
private let catalogTable: [String: [String: String]] = {
    guard let url = Bundle.module.url(forResource: "Localizable", withExtension: "xcstrings"),
          let data = try? Data(contentsOf: url),
          let catalog = try? JSONDecoder().decode(Catalog.self, from: data)
    else { return [:] }
    return catalog.strings.mapValues { entry in
        (entry.localizations ?? [:]).mapValues(\.stringUnit.value)
    }
}()

/// lproj 폴백 — Xcode 앱 빌드는 `.copy` 선언과 무관하게 `.xcstrings`를 String
/// Catalog로 **컴파일**해 `<lang>.lproj/Localizable.strings`만 번들에 남긴다(원본
/// JSON 부재 → catalogTable 빈 사전). 그래서 앱에서는 이 경로가 정본이 된다.
/// 언어별 lproj를 직접 여는 이유는 앱 계층 `appLocalized`와 같다 — Bundle의 언어
/// 협상은 프로세스 시작 시 1회 캐싱이라 앱 내 즉시 전환에 쓸 수 없다.
private func lprojLocalized(_ key: String, lang: String) -> String? {
    let sentinel = "\u{0}missing"
    for candidate in [lang, "ko"] {
        guard let bundle = Bundle.module.path(forResource: candidate, ofType: "lproj")
            .flatMap(Bundle.init(path:)) else { continue }
        let value = bundle.localizedString(forKey: key, value: sentinel, table: nil)
        if value != sentinel { return value }
    }
    return nil
}

/// Kit 표시 문자열 조회. 미보유 lang은 ko 폴백, 미보유 키는 키 그대로 반환
/// (check-xcstrings-keys.mjs 린터가 누락 키를 머지 게이트에서 차단).
/// 키는 항상 문자열 리터럴로 호출한다(린터 추출 계약).
/// 조회 순서: 카탈로그 JSON(swift test 경로) → lproj(앱 빌드 경로) → 키.
func kitLocalized(_ key: String, lang: String, _ args: CVarArg...) -> String {
    let byLang = catalogTable[key]
    let format = byLang?[lang] ?? byLang?["ko"] ?? lprojLocalized(key, lang: lang) ?? key
    return args.isEmpty ? format : String(format: format, arguments: args)
}
