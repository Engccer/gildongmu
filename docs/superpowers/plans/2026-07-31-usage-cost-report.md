# 과금·쿼터 상태 리포트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 벤더 콘솔 6곳 순회를 `node scripts/usage-report.mjs` 명령 한 줄로 대체하는 로컬 전용 텍스트 리포트를 만든다.

**Architecture:** 순수 판정 계층(`scripts/lib/usage-report-core.mjs`)과 프로브 카탈로그(`scripts/lib/usage-probes.mjs`)를 분리하고, 진입점(`scripts/usage-report.mjs`)이 `.env.local`을 읽어 전 프로브를 병렬 실행한 뒤 렌더한다. 앱 코드·서버 라우트·배포 설정은 건드리지 않는다. 판정 계층만 vitest로 테스트하고 프로브 실호출은 수동 게이트다.

**Tech Stack:** Node 내장 `fetch`·`node:fs`만 사용(외부 의존성 0), Vitest(기존 레인에 `scripts/**` 추가)

**설계 정본:** `docs/superpowers/specs/2026-07-31-usage-cost-report-design.md`

## Global Constraints

- **외부 의존성 0.** `package.json`에 패키지를 추가하지 않는다. Node 내장 모듈과 전역 `fetch`만 쓴다.
- **유료 API 프로브는 무과금 경로만.** Gemini는 모델 목록, Perplexity는 무효 모델 400 유도, Deepgram은 프로젝트 목록. 채팅·검색·전사 엔드포인트를 프로브로 쓰지 않는다.
- **fail-closed.** 관측되지 않은 응답은 `정상`이 아니라 `조회 실패`로 떨어뜨린다.
- **키 값은 출력·오류 메시지에 절대 노출 금지.** 모든 출력은 마스킹 함수를 통과한다.
- **출력은 평문 문장.** 표·괘선·좌우 정렬·이모지 금지. 한 줄에 한 사실을 담고 항목명·상태·수치를 한 문장으로 합친다(스크린 리더 낭독 요구).
- **em dash(`—`)·en dash(`–`) 금지.** 코드 주석·문서·출력 문자열 전부 해당. 범위는 물결표, 연결은 가운뎃점.
- **주석·커밋 메시지는 한국어, 변수·함수명은 영어.**
- 커밋 이메일 `engccer@gmail.com`. `git add -A` 금지, 의도 파일만 stage한다.
- 리포트는 로컬 전용이다. Vercel env에 새 키를 등록하지 않고 웹 라우트를 만들지 않는다.

## File Structure

| 파일 | 책임 |
|---|---|
| `scripts/lib/usage-report-core.mjs` | 순수 함수. env 파싱·응답 분류·D-day·마스킹·문장 렌더. I/O 없음 |
| `scripts/lib/__tests__/usage-report-core.test.mjs` | 위 모듈의 계약 테스트 |
| `scripts/lib/usage-probes.mjs` | 프로브 카탈로그. 벤더별 요청 URL·헤더·판정 override·콘솔 URL |
| `scripts/usage-report.mjs` | 진입점. 파일 읽기·병렬 fetch·표준출력 |
| `vitest.config.ts` | `include`에 `scripts/**/*.test.mjs` 추가 (수정) |

I/O는 진입점 한 곳에만 둔다. 판정 계층이 순수해야 테스트가 검출력을 갖는다.

---

### Task 1: 판정 코어 (env 파싱·분류·마스킹)

**Files:**
- Create: `scripts/lib/usage-report-core.mjs`
- Create: `scripts/lib/__tests__/usage-report-core.test.mjs`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces:
  - `STATUS` 객체: `{ OK: "정상", QUOTA: "쿼터 초과", AUTH: "인증 실패", ERROR: "조회 실패", MISSING: "키 미설정" }`
  - `parseEnvFile(text: string) => Record<string, string>`
  - `defaultJudge({ httpStatus: number, bodyText: string }) => string` (STATUS 값 반환)
  - `maskSecrets(text: string, secrets: string[]) => string`

- [ ] **Step 1: vitest include 확장**

`vitest.config.ts`의 `include` 배열에 한 줄 추가한다.

```ts
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
```

- [ ] **Step 2: 실패하는 테스트 작성**

`scripts/lib/__tests__/usage-report-core.test.mjs`:

