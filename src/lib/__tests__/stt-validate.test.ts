import { describe, it, expect } from "vitest";
import {
  validateSttInput,
  normalizeSttLocale,
  STT_MAX_SIZE,
} from "../stt-validate";

function blob(bytes: number, type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

describe("validateSttInput", () => {
  it("정상 오디오 + ko/en locale 통과", () => {
    expect(validateSttInput(blob(100, "audio/webm"), "en")).toEqual({
      ok: true,
      locale: "en",
    });
  });
  it("빈 blob(size 0)은 empty로 거부", () => {
    expect(validateSttInput(blob(0, "audio/webm"), "ko")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
  it("Blob 아니면 missing", () => {
    expect(validateSttInput(null, "ko")).toEqual({ ok: false, reason: "missing" });
  });
  it("비-audio MIME은 bad_type으로 거부", () => {
    expect(validateSttInput(blob(100, "text/plain"), "ko")).toEqual({
      ok: false,
      reason: "bad_type",
    });
  });
  it("빈 type은 허용(브라우저 차이)", () => {
    expect(validateSttInput(blob(100, ""), "ko")).toEqual({
      ok: true,
      locale: "ko",
    });
  });
  it("5MB 초과 오디오는 too_large", () => {
    const big = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "audio/webm" });
    expect(validateSttInput(big, "ko")).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
  it("5MB 이하는 허용", () => {
    const atLimit = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: "audio/webm" });
    expect(validateSttInput(atLimit, "ko")).toEqual({
      ok: true,
      locale: "ko",
    });
  });
  it("지원 외국어 로케일(es/fr/it)은 그대로 통과(nova-3 다국어)", () => {
    expect(validateSttInput(blob(100, "audio/webm"), "fr")).toEqual({
      ok: true,
      locale: "fr",
    });
    expect(validateSttInput(blob(100, "audio/webm"), "es")).toEqual({
      ok: true,
      locale: "es",
    });
  });
  it("미지원 locale은 ko로 폴백", () => {
    expect(validateSttInput(blob(100, "audio/webm"), "ja")).toEqual({
      ok: true,
      locale: "ko",
    });
  });
});

describe("normalizeSttLocale", () => {
  it("지원 5개 언어(ko/en/es/fr/it)는 그대로", () => {
    expect(normalizeSttLocale("ko")).toBe("ko");
    expect(normalizeSttLocale("en")).toBe("en");
    expect(normalizeSttLocale("es")).toBe("es");
    expect(normalizeSttLocale("fr")).toBe("fr");
    expect(normalizeSttLocale("it")).toBe("it");
  });
  it("미지원·null은 ko 폴백", () => {
    expect(normalizeSttLocale("ja")).toBe("ko");
    expect(normalizeSttLocale(null)).toBe("ko");
    expect(normalizeSttLocale(undefined)).toBe("ko");
  });
});
