import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { ENDPOINT_CATALOG } from "../lib/endpoint-catalog-shared.js";

/**
 * 카탈로그 커버리지 — ENDPOINT_CATALOG의 모든 항목이 실제 명령 어딘가에서 소비되는지
 * 정적 검증한다(死엔트리 회귀 방지). 대부분의 명령은 카탈로그 `name`을 그대로
 * runEndpoint("nearby-subway", ...)처럼 문자열 리터럴로 넘긴다.
 *
 * ⚠ 예외 5종(places-search·attractions-search·address-search·web-search·geocode)은
 * search 명령이 결정론 병렬 3섹션(스펙 §4)을 조립하며 카탈로그 name 대신 REST `path`
 * 리터럴로 apiRequest를 직접 호출한다(geocode는 resolve-location.ts의 geocodeQuery가
 * "/api/geocode"를 직접 호출) — 이 경우 name 리터럴이 아니라 path 리터럴 등장을 인정한다.
 */

const commandsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "commands");

// commands/**/*.ts(현재는 평면 디렉터리) + geocode의 path 리터럴이 사는 resolve-location.ts.
const SOURCE_FILES = [
  ...readdirSync(commandsDir).filter((f) => f.endsWith(".ts")).map((f) => join(commandsDir, f)),
  join(commandsDir, "..", "lib", "resolve-location.ts"),
];

const COMBINED_SOURCE = SOURCE_FILES.map((f) => readFileSync(f, "utf8")).join("\n");

describe("카탈로그 커버리지 (死엔트리 회귀 방지)", () => {
  it("모든 ENDPOINT_CATALOG 항목이 name 또는 path 리터럴로 명령 소스에 등장한다", () => {
    const deadEntries = ENDPOINT_CATALOG.filter(
      (e) => !COMBINED_SOURCE.includes(`"${e.name}"`) && !COMBINED_SOURCE.includes(e.path),
    );
    expect(deadEntries.map((e) => e.name)).toEqual([]);
  });
});