```js
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

  // 아래 값들은 8자 이상이어야 한다. maskSecrets는 짧은 값을 오탐으로 보고 건너뛴다
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
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: FAIL, 모듈을 찾을 수 없다는 오류

- [ ] **Step 4: 최소 구현**

`scripts/lib/usage-report-core.mjs`:

```js
// 과금·쿼터 리포트의 순수 판정 계층. I/O 없음(테스트 검출력 유지)

/** 프로브 결과 5-state. 서로 절대 뭉개지 않는다 */
export const STATUS = {
  OK: "정상",
  QUOTA: "쿼터 초과",
  AUTH: "인증 실패",
  ERROR: "조회 실패",
  MISSING: "키 미설정",
};

/** .env.local 형식을 읽는다. dotenv 의존성을 피하려는 최소 구현 */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * HTTP 상태만으로 내리는 기본 판정.
 * 벤더별 예외(200인데 body가 오류인 경우 등)는 프로브의 judge가 덮어쓴다.
 * 미분류는 fail-closed로 ERROR에 떨어뜨린다.
 */
export function defaultJudge({ httpStatus }) {
  if (httpStatus === 401 || httpStatus === 403) return STATUS.AUTH;
  if (httpStatus === 429) return STATUS.QUOTA;
  if (httpStatus >= 200 && httpStatus < 300) return STATUS.OK;
  return STATUS.ERROR;
}

const MIN_SECRET_LENGTH = 8;

/** 출력 직전 모든 문자열이 통과한다. 벤더가 요청 URL을 되돌려주면 키가 실린다 */
export function maskSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets ?? []) {
    if (typeof secret !== "string") continue;
    if (secret.length < MIN_SECRET_LENGTH) continue;
    out = out.split(secret).join("***");
  }
  return out;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: PASS (모든 케이스)

- [ ] **Step 6: 기존 테스트 회귀 없음 확인**

Run: `npm run test:run`
Expected: 기존 테스트 전부 PASS. `include` 확장이 다른 스위트를 깨지 않았는지 본다.

- [ ] **Step 7: 커밋**

```bash
git add scripts/lib/usage-report-core.mjs scripts/lib/__tests__/usage-report-core.test.mjs vitest.config.ts
git commit -m "feat(scripts): 과금 리포트 판정 코어 (env 파싱·5-state 분류·시크릿 마스킹)"
```

---

### Task 2: 시한 계산과 문장 렌더

**Files:**
- Modify: `scripts/lib/usage-report-core.mjs`
- Modify: `scripts/lib/__tests__/usage-report-core.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `STATUS`, `maskSecrets`
- Produces:
  - `daysUntil(targetISO: string, todayISO: string) => number`
  - `formatKoreanDateTime(date: Date) => string` (예: `2026-07-31 (금) 21:40`)
  - `renderProbeLine({ label, status, detail?, note? }) => string`
  - `renderReport({ now, money, availability, deadlines, safe }) => string`

- [ ] **Step 1: 실패하는 테스트 추가**

`scripts/lib/__tests__/usage-report-core.test.mjs` 하단에 추가한다. import 줄에 새 이름 4개를 더한다.

```js
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: FAIL, `daysUntil is not a function` 계열 오류

- [ ] **Step 3: 구현 추가**

`scripts/lib/usage-report-core.mjs` 하단에 이어 붙인다.

```js
const DAY_MS = 24 * 60 * 60 * 1000;
const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 두 날짜의 일수 차. 코드가 계산하므로 결정론적이다(모델 추론 금지 규칙의 취지) */
export function daysUntil(targetISO, todayISO) {
  const target = Date.parse(`${targetISO}T00:00:00Z`);
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 리포트 헤더용. 요일은 Date에서 뽑으므로 병기 검증이 자동 성립한다 */
export function formatKoreanDateTime(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const w = KOREAN_WEEKDAYS[date.getDay()];
  return `${y}-${m}-${d} (${w}) ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 한 줄 = 한 사실. 항목명·상태·수치를 별도 열로 흩지 않는다(스크린 리더 요구) */
export function renderProbeLine({ label, status, detail, note }) {
  const parts = [`${label} ${status}`];
  if (detail) parts.push(detail);
  if (note) parts.push(note);
  return parts.join(", ");
}

