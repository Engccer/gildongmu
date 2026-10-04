import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 서울 열린데이터 출처 표기(E58 ⑦, 위원장 판정 2026-10-05). 서울 열린데이터 약관 제10조③은 "서울특별시 공공데이터"
 * 명시를 요구한다 — 웹 각주 넷은 앱(채팅 출처 `chat.source.seoulopen`)과 같은 표기를 품는다. 뒷부분(따릉이·문화행사·
 * 지하철 도착정보)은 각주마다 그대로다.
 */
const LOCALES = ["ko", "en", "es", "fr", "it", "ja"] as const;
const KEYS = ["bike", "eventsNearby", "subwayArrival", "subwayNearby"] as const;

describe("웹 출처 각주 넷은 채팅 출처와 같은 서울 열린데이터 표기를 품는다", () => {
  for (const locale of LOCALES) {
    it(locale, () => {
      const m = JSON.parse(readFileSync(join(__dirname, `../../../messages/${locale}.json`), "utf8"));
      const attribution: string = m.chat.source.seoulopen;
      for (const key of KEYS) expect(m[key].source, key).toContain(attribution);
    });
  }

  it("ko 문장(위원장 판정 예문 꼴)", () => {
    const ko = JSON.parse(readFileSync(join(__dirname, "../../../messages/ko.json"), "utf8"));
    expect(ko.bike.source).toBe("출처: 서울특별시 공공데이터(서울 열린데이터광장) 따릉이.");
    expect(ko.eventsNearby.source).toBe(
      "출처: 서울특별시 공공데이터(서울 열린데이터광장) 문화행사 정보. 오늘 진행 중인 행사만 표시합니다.",
    );
    expect(ko.subwayArrival.source).toBe("출처: 서울특별시 공공데이터(서울 열린데이터광장) 지하철 실시간 도착정보.");
    expect(ko.subwayNearby.source).toBe(ko.subwayArrival.source);
  });
});
