package space.dodoplanet.gildongmu.kit

/**
 * Kit Swift 원본(읽기 전용). 웹 드리프트 가드는 Swift만 읽으므로 "웹·iOS는 고치고 안드로이드만 잊은" 경우를 잡지 못한다 —
 * 공유 fixture가 없는 상수·목록은 Kotlin 테스트가 원본을 직접 읽어 대조한다.
 */
object SwiftSource {
    fun read(file: String): String {
        val f = Fixtures.repoRoot.resolve("ios/GildongmuKit/Sources/GildongmuKit/$file")
        check(f.isFile) { "Swift 원본이 없다: $f" }
        return f.readText()
    }

    /** `public static let 이름 = 숫자 리터럴` 전부. 0건이면 실패한다(선언 모양이 바뀌어 대조가 공회전하는 것을 막는다). */
    fun staticNumbers(file: String): Map<String, Double> {
        val found = Regex("""public static let ([A-Za-z]+) = ([0-9]+(?:\.[0-9]+)?)[ \t]*(?://.*)?$""", RegexOption.MULTILINE)
            .findAll(read(file))
            .associate { it.groupValues[1] to it.groupValues[2].toDouble() }
        check(found.isNotEmpty()) { "$file: 숫자 상수 선언을 찾지 못했다" }
        return found
    }
}
