package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 산문 블록 안에서 그 답변의 카드 장소가 언급된 것을 찾는다(채팅 산문 커스텀 액션 "○○ 상세 보기"의 근거).
 * Kit `ChatPlaceMentions.swift` 미러. 산문은 LLM 자유 텍스트라 장소를 아는 층이 없고, 유일한 근거가 같은
 * 답변의 렌더 카드 장소다. 결정론 부분 문자열 매칭:
 * - 긴 이름부터 대응하고 대응 구간을 같은 길이로 가려 짧은 이름이 긴 이름 안에서 재매칭되지 않게 한다
 *   ("이마트" ⊂ "이마트24 길동점").
 * - 반환은 산문 첫 등장 순. 같은 이름은 한 번만(액션 라벨이 같아 구분 불가).
 * - LLM이 이름을 줄여 쓰면 그 장소는 잡히지 않는다 — 카드가 안전망이라 의도된 한계.
 */
fun chatPlaceMentions(text: String, places: List<Place>): List<Place> =
    mentionOrder(text, places.map { it.name }).map { places[it] }

/** 대응된 구간을 가리는 문자(Swift `"\u{0}"`). 이름에 나올 수 없는 값이라 재매칭이 불가능하다. */
private const val MASK = Char.MIN_VALUE

/**
 * 이름 목록이 산문에 등장하는 순서(인덱스). `chatPlaceMentions`의 알고리즘 그 자체 — 대중교통 안내 상태
 * 문장의 역 언급(E33, `transitStationMentions`)이 같은 규칙을 쓴다: 빈 이름 제외, 긴 이름 우선 대응·마스킹,
 * 첫 등장 순, 같은 이름은 첫 인덱스 한 번만.
 *
 * 단위는 UTF-16 문자다(Swift는 정준 등가로 비교하는 `Character` 자소 묶음). 산문과 이름의 정규화 형식이 다르거나
 * (NFC/NFD), 결합 문자·서로게이트로 길이가 갈릴 때만 다르고 NFC 산문에서는 같다.
 */
fun mentionOrder(text: String, names: List<String>): List<Int> {
    if (text.isEmpty()) return emptyList()
    val masked = text.toCharArray()
    val found = ArrayList<Pair<Int, Int>>() // (첫 등장 offset, 이름 인덱스)
    val seenNames = HashSet<String>()
    val ordered = names.indices.filter { names[it].isNotEmpty() }.sortedByDescending { names[it].length }
    for (index in ordered) {
        val name = names[index]
        if (name in seenNames) continue
        var offset = 0
        var first: Int? = null
        while (offset + name.length <= masked.size) {
            if (matchesAt(masked, offset, name)) {
                if (first == null) first = offset
                for (i in offset until offset + name.length) masked[i] = MASK
                offset += name.length
            } else {
                offset += 1
            }
        }
        if (first != null) {
            seenNames.add(name)
            found.add(first to index)
        }
    }
    return found.sortedBy { it.first }.map { it.second }
}

private fun matchesAt(chars: CharArray, offset: Int, name: String): Boolean {
    for (i in name.indices) if (chars[offset + i] != name[i]) return false
    return true
}
