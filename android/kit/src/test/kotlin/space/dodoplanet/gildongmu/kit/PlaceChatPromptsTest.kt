package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 장소 유형별 추천 질문 키(웹 place-prompts.ts 계약 ↔ Kit `PlaceChatPromptsTests` 미러): 역 > 음식 > 일반 순 판별.
 * 반환 키는 카탈로그의 `placeChat.prompt.*` 리터럴이어야 한다(키 오타 = 조용한 미번역 라벨 — 값 자체를 단언).
 */
class PlaceChatPromptsTest {
    private fun prompt(name: String, category: String) = Place(
        id = "kakao-1", name = name, category = category, address = "", roadAddress = "",
        englishAddress = null, lat = 37.5, lng = 127.0, phone = null, link = null, distanceMeters = null,
    )

    @Test fun stationPlaceGetsStationPrompts() {
        assertEquals(
            listOf("placeChat.prompt.stationArrivals", "placeChat.prompt.stationFacilities", "placeChat.prompt.stationSurroundings"),
            placeChatPromptKeys(prompt("강동역 5호선", "교통,수송 > 지하철,전철 > 수도권5호선")),
        )
    }

    @Test fun foodPlaceGetsFoodPrompts() {
        assertEquals(
            listOf("placeChat.prompt.foodRoute", "placeChat.prompt.foodSimilar", "placeChat.prompt.foodWeather"),
            placeChatPromptKeys(prompt("백년찌개집", "음식점 > 한식 > 육류,고기")),
        )
    }

    @Test fun generalPlaceGetsGeneralPrompts() {
        assertEquals(
            listOf("placeChat.prompt.generalRoute", "placeChat.prompt.generalSurroundings", "placeChat.prompt.generalWeather"),
            placeChatPromptKeys(prompt("경복궁", "여행 > 관광,명소 > 문화유적 > 고궁,궁")),
        )
    }

    /** 키즈카페는 food가 아니다(부정 후방탐색) — 일반 프롬프트로 떨어져야 한다. */
    @Test fun kidsCafeIsNotFood() {
        assertEquals("placeChat.prompt.generalRoute", placeChatPromptKeys(prompt("챔피언 키즈카페", "여가,오락 > 키즈카페")).first())
    }
}
