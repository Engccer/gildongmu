import { describe, it, expect } from "vitest";
import {
  STATUS,
  parseEnvFile,
  defaultJudge,
  maskSecrets,
} from "../usage-report-core.mjs";

describe("parseEnvFile", () => {
  it("KEY=VALUE 줄을 읽고 주석과 빈 줄을 무시한다", () => {
    const text = [
      "# 주석",
      "",
      "FOO=bar",
      "BAZ = qux ",
      'QUOTED="has space"',
      "EMPTY=",
    ].join("\n");
    expect(parseEnvFile(text)).toEqual({
      FOO: "bar",
      BAZ: "qux",
      QUOTED: "has space",
      EMPTY: "",
    });
  });

  it("값에 등호가 있어도 첫 등호에서만 자른다", () => {
    expect(parseEnvFile("KEY=a=b=c")).toEqual({ KEY: "a=b=c" });
  });
});

describe("defaultJudge", () => {
  it("2xx는 정상", () => {
    expect(defaultJudge({ httpStatus: 200, bodyText: "{}" })).toBe(STATUS.OK);
  });

  it("401과 403은 인증 실패", () => {
    expect(defaultJudge({ httpStatus: 401, bodyText: "" })).toBe(STATUS.AUTH);
    expect(defaultJudge({ httpStatus: 403, bodyText: "" })).toBe(STATUS.AUTH);
  });

  it("429는 쿼터 초과", () => {
    expect(defaultJudge({ httpStatus: 429, bodyText: "" })).toBe(STATUS.QUOTA);
  });

  // 이 스위트의 핵심. 미분류가 정상으로 새면 리포트 전체가 거짓말이 된다
  it("미분류 응답을 정상으로 뭉개지 않는다", () => {
    for (const code of [0, 302, 400, 404, 418, 500, 502, 503]) {
      expect(defaultJudge({ httpStatus: code, bodyText: "" })).toBe(
        STATUS.ERROR,
      );
    }
  });
});

describe("maskSecrets", () => {
  it("시크릿 값을 별표로 가린다", () => {
    const out = maskSecrets("url?key=abcd1234efgh", ["abcd1234efgh"]);
    expect(out).toBe("url?key=***");
    expect(out).not.toContain("abcd1234efgh");
  });

  it("여러 시크릿을 모두 가린다", () => {
    const out = maskSecrets("a=SEC1value b=SEC2value", [
      "SEC1value",
      "SEC2value",
    ]);
    expect(out).not.toContain("SEC1value");
    expect(out).not.toContain("SEC2value");
  });

  it("같은 시크릿이 여러 번 나와도 전부 가린다", () => {
    const out = maskSecrets("k=TOPSECRET k=TOPSECRET", ["TOPSECRET"]);
    expect(out).toBe("k=*** k=***");
  });

  it("짧은 값은 오탐이 되므로 가리지 않는다", () => {
    expect(maskSecrets("the cat sat", ["cat"])).toBe("the cat sat");
  });

  it("빈 값과 undefined는 무시한다", () => {
    expect(maskSecrets("hello", ["", undefined, null])).toBe("hello");
  });
});
