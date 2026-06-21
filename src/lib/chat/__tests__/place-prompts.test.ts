import { describe, it, expect } from "vitest";
import type { Place } from "@/lib/types";
import { placeChatPrompts } from "../place-prompts";

function place(over: Partial<Place>): Place {
  return {
    id: "1", name: "테스트", category: "기타",
    address: "", roadAddress: "", lat: 37.5, lng: 127.0,
    ...over,
  };
}

describe("placeChatPrompts", () => {
  it("역이면 station 프롬프트 3개", () => {
    const p = place({ name: "강남역", category: "지하철" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.stationArrivals",
      "placeChat.prompt.stationFacilities",
      "placeChat.prompt.stationSurroundings",
    ]);
  });

  it("이름이 '역'으로 끝나도 역으로 판정", () => {
    const p = place({ name: "서울역", category: "기타" });
    expect(placeChatPrompts(p)[0]).toBe("placeChat.prompt.stationArrivals");
  });

  it("음식/카페면 food 프롬프트 3개", () => {
    const p = place({ name: "스타벅스 강남점", category: "음식점 > 카페" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.foodRoute",
      "placeChat.prompt.foodSimilar",
      "placeChat.prompt.foodWeather",
    ]);
  });

  it("그 외(관광 등)는 general 프롬프트 3개", () => {
    const p = place({ name: "경복궁", category: "여행 > 관광,명소 > 고궁" });
    expect(placeChatPrompts(p)).toEqual([
      "placeChat.prompt.generalRoute",
      "placeChat.prompt.generalSurroundings",
      "placeChat.prompt.generalWeather",
    ]);
  });
});
