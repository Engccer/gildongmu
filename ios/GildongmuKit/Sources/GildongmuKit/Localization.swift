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
    return formatLocalized(format, lang: lang, args: args)
}

// MARK: - 복수형 해석 (A29, spec 2026-08-31-plural-forms-design.md §5)
//
// 카탈로그는 ICU 복수 블록을 `{N, plural, one {…} other {…}}`(이름 대신 인자 인덱스, 분기
// 안 `#`은 이미 `%N$@`) 형태의 **문자열 그대로** 싣는다(변환 스크립트
// ios/scripts/messages-to-xcstrings.mjs). xcstrings 네이티브 `variations.plural`을 쓰지
// 않는 이유: lproj로 컴파일되면 `.stringsdict`(`%#@value@`)가 되어 위 명시 언어 조회가
// one/other 값에 닿지 못하고, Foundation에 맡기면 카테고리가 앱 선택 언어가 아니라
// 포맷 로케일을 따르며 swift test의 JSON 경로에는 그 기계가 없다(실험 2026-08-31).
// 그래서 앱 `appLocalized`·Kit `kitLocalized`·테스트 세 경로가 전부 이 함수 하나를 지난다.

/// CLDR 부분집합 — 지원 6로케일의 one/other 분기 선택. en·es·it은 1만 one, **fr은 0과
/// 1이 one**("0 lieu"), ko·ja·미지 언어는 other. 백만 단위 CLDR `many`(fr·es·it)는
/// 문자열이 그 분기를 정의하지 않아 웹(intl-messageformat)도 other로 떨어지므로 여기서도
/// other다 — 이 함수가 맞추는 것은 CLDR 원 카테고리가 아니라 **두 분기 메시지의 선택**이다.
/// 공유 fixture `src/lib/__tests__/fixtures/plural-category-cases.json`이 웹과 한 표.
/// 언어 태그는 기본 언어로 정규화한다(`fr-FR`·`fr_CA`·`EN` → `fr`·`en`) — `AppLanguage.current`는
/// 두 글자 코드지만 공개 함수라 태그가 닿을 수 있다. 음수는 CLDR처럼 절댓값으로 본다.
public func pluralCategory(count: Int, lang: String) -> String {
    let base = lang.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map { $0.lowercased() } ?? lang
    let n = count.magnitude
    switch base {
    case "en", "es", "it": return n == 1 ? "one" : "other"
    case "fr": return n == 0 || n == 1 ? "one" : "other"
    default: return "other"
    }
}

private struct PluralBlock {
    let argIndex: Int
    let branches: [String: String]
    let end: Int  // 닫는 `}`의 인덱스
}

/// `open`의 `{`와 짝이 되는 `}` 인덱스(깊이 계산). 없으면 nil.
private func matchingBrace(_ chars: [Character], from open: Int) -> Int? {
    var depth = 0
    var i = open
    while i < chars.count {
        if chars[i] == "{" { depth += 1 }
        else if chars[i] == "}" {
            depth -= 1
            if depth == 0 { return i }
        }
        i += 1
    }
    return nil
}

/// `{N, plural, one {…} other {…}}`를 `open` 위치에서 읽는다. 형식이 아니면 nil —
/// 그 `{`는 리터럴이다(본문 리터럴 중괄호는 그대로 남는다).
private func parsePluralBlock(_ chars: [Character], at open: Int) -> PluralBlock? {
    guard let close = matchingBrace(chars, from: open) else { return nil }
    let inner = String(chars[(open + 1)..<close])
    guard let comma = inner.firstIndex(of: ",") else { return nil }
    guard let argIndex = Int(inner[..<comma].trimmingCharacters(in: .whitespaces)), argIndex >= 1 else { return nil }
    var rest = Substring(inner[inner.index(after: comma)...])
    guard rest.trimmingCharacters(in: .whitespaces).hasPrefix("plural") else { return nil }
    rest = rest[rest.range(of: "plural")!.upperBound...]
    guard let secondComma = rest.firstIndex(of: ","),
          rest[..<secondComma].trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    let tail = Array(rest[rest.index(after: secondComma)...])
    var branches: [String: String] = [:]
    var i = 0
    while i < tail.count {
        if tail[i].isWhitespace { i += 1; continue }
        var name = ""
        while i < tail.count, tail[i].isLetter { name.append(tail[i]); i += 1 }
        while i < tail.count, tail[i].isWhitespace { i += 1 }
        guard !name.isEmpty, i < tail.count, tail[i] == "{", let bodyClose = matchingBrace(tail, from: i) else { return nil }
        branches[name] = String(tail[(i + 1)..<bodyClose])
        i = bodyClose + 1
    }
    guard branches["other"] != nil else { return nil }
    return PluralBlock(argIndex: argIndex, branches: branches, end: close)
}

