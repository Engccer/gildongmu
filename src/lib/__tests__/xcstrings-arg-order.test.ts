import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectArgOrder,
  diffArgOrder,
  syncArgOrder,
  ARG_ORDER_PATH,
  UPDATE_ARG_ORDER_FLAG,
} from "../../../ios/scripts/messages-to-xcstrings.mjs";

/**
 * ko 문장의 플레이스홀더 등장 순서 게이트(§8 2026-09-02, 메모리 gildongmu-ios-i18n-architecture 함정 6).
 * 변환 스크립트가 로케일별 인덱스를 ko 순서로 고정하므로 iOS 호출부는 ko 순서 하나만 지킨다 —
 * 그 순서가 곧 위치 인자 ABI인데 ko 번역만 재배열해도 빌드·린터·테스트가 전부 통과했다.
 * `ios/i18n/arg-order.json`이 그 순서를 버전 관리하고, 여기와 생성 스크립트가 대조한다.
 */
type Order = Record<string, string[]>;
const ROOT = resolve(__dirname, "..", "..", "..");
const SCRIPT = join(ROOT, "ios", "scripts", "messages-to-xcstrings.mjs");
const quiet = { log: () => {}, error: () => {} } as unknown as Console;

describe("xcstrings 인자 순서 manifest", () => {
  it("저장된 manifest가 정본(messages + extra)에서 계산한 순서와 같다", () => {
    const current = collectArgOrder() as Order;
    // 인자 있는 키가 이만큼은 있어야 게이트가 무엇을 지키는지 성립한다.
    expect(Object.keys(current).length).toBeGreaterThan(100);
    const manifest = JSON.parse(readFileSync(ARG_ORDER_PATH, "utf8")) as Order;
    expect(diffArgOrder(manifest, current)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("차분은 순서 변경만 계약 파손으로 가른다", () => {
    const manifest: Order = { a: ["x", "y"], b: ["n"], gone: ["z"] };
    const current: Order = { a: ["y", "x"], b: ["n"], fresh: ["q"] };
    expect(diffArgOrder(manifest, current)).toEqual({
      added: ["fresh"],
      removed: ["gone"],
      changed: [{ key: "a", was: ["x", "y"], now: ["y", "x"] }],
    });
  });

  it("순서 변경은 --update-arg-order 없이는 실패하고 manifest를 건드리지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "arg-order-"));
    const manifestPath = join(dir, "arg-order.json");
    writeFileSync(manifestPath, `${JSON.stringify({ a: ["x", "y"], b: ["n"] }, null, 2)}\n`);
    const current: Order = { a: ["y", "x"], b: ["n"], c: ["p", "q"] };
    const rejected = syncArgOrder({ update: false, manifestPath, current, log: quiet });
    expect(rejected.ok).toBe(false);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual({ a: ["x", "y"], b: ["n"] });
    const accepted = syncArgOrder({ update: true, manifestPath, current, log: quiet });
    expect(accepted.ok).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(current);
    // 신규 키·사라진 키만 있으면 플래그 없이도 통과하며 manifest가 따라온다.
    const evolved: Order = { a: ["y", "x"], c: ["p", "q"], d: ["r"] };
    expect(syncArgOrder({ update: false, manifestPath, current: evolved, log: quiet }).ok).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(evolved);
  });

  // 변이 주입 — 실제 스크립트를 임시 저장소 사본에서 돌려 "ko 한 문장의 어순만 바꾸면 exit 1"을
  // 프로세스 수준에서 단언한다(스크립트는 자기 경로 기준으로 저장소를 찾으므로 사본이 곧 격리다).
  it("ko 문장 어순만 바꾸면 생성 스크립트가 exit 1이고, 플래그를 주면 manifest가 갱신된다", () => {
    // ⚠ realpath — macOS tmp는 `/var` → `/private/var` 심링크라, 스크립트의 CLI 판정
    // (`argv[1]` resolve ↔ `import.meta.url`)이 두 철자를 다른 파일로 보고 조용히 no-op이 된다.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "arg-order-repo-")));
    cpSync(join(ROOT, "messages"), join(dir, "messages"), { recursive: true });
    cpSync(join(ROOT, "ios", "i18n"), join(dir, "ios", "i18n"), { recursive: true });
    mkdirSync(join(dir, "ios", "scripts"), { recursive: true });
    cpSync(SCRIPT, join(dir, "ios", "scripts", "messages-to-xcstrings.mjs"));
    mkdirSync(join(dir, "ios", "Gildongmu", "Resources"), { recursive: true });
    mkdirSync(join(dir, "ios", "GildongmuKit", "Sources", "GildongmuKit", "Resources"), { recursive: true });
    const script = join(dir, "ios", "scripts", "messages-to-xcstrings.mjs");
    const manifestPath = join(dir, "ios", "i18n", "arg-order.json");
    expect(existsSync(manifestPath)).toBe(true);

    // 사본은 정본과 동일하므로 먼저 통과해야 한다(대조군).
    const clean = spawnSync("node", [script, "all"], { encoding: "utf8" });
    expect(clean.status, clean.stderr).toBe(0);

    // 인자 2개 이상인 웹 키 하나의 ko 문장에서 두 플레이스홀더 자리를 맞바꾼다 — 게이트가 보는
    // 것은 순서뿐이다. manifest의 첫 후보를 고르되 ko.json(웹 정본)에 있는 키만.
    const koPath = join(dir, "messages", "ko.json");
    const ko = JSON.parse(readFileSync(koPath, "utf8")) as Record<string, unknown>;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Order;
    const target = Object.entries(manifest).find(
      ([key, order]) => order.length >= 2 && typeof getPath(ko, key) === "string",
    );
    expect(target).toBeDefined();
    const [key, order] = target as [string, string[]];
    const original = getPath(ko, key) as string;
    const [first, second] = order;
    const SWAP = "<<swap>>";
    const mutated = original
      .replace(`{${first}}`, SWAP)
      .replace(`{${second}}`, `{${first}}`)
      .replace(SWAP, `{${second}}`);
    expect(mutated).not.toBe(original);
    setPath(ko, key, mutated);
    writeFileSync(koPath, `${JSON.stringify(ko, null, 2)}\n`);

    const rejected = spawnSync("node", [script, "all"], { encoding: "utf8" });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(key);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))[key]).toEqual(order);

    const accepted = spawnSync("node", [script, "all", UPDATE_ARG_ORDER_FLAG], { encoding: "utf8" });
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))[key]).toEqual([second, first, ...order.slice(2)]);
  });
});

function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, dotted: string, value: string): void {
  const keys = dotted.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}
