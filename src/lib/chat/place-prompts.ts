/**
 * 장소 유형별 채팅 예시 프롬프트 키를 고른다(순수·React 비의존).
 *
 * 빈 채팅 오버레이의 "물어볼 만한 예시 3개"를 장소 성격에 맞춰 제시한다.
 * 역(실시간 도착·편의시설·주변) / 음식·카페(길찾기·유사·날씨) / 일반(길찾기·주변·환경).
 * 반환은 i18n 키 — 번역은 호출 측(ChatOverlay)이 useTranslations로 수행한다.
 */
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { categoryOf } from "@/lib/category";

export function placeChatPrompts(place: Place): string[] {
  if (isStation(place)) {
    return [
      "placeChat.prompt.stationArrivals",
      "placeChat.prompt.stationFacilities",
      "placeChat.prompt.stationSurroundings",
    ];
  }
  if (categoryOf(place.category) === "food") {
    return [
      "placeChat.prompt.foodRoute",
      "placeChat.prompt.foodSimilar",
      "placeChat.prompt.foodWeather",
    ];
  }
  return [
    "placeChat.prompt.generalRoute",
    "placeChat.prompt.generalSurroundings",
    "placeChat.prompt.generalWeather",
  ];
}