/// 인자에서 수량을 읽는다. `Int`면 그대로, `String`이면 `Int(s)`(천 단위 구분자가 있으면
/// nil → other — 그 수는 어차피 1이 아니다), 그 외·범위 밖은 nil(→ other).
private func pluralCount(_ args: [CVarArg], argIndex: Int) -> Int? {
    guard argIndex - 1 < args.count else {
        assertionFailure("복수 블록 인자 %\(argIndex)$@가 없다 — 호출부가 수량 인자를 빠뜨렸다")
        return nil
    }
    let arg = args[argIndex - 1]
    if let n = integerValue(arg) { return n }
    if let s = arg as? String { return Int(s) }
    return nil
}

/// 정수형 CVarArg를 Int로. `%@` 자리에 정수를 그대로 넘기면 포인터로 읽혀 크래시라
/// 표시 전 문자열화해야 하는데, 그 판정을 `Int` 하나에만 걸면 `Int64`·`UInt`가 샌다.
private func integerValue(_ arg: CVarArg) -> Int? {
    switch arg {
    case let n as Int: return n
    case let n as Int64: return Int(n)
    case let n as Int32: return Int(n)
    case let n as Int16: return Int(n)
    case let n as Int8: return Int(n)
    case let n as UInt: return Int(exactly: n)
    case let n as UInt64: return Int(exactly: n)
    case let n as UInt32: return Int(n)
    case let n as UInt16: return Int(n)
    case let n as UInt8: return Int(n)
    default: return nil
    }
}

/// 포맷 문자열 안의 복수 블록을 인자 값으로 고른 분기로 치환한다(순수 함수).
/// `one`이 없으면 `other`, `other`가 없으면 그 블록은 리터럴로 남긴다(변환 스크립트가 만든
/// 카탈로그에는 항상 둘 다 있다).
public func resolvePluralBlocks(_ format: String, lang: String, args: [CVarArg]) -> String {
    guard format.contains("plural") else { return format }
    let chars = Array(format)
    var out = ""
    var i = 0
    while i < chars.count {
        if chars[i] == "{", let block = parsePluralBlock(chars, at: i) {
            let category = pluralCount(args, argIndex: block.argIndex).map { pluralCategory(count: $0, lang: lang) } ?? "other"
            out += block.branches[category] ?? block.branches["other"]!
            i = block.end + 1
        } else {
            out.append(chars[i])
            i += 1
        }
    }
    return out
}

/// 카탈로그 포맷 + 인자 → 표시 문자열. ①복수 블록 치환 ②`Int` 인자는 `String(n)`으로
/// (`%@`에 `Int`를 넘기면 포인터로 읽어 크래시 — 종전 `String(count)` 호출부와 표시가 같다)
/// ③`String(format:)`. 인자가 없으면 포맷 그대로(종전 동작).
public func formatLocalized(_ format: String, lang: String, args: [CVarArg]) -> String {
    guard !args.isEmpty else {
        // 인자 없는 조회는 종전대로 포맷 그대로 — 단 복수 블록이 있는 키를 인자 없이 부르면
        // ICU 원문이 낭독된다(변환 스크립트가 만든 카탈로그의 plural 키는 전부 인자를 받는다).
        assert(!format.contains(", plural, "), "복수 블록이 있는 키를 인자 없이 조회했다: \(format)")
        return format
    }
    let resolved = resolvePluralBlocks(format, lang: lang, args: args)
    let stringArgs: [CVarArg] = args.map { arg in integerValue(arg).map(String.init) ?? arg }
    return String(format: resolved, arguments: stringArgs)
}
