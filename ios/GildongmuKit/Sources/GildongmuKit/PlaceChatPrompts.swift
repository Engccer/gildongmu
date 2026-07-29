import Foundation

/// 장소 유형별 채팅 예시 프롬프트 키(웹 src/lib/chat/place-prompts.ts 미러, 순수·UI 비의존).
/// 빈 장소 채팅의 "물어볼 만한 예시 3개"를 장소 성격에 맞춰 제시한다:
/// 역(실시간 도착·편의시설·주변) / 음식·카페(길찾기·유사·날씨) / 일반(길찾기·주변·환경).
/// 반환은 i18n 키 — 번역은 호출 측(appLocalized)이 수행한다.
public func placeChatPromptKeys(_ place: Place) -> [String] {
    if isStation(place) {
        return [
            "placeChat.prompt.stationArrivals",
            "placeChat.prompt.stationFacilities",
            "placeChat.prompt.stationSurroundings",
        ]
    }
    if categoryOf(place.category) == "food" {
        return [
            "placeChat.prompt.foodRoute",
            "placeChat.prompt.foodSimilar",
            "placeChat.prompt.foodWeather",
        ]
    }
    return [
        "placeChat.prompt.generalRoute",
        "placeChat.prompt.generalSurroundings",
        "placeChat.prompt.generalWeather",
    ]
}