function renderSection(title, lines) {
  const body = lines.length > 0 ? lines : ["해당 없음"];
  return [`[${title}]`, ...body].join("\n");
}

export function renderReport({ now, money, availability, deadlines, safe }) {
  const header = `길동무 과금·쿼터 리포트  ${formatKoreanDateTime(now)}`;
  const sections = [
    renderSection("돈", money.map(renderProbeLine)),
    renderSection("가용성", availability.map(renderProbeLine)),
    renderSection(
      "시한",
      deadlines.map((d) => `${d.label}까지 ${d.days}일 (${d.date})`),
    ),
    renderSection("걱정 불필요", safe),
  ];
  return [header, "", ...sections.flatMap((s) => [s, ""])].join("\n").trimEnd();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/lib/usage-report-core.mjs scripts/lib/__tests__/usage-report-core.test.mjs
git commit -m "feat(scripts): 리포트 시한 계산과 스크린 리더용 문장 렌더"
```

---

### Task 3: 확정 프로브 4종과 진입점

스펙 §5에서 실호출로 확정한 4종(Gemini·Perplexity·Deepgram·Vercel)만 배선해 리포트를 실제로 돌린다. 미확정 9종은 Task 4에서 실호출로 확정한 뒤 추가한다.

**Files:**
- Create: `scripts/lib/usage-probes.mjs`
- Create: `scripts/usage-report.mjs`
- Modify: `scripts/lib/__tests__/usage-report-core.test.mjs`

**Interfaces:**
- Consumes: Task 1~2의 `STATUS`, `defaultJudge`, `maskSecrets`, `renderReport`
- Produces:
  - `MONEY_PROBES`, `AVAILABILITY_PROBES`: 프로브 배열. 각 항목은
    `{ id, label, envKeys: string[], build(env) => { url, init? }, judge?({ httpStatus, bodyText }) => string, describe?({ bodyText }) => string, note? }`
  - `DEADLINES`: `{ label, date }[]`
  - `SAFE_NOTES`: `string[]`
  - `runProbe(probe, env, fetchImpl) => Promise<{ label, status, detail?, note? }>`

- [ ] **Step 1: 프로브 실행기 테스트 작성**

`scripts/lib/__tests__/usage-report-core.test.mjs` 하단에 추가한다. 프로브 실행기는 `fetch`를 주입받으므로 테스트에서 네트워크를 타지 않는다.

```js
import { runProbe, MONEY_PROBES, AVAILABILITY_PROBES } from "../usage-probes.mjs";

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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: FAIL, `usage-probes.mjs`를 찾을 수 없음

- [ ] **Step 3: 프로브 카탈로그 구현**

`scripts/lib/usage-probes.mjs`:

```js
// 프로브 카탈로그. 유료 API는 무과금 경로만 쓴다(스펙 §3.3 실호출 확정)
import { STATUS, defaultJudge, maskSecrets } from "./usage-report-core.mjs";

const DEEPGRAM_PROJECT_ID = "9fe1af22-f34f-490f-9ecd-d6855e52c7d6";

export const MONEY_PROBES = [
  {
    id: "gemini",
    label: "Gemini",
    envKeys: ["GEMINI_API_KEY"],
    build: (env) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${env.GEMINI_API_KEY}`,
    }),
    note: "사용량 수치는 조회 API가 없어 정보 없음. 콘솔 aistudio.google.com",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    envKeys: ["PERPLEXITY_API_KEY"],
    // 무효 모델을 넣어 400을 유도한다. 모델 검증이 과금보다 앞이라 비용 0
    build: (env) => ({
      url: "https://api.perplexity.ai/chat/completions",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "__invalid__", messages: [] }),
      },
    }),
    judge: ({ httpStatus, bodyText }) => {
      if (httpStatus === 400 && bodyText.includes("invalid_model")) {
        return STATUS.OK;
      }
      return defaultJudge({ httpStatus });
    },
    note: "잔액은 조회 API가 없어 정보 없음. 콘솔 console.perplexity.ai",
  },
  {
    id: "deepgram-usage",
    label: "Deepgram",
    envKeys: ["DEEPGRAM_MANAGE_KEY"],
    build: (env) => ({
      url: `https://api.deepgram.com/v1/projects/${DEEPGRAM_PROJECT_ID}/balances`,
      init: { headers: { Authorization: `Token ${env.DEEPGRAM_MANAGE_KEY}` } },
    }),
    describe: ({ bodyText }) => {
      try {
        const balances = JSON.parse(bodyText).balances ?? [];
        const total = balances.reduce((sum, b) => sum + (b.amount ?? 0), 0);
        return `잔액 ${total.toFixed(2)}달러`;
      } catch {
        return undefined;
      }
    },
    note: "키 없으면 콘솔 console.deepgram.com",
  },
];

