import { describe, it, expect } from "vitest";
import {
  STATUS,
  parseEnvFile,
  defaultJudge,
  maskSecrets,
  daysUntil,
  formatKoreanDateTime,
  renderProbeLine,
  renderReport,
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

describe("daysUntil", () => {
  it("미래 날짜까지 남은 일수를 센다", () => {
    expect(daysUntil("2027-01-04", "2026-07-31")).toBe(157);
    expect(daysUntil("2027-06-30", "2026-07-31")).toBe(334);
  });

  it("당일은 0, 하루 뒤는 1", () => {
    expect(daysUntil("2026-07-31", "2026-07-31")).toBe(0);
    expect(daysUntil("2026-08-01", "2026-07-31")).toBe(1);
  });

  it("지난 날짜는 음수", () => {
    expect(daysUntil("2026-07-30", "2026-07-31")).toBe(-1);
  });
});

describe("formatKoreanDateTime", () => {
  it("요일을 한국어로 병기한다", () => {
    // 2026-07-31은 금요일
    const out = formatKoreanDateTime(new Date(2026, 6, 31, 21, 40));
    expect(out).toBe("2026-07-31 (금) 21:40");
  });

  it("일요일 경계를 정확히 낸다", () => {
    // 2026-08-02는 일요일
    expect(formatKoreanDateTime(new Date(2026, 7, 2, 9, 5))).toBe(
      "2026-08-02 (일) 09:05",
    );
  });
});

describe("renderProbeLine", () => {
  it("항목명과 상태를 한 문장으로 합친다", () => {
    expect(renderProbeLine({ label: "카카오 로컬", status: STATUS.OK })).toBe(
      "카카오 로컬 정상",
    );
  });

  it("수치가 있으면 같은 줄에 이어 붙인다", () => {
    expect(
      renderProbeLine({
        label: "Deepgram",
        status: STATUS.OK,
        detail: "잔액 4.21달러, 최근 30일 요청 128건",
      }),
    ).toBe("Deepgram 정상, 잔액 4.21달러, 최근 30일 요청 128건");
  });

  it("키 미설정과 조회 실패는 다른 문장을 낸다", () => {
    const missing = renderProbeLine({
      label: "Deepgram",
      status: STATUS.MISSING,
      note: "DEEPGRAM_MANAGE_KEY 미설정",
    });
    const failed = renderProbeLine({
      label: "Deepgram",
      status: STATUS.ERROR,
      detail: "HTTP 500",
    });
    expect(missing).toContain("키 미설정");
    expect(failed).toContain("조회 실패");
    expect(missing).not.toBe(failed);
  });

  it("표나 괘선 문자를 쓰지 않는다", () => {
    const line = renderProbeLine({ label: "Tmap 보행자", status: STATUS.OK });
    expect(line).not.toMatch(/[|│─┌┐└┘]/);
  });

  it("em dash를 쓰지 않는다", () => {
    const line = renderProbeLine({
      label: "Gemini",
      status: STATUS.OK,
      note: "사용량 수치는 조회 API가 없어 정보 없음",
    });
    expect(line).not.toMatch(/[–—]/);
  });
});

describe("renderReport", () => {
  const sample = {
    now: new Date(2026, 6, 31, 21, 40),
    money: [{ label: "Gemini", status: STATUS.OK }],
    availability: [{ label: "카카오 로컬", status: STATUS.OK }],
    deadlines: [{ label: "ODsay 키 만료", date: "2027-01-04", days: 157 }],
    safe: ["카카오는 유료 전환 미신청이라 초과가 과금이 아니라 오류다"],
  };

  it("네 섹션을 모두 포함한다", () => {
    const out = renderReport(sample);
    expect(out).toContain("[돈]");
    expect(out).toContain("[가용성]");
    expect(out).toContain("[시한]");
    expect(out).toContain("[걱정 불필요]");
  });

  it("헤더에 실행 시각과 요일을 넣는다", () => {
    expect(renderReport(sample)).toContain("2026-07-31 (금) 21:40");
  });

  it("시한은 남은 일수와 날짜를 한 줄에 낸다", () => {
    expect(renderReport(sample)).toContain(
      "ODsay 키 만료까지 157일 (2027-01-04)",
    );
  });

  it("빈 섹션도 제목을 유지해 정보 부재를 드러낸다", () => {
    const out = renderReport({ ...sample, deadlines: [] });
    expect(out).toContain("[시한]");
    expect(out).toContain("해당 없음");
  });
});
