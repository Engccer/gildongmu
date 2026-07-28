import { describe, it, expect } from "vitest";
import { buildDeepgramParams, parseDeepgramTranscript } from "../deepgram";

const ok = {
  results: {
    channels: [
      {
        detected_language: "ko",
        alternatives: [{ transcript: "경복궁", confidence: 0.98, words: [] }],
      },
    ],
  },
};

describe("parseDeepgramTranscript", () => {
  it("전사 텍스트·언어·신뢰도를 추출한다", () => {
    expect(parseDeepgramTranscript(ok, "en")).toEqual({
      text: "경복궁",
      language_code: "ko",
      confidence: 0.98,
    });
  });
  it("detected_language 없으면 fallback locale", () => {
    const noLang = {
      results: { channels: [{ alternatives: [{ transcript: "hi", confidence: 0.9 }] }] },
    };
    expect(parseDeepgramTranscript(noLang, "en")?.language_code).toBe("en");
  });
  it("transcript 없으면 null", () => {
    expect(parseDeepgramTranscript({ results: { channels: [{ alternatives: [] }] } }, "ko")).toBeNull();
  });
  it("빈 transcript는 null", () => {
    const empty = { results: { channels: [{ alternatives: [{ transcript: "", confidence: 0 }] }] } };
    expect(parseDeepgramTranscript(empty, "ko")).toBeNull();
  });
});

describe("buildDeepgramParams", () => {
  // ko→vi 오인식 결함 회귀 방지: detect_language를 절대 쓰지 않고 language를 명시한다.
  it("로케일을 language로 명시하고 detect_language를 쓰지 않는다", () => {
    const ko = buildDeepgramParams("ko");
    expect(ko.get("language")).toBe("ko");
    expect(ko.has("detect_language")).toBe(false);

    const en = buildDeepgramParams("en");
    expect(en.get("language")).toBe("en");
    expect(en.has("detect_language")).toBe(false);
  });
  it("외국어 로케일(es/fr/it/ja)도 language로 명시한다(nova-3 다국어)", () => {
    for (const loc of ["es", "fr", "it", "ja"] as const) {
      const p = buildDeepgramParams(loc);
      expect(p.get("language")).toBe(loc);
      expect(p.has("detect_language")).toBe(false);
    }
  });
  it("현행 nova-3 모델을 쓴다(deprecated nova-2-conversationalai 아님)", () => {
    expect(buildDeepgramParams("ko").get("model")).toBe("nova-3");
  });
});