export const AVAILABILITY_PROBES = [
  {
    id: "vercel",
    label: "Vercel 팀",
    envKeys: ["VERCEL_TOKEN"],
    build: (env) => ({
      url: "https://api.vercel.com/v2/teams",
      init: { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } },
    }),
    note: "Hobby라 과금 축 없음",
  },
];

export const DEADLINES = [
  { label: "ODsay 키 만료", date: "2027-01-04" },
  { label: "네이버 API Hub 이관", date: "2027-06-30" },
  { label: "Apple 배포 인증서 만료", date: "2027-07-18" },
];

export const SAFE_NOTES = [
  "카카오는 유료 전환 미신청이라 쿼터 초과가 과금이 아니라 오류이고 Tmap으로 폴백한다",
  "Vercel은 Hobby라 한도 초과 시 과금 대신 프로젝트 일시정지이며 스펜드 알림은 Pro 전용이라 설정 대상이 아니다",
  "juso와 서울 열린데이터와 공공데이터포털은 무료이고 쿼터 상태는 가용성 섹션이 담당한다",
];

const TIMEOUT_MS = 10_000;

/** 프로브 1건 실행. 어떤 실패도 예외로 새어 나가지 않는다(리포트 전체 보호) */
export async function runProbe(probe, env, fetchImpl = fetch) {
  const secrets = probe.envKeys.map((k) => env[k]).filter(Boolean);
  const missing = probe.envKeys.filter((k) => !env[k]);
  if (missing.length > 0) {
    return {
      label: probe.label,
      status: STATUS.MISSING,
      detail: `${missing.join(", ")} 미설정`,
      note: probe.note,
    };
  }

  const { url, init } = probe.build(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const bodyText = await res.text();
    const judge = probe.judge ?? defaultJudge;
    const status = judge({ httpStatus: res.status, bodyText });
    const detail =
      status === STATUS.OK
        ? probe.describe?.({ bodyText })
        : maskSecrets(`HTTP ${res.status} ${bodyText.slice(0, 200)}`, secrets);
    return { label: probe.label, status, detail, note: probe.note };
  } catch (error) {
    return {
      label: probe.label,
      status: STATUS.ERROR,
      detail: maskSecrets(String(error?.message ?? error), secrets),
      note: probe.note,
    };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run scripts/lib/__tests__/usage-report-core.test.mjs`
Expected: PASS

- [ ] **Step 5: 진입점 구현**

`scripts/usage-report.mjs`:

```js
#!/usr/bin/env node
// 길동무 과금·쿼터 상태 리포트. 로컬 전용, 외부 의존성 0
// 실행: node scripts/usage-report.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEnvFile, daysUntil, renderReport } from "./lib/usage-report-core.mjs";
import {
  MONEY_PROBES,
  AVAILABILITY_PROBES,
  DEADLINES,
  SAFE_NOTES,
  runProbe,
} from "./lib/usage-probes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    return parseEnvFile(readFileSync(path.join(repoRoot, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const now = new Date();

  const [money, availability] = await Promise.all([
    Promise.all(MONEY_PROBES.map((p) => runProbe(p, env))),
    Promise.all(AVAILABILITY_PROBES.map((p) => runProbe(p, env))),
  ]);

  const today = toISODate(now);
  const deadlines = DEADLINES.map((d) => ({
    ...d,
    days: daysUntil(d.date, today),
  }));

  process.stdout.write(
    `${renderReport({ now, money, availability, deadlines, safe: SAFE_NOTES })}\n`,
  );
}

main();
```

`runProbe`가 모든 실패를 흡수하므로 `Promise.all`이 거부되지 않는다. 그래도 `allSettled`가 아닌 이유를 아는 것이 중요하다. 실패 흡수 책임은 프로브 실행기 한 곳에 있고, 진입점은 그것을 신뢰한다.

- [ ] **Step 6: 실제 실행**

Run: `node scripts/usage-report.mjs`
Expected: 4개 섹션이 출력된다. Gemini·Perplexity는 `정상`, Deepgram은 `키 미설정`(스펙 §9 선행 작업 전이므로 정상 동작), Vercel은 `VERCEL_TOKEN` 미설정이면 `키 미설정`.

출력에 키 문자열이 없는지 눈으로 확인한다:

```bash
node scripts/usage-report.mjs | grep -c "$(grep '^GEMINI_API_KEY' .env.local | cut -d= -f2)"
```
Expected: `0` (키가 출력에 없음)

- [ ] **Step 7: 커밋**

```bash
git add scripts/lib/usage-probes.mjs scripts/usage-report.mjs scripts/lib/__tests__/usage-report-core.test.mjs
git commit -m "feat(scripts): 확정 프로브 4종과 리포트 진입점"
```

---

### Task 4: 미확정 프로브 실호출 확정과 카탈로그 확장

스펙 §5의 미확정 9종을 하나씩 실호출해 정상 응답 형태를 확인하고 카탈로그에 추가한다. **추정으로 코드를 쓰지 않는다.** 확인한 것만 넣고, 확인하지 못한 것은 카탈로그에서 빼고 그 사실을 PROGRESS에 남긴다.

**Files:**
- Modify: `scripts/lib/usage-probes.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 3의 `AVAILABILITY_PROBES` 배열 구조
- Produces: 확장된 `AVAILABILITY_PROBES`

- [ ] **Step 1: 각 API 실호출로 정상 응답 확인**

아래를 하나씩 실행해 HTTP 상태와 본문 형태를 기록한다. 각 호출은 해당 API의 일일 쿼터 1건을 소모한다(일 1,000건 중 1건이라 수용).

```bash
set -a && . ./.env.local && set +a

# 카카오 로컬
curl -s -o /dev/null -w "kakao-local %{http_code}\n" \
  -H "Authorization: KakaoAK $KAKAO_REST_API_KEY" \
  "https://dapi.kakao.com/v2/local/search/keyword.json?query=강동역&size=1"

# 카카오 도보
curl -s -w "\nkakao-walk %{http_code}\n" \
  -H "Authorization: KakaoAK $KAKAO_REST_API_KEY" \
  "https://dapi.kakao.com/v2/routing/walk?origin=127.1234,37.5350&destination=127.1300,37.5400" | head -c 200

# Tmap 보행자
curl -s -o /dev/null -w "tmap %{http_code}\n" -X POST \
  -H "appKey: $TMAP_APP_KEY" -H "Content-Type: application/json" \
  -d '{"startX":"127.1234","startY":"37.5350","endX":"127.1300","endY":"37.5400","startName":"a","endName":"b"}' \
  "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"

# juso 주소
curl -s -w "\njuso %{http_code}\n" \
  "https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=$JUSO_CONFM_KEY&currentPage=1&countPerPage=1&keyword=성내로&resultType=json" | head -c 200

# 네이버 지역검색
curl -s -o /dev/null -w "naver %{http_code}\n" \
  -H "X-Naver-Client-Id: $NAVER_LOCAL_CLIENT_ID" -H "X-Naver-Client-Secret: $NAVER_LOCAL_CLIENT_SECRET" \
  "https://openapi.naver.com/v1/search/local.json?query=강동역&display=1"
```

ODsay·서울 실시간 지하철·서울 버스·data.go.kr·NCP·Cloud TTS도 같은 방식으로 확인한다. 정확한 URL은 각 provider 파일(`src/lib/providers/*.ts`)의 기존 구현에서 가져온다. 새 경로를 발명하지 않는다.

**중요:** ODsay는 서버 fetch에 `Referer: https://gildongmu.vercel.app/` 헤더가 필요하다(키가 URI에 묶여 있음). 로컬 curl에도 같은 헤더를 붙여야 한다.

- [ ] **Step 2: 200이어도 본문이 오류인 벤더를 식별**

data.go.kr 계열과 서울 열린데이터는 HTTP 200에 오류 코드를 본문에 담는다. 각각의 정상 판정 조건을 기록한다.

- 에어코리아·TAGO: `response.header.resultCode === "00"`
- 서울 버스(TOPIS): `msgHeader.headerCd`가 `0`(정상) 또는 `4`(빈 결과)
- 서울 지하철 실시간: `errorMessage.code` 또는 최상위 `code`

이들은 `judge`를 반드시 붙여야 한다. 기본 판정만 쓰면 오류를 `정상`으로 보고한다.

- [ ] **Step 3: 확인된 것만 카탈로그에 추가**

`scripts/lib/usage-probes.mjs`의 `AVAILABILITY_PROBES`에 추가한다. 카카오 로컬 예시:

```js
  {
    id: "kakao-local",
    label: "카카오 로컬",
    envKeys: ["KAKAO_REST_API_KEY"],
    build: (env) => ({
      url: "https://dapi.kakao.com/v2/local/search/keyword.json?query=강동역&size=1",
      init: { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` } },
    }),
  },
