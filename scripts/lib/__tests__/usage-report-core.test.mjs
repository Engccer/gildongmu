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
import {
  runProbe,
  MONEY_PROBES,
  AVAILABILITY_PROBES,
  summarizeBalances,
  summarizeUsage,
  summarizeGeminiTokens,
  GILDONGMU_GEMINI_MODEL,
} from "../usage-probes.mjs";
import { readFileSync } from "node:fs";

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

  // 벤더 응답 본문에 개행이 섞여 실제로 줄이 쪼개진 회귀가 있었다
  it("응답 본문의 개행이 줄을 쪼개지 않는다", () => {
    const line = renderProbeLine({
      label: "공공데이터포털",
      status: STATUS.AUTH,
      detail: "HTTP 401 Unauthorized\n",
      note: "여러 서비스가 공유한다",
    });
    expect(line).not.toContain("\n");
    expect(line).toBe(
      "공공데이터포털 인증 실패, HTTP 401 Unauthorized, 여러 서비스가 공유한다",
    );
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

describe("runProbe", () => {
  const probe = {
    id: "demo",
    label: "데모",
    envKeys: ["DEMO_KEY"],
    build: (env) => ({ url: `https://example.test/?key=${env.DEMO_KEY}` }),
  };

  it("키가 없으면 호출하지 않고 키 미설정을 낸다", async () => {
    let called = false;
    const result = await runProbe(probe, {}, async () => {
      called = true;
      return new Response("", { status: 200 });
    });
    expect(called).toBe(false);
    expect(result.status).toBe(STATUS.MISSING);
  });

  // note는 키가 있을 때를 전제한 문장이다. 미설정 줄에 섞이면
  // "정상, 잔액 4.21달러, 키 없으면 콘솔..." 같은 자기모순이 낭독된다
  it("키 미설정 줄에 정상용 note를 섞지 않는다", async () => {
    const withNote = { ...probe, note: "잔액은 콘솔에서 확인" };
    const result = await runProbe(withNote, {}, async () => {
      throw new Error("호출되면 안 된다");
    });
    expect(result.status).toBe(STATUS.MISSING);
    expect(result.note).toBeUndefined();
    expect(result.detail).toContain("DEMO_KEY");
  });

  it("missingHint가 있으면 그 문장을 쓴다", async () => {
    const hinted = { ...probe, missingHint: "키를 넣으면 잔액이 나온다" };
    const result = await runProbe(hinted, {}, async () => {
      throw new Error("호출되면 안 된다");
    });
    expect(result.detail).toBe("키를 넣으면 잔액이 나온다");
  });

  it("2xx면 정상", async () => {
    const result = await runProbe(
      probe,
      { DEMO_KEY: "supersecretvalue" },
      async () => new Response("{}", { status: 200 }),
    );
    expect(result.status).toBe(STATUS.OK);
  });

  it("네트워크 예외를 조회 실패로 흡수하고 리포트를 죽이지 않는다", async () => {
    const result = await runProbe(
      probe,
      { DEMO_KEY: "supersecretvalue" },
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
    );
    expect(result.status).toBe(STATUS.ERROR);
    expect(result.detail).toContain("ECONNREFUSED");
  });

  it("오류 상세에 키 값이 새지 않는다", async () => {
    const result = await runProbe(
      probe,
      { DEMO_KEY: "supersecretvalue" },
      async () => {
        throw new Error("failed on https://example.test/?key=supersecretvalue");
      },
    );
    expect(result.detail).not.toContain("supersecretvalue");
    expect(result.detail).toContain("***");
  });

  it("응답 본문이 상세에 실려도 키가 마스킹된다", async () => {
    const result = await runProbe(
      probe,
      { DEMO_KEY: "supersecretvalue" },
      async () =>
        new Response("bad request for key=supersecretvalue", { status: 400 }),
    );
    expect(result.status).toBe(STATUS.ERROR);
    expect(result.detail).not.toContain("supersecretvalue");
  });

  it("프로브의 judge가 기본 판정을 덮어쓴다", async () => {
    const perplexityLike = {
      ...probe,
      judge: ({ httpStatus }) =>
        httpStatus === 400 ? STATUS.OK : defaultJudge({ httpStatus }),
    };
    const result = await runProbe(
      perplexityLike,
      { DEMO_KEY: "supersecretvalue" },
      async () => new Response("invalid_model", { status: 400 }),
    );
    expect(result.status).toBe(STATUS.OK);
  });
});

// 아래 본문은 무효 키를 실제로 넣어 받은 응답이다(2026-07-31 변이 주입).
// judge가 없으면 넷 다 HTTP 200이라 "정상"으로 거짓 보고된다.
describe("200에 오류를 담는 벤더 판정", () => {
  const findProbe = (id) =>
    [...MONEY_PROBES, ...AVAILABILITY_PROBES].find((p) => p.id === id);

  const cases = [
    {
      id: "seoul-subway",
      ok: '{"errorMessage":{"status":200,"code":"INFO-000","message":"정상 처리되었습니다.","total":4}}',
      bad: '{"status":500,"code":"INFO-100","message":"인증키가 유효하지 않습니다."}',
    },
    {
      id: "seoul-bike",
      ok: '{"rentBikeStatus":{"list_total_count":5,"RESULT":{"CODE":"INFO-000","MESSAGE":"정상 처리되었습니다."}}}',
      // 오류일 때만 XML로 답한다
      bad: "<RESULT><CODE>INFO-100</CODE><MESSAGE>인증키가 유효하지 않습니다.</MESSAGE></RESULT>",
    },
    {
      id: "juso",
      ok: '{"results":{"common":{"errorCode":"0","errorMessage":"정상","totalCount":"1098"}}}',
      bad: '{"results":{"common":{"errorCode":"E0001","errorMessage":"승인되지 않은 KEY 입니다."}}}',
    },
    {
      id: "odsay",
      ok: '{"result":{"searchType":0,"busCount":10,"subwayCount":1}}',
      bad: '{"error":[{"code":"500","message":"[ApiKeyAuthFailed] ApiKey authentication failed."}]}',
    },
  ];

  for (const { id, ok, bad } of cases) {
    it(`${id}는 정상 본문을 정상으로 읽는다`, () => {
      const judge = findProbe(id).judge;
      expect(judge({ httpStatus: 200, bodyText: ok })).toBe(STATUS.OK);
    });

    it(`${id}는 200이어도 무효 키 본문을 인증 실패로 잡는다`, () => {
      const judge = findProbe(id).judge;
      expect(judge({ httpStatus: 200, bodyText: bad })).toBe(STATUS.AUTH);
    });
  }

  it("공공데이터포털은 resultCode가 00일 때만 정상", () => {
    const judge = findProbe("data-go-kr").judge;
    expect(
      judge({
        httpStatus: 200,
        bodyText:
          '{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."}}}',
      }),
    ).toBe(STATUS.OK);
    expect(
      judge({
        httpStatus: 200,
        bodyText: '{"response":{"header":{"resultCode":"30"}}}',
      }),
    ).toBe(STATUS.ERROR);
  });
});

describe("Deepgram 응답 요약", () => {
  it("잔액이 여러 건이면 합산한다", () => {
    const body = JSON.stringify({
      balances: [
        { amount: 197.57, units: "usd", purchase_order_id: "a" },
        { amount: 2.43, units: "usd", purchase_order_id: "b" },
      ],
    });
    expect(summarizeBalances(body)).toBe("200.00달러");
  });

  // 라벨이 "Deepgram 잔액"이라 값에서 반복하면 "잔액 정상, 잔액 197달러"가 된다
  it("값에 라벨 단어를 반복하지 않는다", () => {
    expect(summarizeBalances('{"balances":[{"amount":197.57}]}')).toBe(
      "197.57달러",
    );
  });

  it("잔액이 없으면 0으로 낸다(조회 실패와 구분된다)", () => {
    expect(summarizeBalances('{"balances":[]}')).toBe("0.00달러");
  });

  // 실제 응답은 일별 배열이라 창 전체를 합산해야 한다(2026-07-31 실호출)
  it("사용량 일별 배열을 합산한다", () => {
    const body = JSON.stringify({
      start: "2026-07-01",
      end: "2026-07-31",
      results: [
        { start: "2026-07-01", requests: 1, total_hours: 0.0020916666 },
        { start: "2026-07-02", requests: 1, total_hours: 1.14735 },
        { start: "2026-07-04", requests: 15, total_hours: 0.0341586 },
      ],
    });
    expect(summarizeUsage(body)).toBe("최근 30일 요청 17건, 음성 1.2시간");
  });

  it("본문이 JSON이 아니면 undefined를 내 상태 판정에 맡긴다", () => {
    expect(summarizeBalances("<html>")).toBeUndefined();
    expect(summarizeUsage("<html>")).toBeUndefined();
  });
});

// CLI/MCP 버전 4곳 동조 함정과 같은 구조다. 모델을 교체하고 여기를 잊으면
// 리포트가 오류 없이 0토큰을 보고한다("사용량 없음"으로 보이는 최악의 실패).
describe("Gemini 모델명 drift", () => {
  it("리포트 상수가 client.ts의 GEMINI_MODEL과 일치한다", () => {
    const source = readFileSync("src/lib/gemini/client.ts", "utf8");
    const match = source.match(/GEMINI_MODEL\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(GILDONGMU_GEMINI_MODEL).toBe(match[1]);
  });
});

describe("Gemini 토큰 요약", () => {
  // 프로젝트가 길동무 전용이라 시계열을 전량 합산한다(모델 필터 없음)
  const body = JSON.stringify({
    timeSeries: [
      {
        metric: {
          labels: { model: "gemini-3.6-flash", thinking_enabled: "true" },
        },
        points: [{ value: { int64Value: "91978" } }],
      },
      {
        metric: {
          labels: { model: "gemini-3.6-flash", thinking_enabled: "false" },
        },
        points: [{ value: { int64Value: "22" } }],
      },
    ],
  });

  it("출력 토큰을 합산해 비용을 계산한다", () => {
    // 프로모 기간(~2026-12-31): 92,000 / 1M * $3.75 = $0.345 → 표기 $0.34
    const out = summarizeGeminiTokens(body, Date.UTC(2026, 7, 15));
    expect(out).toContain("출력 92,000토큰");
    expect(out).toContain("0.34달러");
  });

  // 단가는 날짜의 함수다 — 경계를 넘기면 두 배가 되어야 한다
  it("프로모 종료 후에는 두 배 단가를 쓴다", () => {
    // 92,000 / 1M * $7.50 = $0.69
    expect(summarizeGeminiTokens(body, Date.UTC(2027, 0, 1))).toContain("0.69달러");
  });

  // 모델을 교체해도 집계가 멈추면 안 된다(필터를 되살리면 이 테스트가 깨진다)
  it("모델 이름과 무관하게 전량 합산한다", () => {
    const future = JSON.stringify({
      timeSeries: [
        {
          metric: { labels: { model: "gemini-9.9-flash" } },
          points: [{ value: { int64Value: "1000" } }],
        },
      ],
    });
    expect(summarizeGeminiTokens(future)).toContain("출력 1,000토큰");
  });

  // 입력 토큰 메트릭이 없어 이 값은 하한이다. 표기가 사라지면 과소 보고가 사실로 읽힌다
  it("출력 기준임을 반드시 표기한다", () => {
    expect(summarizeGeminiTokens(body)).toContain("출력 기준");
  });

  it("빈 시계열은 0으로 낸다", () => {
    expect(summarizeGeminiTokens('{"timeSeries":[]}')).toContain("0토큰");
  });
});

describe("프로브 카탈로그", () => {
  it("모든 프로브가 label과 envKeys와 build를 갖는다", () => {
    for (const probe of [...MONEY_PROBES, ...AVAILABILITY_PROBES]) {
      expect(typeof probe.label).toBe("string");
      expect(Array.isArray(probe.envKeys)).toBe(true);
      expect(typeof probe.build).toBe("function");
    }
  });

  it("id가 중복되지 않는다", () => {
    const ids = [...MONEY_PROBES, ...AVAILABILITY_PROBES].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
