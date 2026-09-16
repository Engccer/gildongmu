package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 산문 블록 ↔ 카드 장소 대응(채팅 산문 커스텀 액션의 근거, Kit `ChatPlaceMentionsTests` 미러). 결정론 부분 문자열
 * 매칭: 긴 이름 우선으로 대응 구간을 가려 짧은 이름이 긴 이름 안에서 재매칭되지 않고, 반환은 산문 첫 등장 순,
 * 같은 이름은 한 번만(액션 라벨이 동일해 구분 불가).
 */
class ChatPlaceMentionsTest {
    private fun place(id: String, name: String) = Place(
        id = id, name = name, category = "", address = "", roadAddress = "",
        englishAddress = null, lat = 37.5, lng = 127.0, phone = null, link = null, distanceMeters = null,
    )

    @Test fun returnsMentionsInOrderOfAppearance() {
        val places = listOf(place("a", "스타벅스 강동역점"), place("b", "이디야 천호점"), place("c", "투썸 명일점"))
        val text = "가까운 곳은 이디야 천호점이고, 조금 더 가면 스타벅스 강동역점이 있어요."
        assertEquals(listOf("b", "a"), chatPlaceMentions(text, places).map { it.id })
    }

    @Test fun longerNameMasksShorterOne() {
        // "이마트24"가 먼저 대응되면 그 안의 "이마트"는 별개 언급이 아니다.
        val places = listOf(place("short", "이마트"), place("long", "이마트24 길동점"))
        assertEquals(listOf("long"), chatPlaceMentions("편의점은 이마트24 길동점이 가깝습니다.", places).map { it.id })
        // 둘 다 따로 등장하면 둘 다.
        assertEquals(listOf("long", "short"), chatPlaceMentions("이마트24 길동점 옆에 이마트도 있어요.", places).map { it.id })
    }

    @Test fun ignoresEmptyNamesAndDedupesByName() {
        val places = listOf(place("x", ""), place("w", "  "), place("y", "강동역"), place("z", "강동역"))
        assertEquals(listOf("y"), chatPlaceMentions("강동역에서 강동역 방면", places).map { it.id })
    }

    @Test fun noMentionYieldsEmpty() {
        assertTrue(chatPlaceMentions("근처에 카페가 많아요.", listOf(place("a", "스타벅스"))).isEmpty())
        assertTrue(chatPlaceMentions("", listOf(place("a", "스타벅스"))).isEmpty())
    }
}