```

200에 오류 본문을 담는 벤더는 `judge`를 붙인다. 서울 버스 예시:

```js
  {
    id: "seoul-bus",
    label: "서울 버스",
    envKeys: ["DATA_GO_KR_API_KEY"],
    build: (env) => ({ url: "..." }),
    judge: ({ httpStatus, bodyText }) => {
      if (httpStatus !== 200) return defaultJudge({ httpStatus });
      // headerCd 0은 정상, 4는 빈 결과(정상 동작), 그 외는 판정 불가
      const match = bodyText.match(/"headerCd"\s*:\s*"?(\d+)"?/);
      if (!match) return STATUS.ERROR;
      return match[1] === "0" || match[1] === "4" ? STATUS.OK : STATUS.ERROR;
    },
  },
```

- [ ] **Step 4: 카탈로그 계약 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS. Task 3의 "id 중복 없음", "필수 필드 보유" 테스트가 새 항목에도 적용된다.

- [ ] **Step 5: 전체 리포트 실행과 눈 검증**

Run: `node scripts/usage-report.mjs`

확인 항목:
1. 가용성 섹션의 모든 항목이 `정상`인가. `조회 실패`가 있으면 그 벤더의 판정 규칙이 틀린 것이다(실제 장애가 아닌 한).
2. 출력에 키 문자열이 없는가.
3. 표·괘선·이모지·em dash가 없는가.
4. 전체 실행 시간이 15초 이내인가.

- [ ] **Step 6: PROGRESS.md 갱신**

`## 미해결·보류` 섹션에 항목을 추가하고, Phase 0 항목의 잔여 문구를 정정한다.

