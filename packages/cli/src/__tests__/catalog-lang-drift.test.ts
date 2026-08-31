import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ENDPOINT_CATALOG } from "../lib/endpoint-catalog-shared.js";

/**
 * 서버가 `lang`을 받기 시작했는데 카탈로그가 안 따라가는 드리프트를 잡는다.
 *
 * 이 결함은 조용하다 — 라우트에 `lang`이 생겨도 CLI는 그 파라미터를 보낼 방법이 없고,
 * MCP 도구 스키마는 카탈로그에서 자동 생성되므로 에이전트도 영어를 요청할 수 없다.
 * 오류도 빈 결과도 아니라 **한국어 응답이 정상으로 보인다**. 실제로 `/api/route/walk`·
 * `/api/route/transit`·`/api/station/*`가 몇 달간 그 상태였고(E16 축3·E27), 카탈로그
 * 자기 자신만 보는 검사는 그것을 끝까지 통과시켰다(2026-09-01 리뷰 지적).
 *
 * 그래서 판정 대상은 카탈로그가 아니라 **라우트 소스**다. `route.ts`만 읽지 않고 그
 * 디렉터리의 형제 파일까지 훑는 이유는 `/api/places`가 `query-schema.ts`에서, 도보가
 * `route-schema.ts`에서 `lang`을 파싱하기 때문이다(route.ts만 보면 places를 놓친다).
 */

const appApiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "app", "api");

/** 라우트 소스에서 `lang` 파싱을 알아보는 신호 — 셋 중 하나라도 있으면 그 라우트는 lang을 받는다. */
const LANG_SIGNAL = /langParam\(|lang:\s*z\.|searchParams\.get\("lang"\)/;

/**
 * lang을 받지만 카탈로그에 없어도 되는 라우트 — **경로별 명시 열거**.
 * 목록에 없는 신규 라우트는 실패시켜, 카탈로그 미등록이 기록 없이 스며들지 못하게 한다.
 */
const NOT_IN_CATALOG_BY_DESIGN = new Map<string, string>([
  // 역지오코딩은 CLI/MCP 명령이 없다 — 웹·iOS의 "현재 위치" 라벨 전용 경량 라우트다.
  ["/api/geocode/reverse", "CLI/MCP 소비자가 없는 웹·iOS 전용 라우트"],
]);

function routeDirs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeDirs(full));
    else if (entry === "route.ts") out.push(dir);
  }
  return out;
}

/** 그 라우트 디렉터리의 `.ts` 소스를 합쳐 읽는다(스키마가 형제 파일에 있는 경우 포함). */
function dirSource(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

function apiPath(dir: string): string {
  return "/api/" + relative(join(appApiDir), dir).split(sep).join("/");
}

describe("서버 lang ↔ 카탈로그 드리프트", () => {
  const dirs = routeDirs(appApiDir);

  it("라우트를 실제로 찾았다(빈 스캔이 통과로 위장하지 않게)", () => {
    // 스캔이 0건이면 아래 단언들이 전부 공허하게 통과한다 — 경로가 깨졌을 때
    // "가드가 돈다"고 믿게 되는 자리라 먼저 막는다.
    expect(dirs.length).toBeGreaterThan(20);
  });

  it("lang을 파싱하는 라우트는 전부 카탈로그에 lang params가 있다(예외는 명시 열거)", () => {
    const serverLangPaths = dirs.filter((d) => LANG_SIGNAL.test(dirSource(d))).map(apiPath);
    const catalogLangPaths = new Set(
      ENDPOINT_CATALOG.filter((e) => e.params.some((p) => p.key === "lang")).map((e) => e.path),
    );
    const missing = serverLangPaths
      .filter((p) => !catalogLangPaths.has(p) && !NOT_IN_CATALOG_BY_DESIGN.has(p))
      .sort();
    expect(missing).toEqual([]);
  });

  it("카탈로그의 lang params는 서버가 실제로 받는 라우트에만 있다", () => {
    const serverLangPaths = new Set(dirs.filter((d) => LANG_SIGNAL.test(dirSource(d))).map(apiPath));
    const bogus = ENDPOINT_CATALOG.filter(
      (e) => e.params.some((p) => p.key === "lang") && !serverLangPaths.has(e.path),
    ).map((e) => e.name);
    expect(bogus).toEqual([]);
  });

  it("예외 목록에 죽은 경로가 없다(라우트가 사라지거나 lang을 잃으면 지운다)", () => {
    const serverLangPaths = new Set(dirs.filter((d) => LANG_SIGNAL.test(dirSource(d))).map(apiPath));
    const stale = [...NOT_IN_CATALOG_BY_DESIGN.keys()].filter((p) => !serverLangPaths.has(p));
    expect(stale).toEqual([]);
  });
});
