import { describe, it, expect } from "vitest";
import { parseDeepgramTranscript } from "../deepgram";

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