Phase 0 항목 끝의 `**위원장 콘솔 작업 잔여**: 유료 3종(Google AI Studio·Perplexity·Deepgram)+Vercel 스펜드 알림 설정.`을 다음으로 교체한다:

```
**위원장 콘솔 작업 잔여**: 유료 3종(Google AI Studio·Perplexity·Deepgram) 확인은 과금·쿼터 리포트(`scripts/usage-report.mjs`, 2026-07-31)로 대체. ~~Vercel 스펜드 알림 설정~~(**수행 불가이자 수행 불요로 종결 2026-07-31**: 팀이 Hobby라 Spend Management는 Pro 전용이고, Hobby는 한도 초과 시 과금이 아니라 프로젝트 자동 일시정지라 비용 위험이 구조적으로 0. 실측 `GET /v2/teams` plan="hobby", `/v1/billing/charges` 404 costs_not_found).
```

새 항목을 추가한다:

```
- **과금·쿼터 상태 리포트 1단계(2026-07-31, ✅ 구현 완료)**: 스펙 `docs/superpowers/specs/2026-07-31-usage-cost-report-design.md`, 플랜 `docs/superpowers/plans/2026-07-31-usage-cost-report.md`. `node scripts/usage-report.mjs`가 돈·가용성·시한·걱정불필요 4섹션을 평문 문장으로 출력(로컬 전용, 외부 의존성 0, 앱 코드 무변경). **착수 게이트 실호출 3건**: ① Vercel Hobby 확정(위 Phase 0 정정) ② Deepgram usage/balances는 STT 키로 403이라 `usage:read`+`billing:read` 스코프 키 별도 발급 필요(`DEEPGRAM_MANAGE_KEY`, 로컬 전용·Vercel 미등록) ③ 유료 무과금 프로브 확정: Gemini `GET /v1beta/models` 200, Perplexity는 무효 모델 400(`invalid_model`) vs 무효 키 401 대조로 키 유효성만 무과금 판정. **벤더 API로 채울 칸이 Deepgram 하나뿐**이라 "얼마나 남았나" 대신 프로브로 "지금 살아 있나"를 실측하는 5-state(정상·쿼터 초과·인증 실패·조회 실패·키 미설정)를 채택. 미분류를 정상으로 뭉개지 않는 fail-closed가 테스트로 못 박혀 있다. **2단계(자체 계측) 승격 기준**(스펙 §10): 월 지출 10달러 초과 / 유료 4칸 중 2칸 이상 지속 정보 없음 / 쿼터 초과 1회 이상 관측 중 하나. ⚠ Hobby 런타임 로그 보존 1시간이라 2단계는 외부 저장소 필수(로그 집계 불가).
```

