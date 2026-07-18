import Foundation

// Kit 표시 문자열 조회. Kit는 lang을 항상 명시 인자로 받으므로 Apple 로컬라이즈
// 파이프라인(Bundle 언어 해석)을 쓰지 않고 카탈로그 JSON을 데이터로 직접 파싱한다.
// 이유(결정론): SPM `swift test`는 xcstrings를 .lproj로 컴파일하지 않아 lproj 조회가
// 테스트에서 실패한다 — JSON 직접 조회는 swift test와 앱 빌드에서 단일 코드 경로다
// (Package.swift가 `.copy`로 원본을 번들에 싣는다). 호스트 언어 무관.

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

/// Kit 표시 문자열 조회. 미보유 lang은 ko 폴백, 미보유 키는 키 그대로 반환
/// (check-xcstrings-keys.mjs 린터가 누락 키를 머지 게이트에서 차단).
/// 키는 항상 문자열 리터럴로 호출한다(린터 추출 계약).
func kitLocalized(_ key: String, lang: String, _ args: CVarArg...) -> String {
    let byLang = catalogTable[key]
    let format = byLang?[lang] ?? byLang?["ko"] ?? key
    return args.isEmpty ? format : String(format: format, arguments: args)
}
