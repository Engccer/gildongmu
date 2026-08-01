import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 좌표 쿼리 파라미터를 읽는 라우트는 **반드시 `@/lib/coord-param`을 쓴다**는 정적 가드.
 *
 * 막는 결함: `searchParams.get("lat") ?? ""`를 `z.coerce.number()`에 직접 태우면
 * `Number("") === 0`이라 파라미터 누락이 (0, 0)이 되고, 그 좌표는 한국 밖이라
 * **400이어야 할 요청이 `200 {"outOfCoverage":true}`로 위장**된다.
 *
 * 라우트별 동작 테스트(각 `__tests__/route.test.ts`의 "좌표 결측 → 400")가
 * 결과를 지키고, 이 가드는 **앞으로 생길 라우트**까지 덮는다. 종전엔 14곳이
 * 같은 함정을 복제하고도 아무 테스트가 깨지지 않았다(백로그 D3).
 */

const API_ROOT = join(process.cwd(), "src/app/api");

function routeFiles(): string[] {
  return readdirSync(API_ROOT, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith("route.ts"))
    .map((p) => join(API_ROOT, p));
}

/** 주석은 판정에서 뺀다 — 금지 대상을 설명하는 주석이 스스로 위반으로 잡힌다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * 좌표를 개별 쿼리 파라미터로 받는 라우트만 대상(`route/*`의 "lat,lng" 단일
 * 문자열은 별개 계약이고 정규식이 빈 문자열을 애초에 거부한다).
 *
 * 수신자를 묶지 않고 `.get("lat")` 호출 자체로 고른다 —
 * `searchParams.get("lat")` 문자열로 좁히면 `const sp = …searchParams; sp.get("lat")`
 * 별칭 한 줄로 가드가 우회된다(리뷰가 변이로 실증).
 */
function coordRoutes(): { path: string; code: string }[] {
  return routeFiles()
    .map((path) => ({ path, code: stripComments(readFileSync(path, "utf8")) }))
    .filter(({ code }) => /\.get\(\s*["']lat["']\s*\)/.test(code));
}

describe("좌표 라우트의 coord-param 사용 (정적 가드)", () => {
  it("대상 라우트가 실제로 존재한다 (가드가 빈 집합을 통과하지 않는다)", () => {
    expect(coordRoutes().length).toBeGreaterThan(10);
  });

  it("좌표를 읽는 모든 라우트가 coord-param 헬퍼를 쓴다", () => {
    // 범위가 다른 라우트(한국 bbox 전용 match)는 `coordParam(min,max)`를 쓰므로
    // 특정 함수명이 아니라 **모듈 사용**을 요구한다.
    const offenders = coordRoutes()
      .filter(({ code }) => !code.includes('from "@/lib/coord-param"'))
      .map(({ path }) => path.replace(`${process.cwd()}/`, ""));
    expect(offenders).toEqual([]);
  });

  it("좌표를 읽는 라우트에 z.coerce.number() 좌표 스키마가 남아 있지 않다", () => {
    // limit 등 다른 파라미터의 coerce는 정상이므로 lat/lng 줄만 본다.
    const offenders = coordRoutes()
      .filter(({ code }) => /\b(lat|lng)\s*:\s*z\.coerce\.number\(/.test(code))
      .map(({ path }) => path.replace(`${process.cwd()}/`, ""));
    expect(offenders).toEqual([]);
  });
});
