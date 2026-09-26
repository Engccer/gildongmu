// axe-core 공통 헬퍼 — critical 0건 하드 게이트 + serious baseline 잠금(webfortd@606d16e 이식).
//
//   1. critical 위반 → 즉시 fail (회귀 차단 hard gate — baseline으로 넘기지 않는다)
//   2. serious 위반 → 화면 키별 baseline 비교
//      - baseline에 없는 신규 rule → fail
//      - actual[rule] > baseline[rule] → fail (회귀)
//      - actual[rule] < baseline[rule] → console.log (개선 — baseline 갱신 권고)
//
// Baseline: tests/a11y/axe-serious-baseline.json (키는 화면 이름, 값은 {ruleId: count})
// 갱신: 개선 로그나 실패 메시지의 actual을 보고 이 파일을 직접 수정한다(자동 갱신 스크립트 없음).
// ⚠ axe는 헌장 §2 과잉 ARIA를 위반으로 잡지 않고 실기기 VoiceOver 판정을 대체하지 않는다.

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BLOCKING_IMPACTS = new Set(["critical"]);
const SERIOUS_IMPACTS = new Set(["serious"]);

type RouteBaseline = Record<string, number>;
type BaselineFile = {
  routes: Record<string, RouteBaseline>;
};

const baselinePath = join(process.cwd(), "tests/a11y/axe-serious-baseline.json");
const baselineFile: BaselineFile = JSON.parse(readFileSync(baselinePath, "utf8"));

function countByRule(violations: Array<{ id: string }>): RouteBaseline {
  const counts: RouteBaseline = {};
  for (const v of violations) {
    counts[v.id] = (counts[v.id] ?? 0) + 1;
  }
  return counts;
}

/** 정적 라우트: 이동 후 현재 화면을 감사한다. 키는 라우트 문자열 그대로. */
export async function expectNoAxeViolations(page: Page, info: TestInfo, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await expectNoAxeViolationsOnPage(page, info, route);
}

/** 상태 화면: 호출자가 화면을 세운 뒤 현재 DOM을 감사한다. `key`는 baseline 키. */
export async function expectNoAxeViolationsOnPage(page: Page, info: TestInfo, key: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const serious = results.violations.filter((v) => SERIOUS_IMPACTS.has(v.impact ?? ""));

  if (critical.length > 0 || serious.length > 0) {
    const fmt = (v: (typeof results.violations)[number]) =>
      `[${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n  affected: ${v.nodes.length} node(s)\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}`)
        .join("\n");
    const report = [...critical, ...serious].map(fmt).join("\n\n");
    await info.attach("axe-violations", { body: report, contentType: "text/plain" });
  }

  // critical hard gate
  expect(
    critical.map((v) => `${v.id} (${v.nodes.length})`),
    `${key} — critical 0건 기대, ${critical.length}건 발견`,
  ).toEqual([]);

  // serious baseline lock
  const baseline = baselineFile.routes[key] ?? {};
  const actual = countByRule(serious);

  // 1) 신규 rule (baseline에 없음) → fail
  const newRules = Object.keys(actual).filter((rule) => !(rule in baseline));
  expect(
    newRules,
    `${key} — serious 신규 rule 회귀: ${newRules.join(", ")} (actual ${JSON.stringify(actual)}; axe-serious-baseline.json 갱신 또는 수정 필요)`,
  ).toEqual([]);

  // 2) baseline 초과 → fail
  const regressions: string[] = [];
  for (const rule of Object.keys(actual)) {
    if (actual[rule] > (baseline[rule] ?? 0)) {
      regressions.push(`${rule}: actual=${actual[rule]} > baseline=${baseline[rule] ?? 0}`);
    }
  }
  expect(regressions, `${key} — serious 회귀:\n  ${regressions.join("\n  ")}`).toEqual([]);

  // 3) 개선 권고 (baseline > actual)
  const improvements: string[] = [];
  for (const rule of Object.keys(baseline)) {
    const expectedCount = baseline[rule];
    const actualCount = actual[rule] ?? 0;
    if (actualCount < expectedCount) {
      improvements.push(`${rule}: actual=${actualCount} < baseline=${expectedCount}`);
    }
  }
  if (improvements.length > 0) {
    console.log(
      `[a11y improvement] ${key} — baseline 갱신 권고: ${improvements.join(", ")} (axe-serious-baseline.json 직접 수정)`,
    );
  }
}
