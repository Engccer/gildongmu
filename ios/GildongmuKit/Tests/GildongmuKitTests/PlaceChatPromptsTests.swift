import Testing
@testable import GildongmuKit

// 장소 유형별 추천 질문 키(웹 place-prompts.ts 계약 미러): 역 > 음식 > 일반 순 판별.
// 반환 키는 카탈로그(Localizable.xcstrings)에 존재하는 placeChat.prompt.* 리터럴이어야
// 한다(키 오타 = 조용한 미번역 라벨 — 값 자체를 단언).

private func prompt(_ name: String, category: String) -> Place {
    Place(
        id: "kakao-1", name: name, category: category, address: "", roadAddress: "",
        englishAddress: nil, lat: 37.5, lng: 127.0, phone: nil, link: nil, distanceMeters: nil
    )
}

@Test func stationPlaceGetsStationPrompts() {
    let keys = placeChatPromptKeys(prompt("강동역 5호선", category: "교통,수송 > 지하철,전철 > 수도권5호선"))
    #expect(keys == [
        "placeChat.prompt.stationArrivals",
        "placeChat.prompt.stationFacilities",
        "placeChat.prompt.stationSurroundings",
    ])
}

@Test func foodPlaceGetsFoodPrompts() {
    let keys = placeChatPromptKeys(prompt("백년찌개집", category: "음식점 > 한식 > 육류,고기"))
    #expect(keys == [
        "placeChat.prompt.foodRoute",
        "placeChat.prompt.foodSimilar",
        "placeChat.prompt.foodWeather",
    ])
}

@Test func generalPlaceGetsGeneralPrompts() {
    let keys = placeChatPromptKeys(prompt("경복궁", category: "여행 > 관광,명소 > 문화유적 > 고궁,궁"))
    #expect(keys == [
        "placeChat.prompt.generalRoute",
        "placeChat.prompt.generalSurroundings",
        "placeChat.prompt.generalWeather",
    ])
}

/// 키즈카페는 food가 아니다(부정 후방탐색) — 일반 프롬프트로 떨어져야 한다.
@Test func kidsCafeIsNotFood() {
    let keys = placeChatPromptKeys(prompt("챔피언 키즈카페", category: "여가,오락 > 키즈카페"))
    #expect(keys.first == "placeChat.prompt.generalRoute")
}
