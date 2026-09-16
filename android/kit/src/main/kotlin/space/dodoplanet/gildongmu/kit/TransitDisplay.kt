package space.dodoplanet.gildongmu.kit

/**
 * 한 줄(한 접근성 객체)의 언어 선택. 웹 `place-lines/pick-line.ts` ↔ Kit `TransitDisplay.swift` 미러(E27 §3.6).
 *
 * 한 줄 안에서 언어를 섞지 않는다: 영문 조각(`*En`)이 **전부** 있을 때만 영어 줄이고, 하나라도 없으면
 * 줄 전체를 한국어 원문으로 둔다. 필드 단위 nullable로는 이 원자성을 보장할 수 없어 줄을 만드는 모든
 * 자리가 이 함수만 지난다.
 */
object TransitDisplay {
    /**
     * `isEn`이고 `enParts`에 null이 없으면 `build(enParts)`, 아니면 `ko`. 빈 문자열은 "이 자리는 ko에도
     * 없다"는 자리 표시라 부재가 아니다(Kit 관례: null=부재·""=자리 표시).
     */
    fun pickLine(isEn: Boolean, ko: String, enParts: List<String?>, build: (List<String>) -> String): String {
        if (!isEn) return ko
        val parts = enParts.filterNotNull()
        if (parts.size != enParts.size) return ko
        return build(parts)
    }
}