- [ ] **Step 7: 커밋**

```bash
git add scripts/lib/usage-probes.mjs PROGRESS.md
git commit -m "feat(scripts): 국내 API 프로브 확장과 PROGRESS 갱신 (Vercel 스펜드 알림 항목 종결)"
```

---

## 실행 후 위원장 액션

1. **Deepgram 스코프 키 발급**(선택, 차단 아님): console.deepgram.com에서 `usage:read`+`billing:read` 스코프 키를 만들어 `.env.local`에 `DEEPGRAM_MANAGE_KEY=`로 추가한다. 추가 후 리포트를 다시 돌리면 Deepgram 칸이 `키 미설정`에서 잔액 수치로 바뀐다.
2. **Vercel 토큰**(선택): `VERCEL_TOKEN`이 없으면 Vercel 칸은 `키 미설정`으로 나온다. 팀 상태 확인이 필요하면 vercel.com/account/tokens에서 발급한다.
3. **리포트 1회 실행 후 판단**: 스펙 §10의 승격 기준 3개 중 하나라도 충족하면 2단계(자체 계측)를 설계한다.

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §4.0 산출물·파일 구조 | Task 1~3 |
| §4.1 섹션 1 돈 | Task 3 (`MONEY_PROBES`) |
| §4.2 섹션 2 가용성·4-state | Task 1(분류), Task 4(카탈로그) |
| §4.3 섹션 3 시한 | Task 2 (`daysUntil`), Task 3 (`DEADLINES`) |
| §4.4 섹션 4 걱정 불필요 | Task 3 (`SAFE_NOTES`) |
| §4.5 출력 형식 | Task 2 (렌더 + 괘선·em dash 금지 테스트) |
| §4.6 시크릿 취급 | Task 1(마스킹), Task 3(runProbe 적용·유출 테스트) |
| §5 프로브 카탈로그 | Task 3(확정 4종), Task 4(미확정 9종) |
| §6 오류 처리 | Task 3 (`runProbe` 예외 흡수·10초 타임아웃·키 미설정 분리) |
| §7 테스트 전략 | Task 1~3의 테스트 스텝 |
| §9 선행 작업 | 실행 후 위원장 액션 1 |
| §10 승격 기준 | Task 4 Step 6(PROGRESS 기록), 위원장 액션 3 |

빠진 절 없음. 스펙 §11(미해결)은 의도적으로 이번 범위 밖이며 PROGRESS에 기록된다.

**2. 플레이스홀더 스캔**

"TBD"·"적절히 처리"·"비슷하게" 없음. Task 4는 실호출 결과에 의존하지만, 무엇을 확인하고 무엇을 기록할지가 구체적으로 적혀 있고 판정 규칙 예시 코드가 두 벌 들어 있다. 이는 플레이스홀더가 아니라 **실측 게이트**이며, 스펙 §5가 "추정으로 코드를 쓰지 않는다"고 명시한 대로다.

**3. 타입 정합성**

- `STATUS`는 Task 1에서 정의하고 Task 2~4가 같은 이름으로 소비한다.
- `runProbe`의 반환 `{ label, status, detail, note }`는 `renderProbeLine`의 인자 형태와 일치한다.
- 프로브의 `envKeys`는 배열이며 `runProbe`가 `filter`·`map`으로 순회한다. Task 3 계약 테스트가 이를 강제한다.
- `daysUntil(targetISO, todayISO)` 인자 순서가 Task 2 테스트와 진입점 호출에서 동일하다.
