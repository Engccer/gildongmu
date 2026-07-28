import { describe, it, expect } from "vitest";
import {
  splitTextForChirp,
  getChirpVoice,
  CHIRP_MAX_CHUNK_BYTES,
} from "../tts/chirp";

const byteLen = (s: string) => new TextEncoder().encode(s).length;

describe("getChirpVoice", () => {
  it("6개 로케일 모두 Chirp3-HD-Puck 매핑", () => {
    expect(getChirpVoice("ko")).toEqual({ languageCode: "ko-KR", name: "ko-KR-Chirp3-HD-Puck" });
    expect(getChirpVoice("en")).toEqual({ languageCode: "en-US", name: "en-US-Chirp3-HD-Puck" });
    expect(getChirpVoice("es")).toEqual({ languageCode: "es-ES", name: "es-ES-Chirp3-HD-Puck" });
    expect(getChirpVoice("fr")).toEqual({ languageCode: "fr-FR", name: "fr-FR-Chirp3-HD-Puck" });
    expect(getChirpVoice("it")).toEqual({ languageCode: "it-IT", name: "it-IT-Chirp3-HD-Puck" });
    expect(getChirpVoice("ja")).toEqual({ languageCode: "ja-JP", name: "ja-JP-Chirp3-HD-Puck" });
  });
});

describe("splitTextForChirp", () => {
  it("한도 이하 텍스트는 단일 청크 그대로", () => {
    expect(splitTextForChirp("짧은 텍스트입니다.")).toEqual(["짧은 텍스트입니다."]);
  });

  it("공백뿐인 텍스트는 빈 배열", () => {
    expect(splitTextForChirp("   \n  ")).toEqual([]);
  });

  it("모든 청크가 byte 한도 이하 — 한국어(글자당 3 bytes) 기준", () => {
    const text = "길찾기 경로를 안내해 드릴게요. ".repeat(300); // ~12KB
    const chunks = splitTextForChirp(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(byteLen(chunk)).toBeLessThanOrEqual(CHIRP_MAX_CHUNK_BYTES);
    }
    // 내용 무손실 (분할만, 글자 변형·누락 없음)
    expect(chunks.join("")).toBe(text);
  });

  it("문장 경계에서 분할 — 청크가 문장 종결로 끝남", () => {
    const text = "첫 문장입니다. ".repeat(400);
    const chunks = splitTextForChirp(text);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("한도 초과 단일 문장은 글자 단위 강제 분할 (무손실)", () => {
    const noBoundary = "가".repeat(3000); // 9000 bytes, 문장 부호 없음
    const chunks = splitTextForChirp(noBoundary);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(byteLen(chunk)).toBeLessThanOrEqual(CHIRP_MAX_CHUNK_BYTES);
    }
    expect(chunks.join("")).toBe(noBoundary);
  });

  it("커스텀 maxBytes 적용", () => {
    const chunks = splitTextForChirp("abc. def. ghi.", 5);
    for (const chunk of chunks) {
      expect(byteLen(chunk)).toBeLessThanOrEqual(5);
    }
    expect(chunks.join("")).toBe("abc. def. ghi.");
  });
});
