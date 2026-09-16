import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 안드로이드 미러 등록부 검사(D6 장치 2, 계획 2026-09-16 §2).
 *
 * 술어: iOS `GildongmuKit/Sources/GildongmuKit/**` 전수가 `android/kit/mirrors/{foundation,core,guide}.json`
 * 셋 중 **정확히 하나**에 등재되어야 하고, 상태는 셋뿐이다 —
 *   - `ported`: `kotlin` 경로(저장소 상대)가 실재. `test`를 적었으면 그것도 실재
 *   - `excluded`: `reason` 필수(계획 §2가 정한 2건)
 *   - `pending`: 아직 이식 전(그 목록이 곧 로직 세션의 할 일)
 * iOS에 새 Kit 파일이 생기면 여기서 빨개진다(등록부에 없다). 등록부가 사라진 Swift 파일을
 * 가리켜도 빨개진다(이름 바꾼 뒤 등록부를 안 고친 경우).
 */
const KIT_SOURCES = "ios/GildongmuKit/Sources/GildongmuKit";
const REGISTRY_DIR = "android/kit/mirrors";
const GROUPS = ["foundation", "core", "guide"] as const;

type Entry = { swift: string; status: "ported" | "excluded" | "pending"; kotlin?: string; test?: string; reason?: string; note?: string };
type DeferredTest = { swift: string; to: string; why: string; blockedBy: string[] };
type Registry = { group: string; owner: string; entries: Entry[]; deferredTests?: DeferredTest[] };

function kitFiles(dir = KIT_SOURCES, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue; // .DS_Store 류
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...kitFiles(full, r));
    else if (name.endsWith(".swift") || r.startsWith("Resources/")) out.push(r);
  }
  return out;
}

function registries(): Registry[] {
  return GROUPS.map((g) => JSON.parse(readFileSync(join(REGISTRY_DIR, `${g}.json`), "utf8")) as Registry);
}

describe("안드로이드 미러 등록부", () => {
  const regs = registries();
  const all = regs.flatMap((r) => r.entries.map((e) => ({ ...e, group: r.group })));

  it("등록부 파일 이름과 group이 일치한다", () => {
    expect(regs.map((r) => r.group)).toEqual([...GROUPS]);
  });

  it("Kit 원본 전수가 정확히 한 등록부에 있다", () => {
    const files = kitFiles();
    expect(files.length).toBeGreaterThan(80);
    const counts = new Map<string, number>();
    for (const e of all) counts.set(e.swift, (counts.get(e.swift) ?? 0) + 1);
    const missing = files.filter((f) => !counts.has(f));
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([f]) => f);
    const stale = [...counts.keys()].filter((f) => !files.includes(f));
    expect({ missing, duplicated, stale }).toEqual({ missing: [], duplicated: [], stale: [] });
  });

  it("상태는 ported·excluded·pending뿐이고 각각의 필수 필드가 있다", () => {
    const bad: string[] = [];
    for (const e of all) {
      if (e.status === "ported") {
        if (!e.kotlin || !existsSync(e.kotlin)) bad.push(`${e.group}: ${e.swift} → kotlin 경로 부재 ${e.kotlin}`);
        if (e.kotlin && !e.kotlin.startsWith("android/kit/")) bad.push(`${e.group}: ${e.swift} → kotlin 경로가 android/kit/ 밖 ${e.kotlin}`);
        if (e.test && !existsSync(e.test)) bad.push(`${e.group}: ${e.swift} → test 경로 부재 ${e.test}`);
        if (e.test && !e.test.startsWith("android/kit/src/test/")) bad.push(`${e.group}: ${e.swift} → test 경로가 android/kit/src/test/ 밖 ${e.test}`);
      } else if (e.status === "excluded") {
        if (!e.reason) bad.push(`${e.group}: ${e.swift} → excluded에 reason 없음`);
      } else if (e.status !== "pending") {
        bad.push(`${e.group}: ${e.swift} → 미지 상태 ${String(e.status)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("제외는 계획 §2의 두 건뿐이다", () => {
    expect(all.filter((e) => e.status === "excluded").map((e) => e.swift).sort()).toEqual([
      "AudioSignalProtocol.swift",
      "Resources/Localizable.xcstrings",
    ]);
  });

  it("유예 테스트는 실재하는 Kit 테스트를 가리키고, 막던 파일이 전부 이식되면 남아 있을 수 없다", () => {
    const bad: string[] = [];
    for (const r of regs) {
      for (const d of r.deferredTests ?? []) {
        const file = join("ios/GildongmuKit", d.swift.split("#")[0]);
        if (!existsSync(file)) bad.push(`${r.group}: 유예 테스트 파일 부재 ${d.swift}`);
        if (!GROUPS.includes(d.to as (typeof GROUPS)[number])) bad.push(`${r.group}: 미지 그룹 ${d.to}`);
        if (!d.blockedBy?.length) bad.push(`${r.group}: ${d.swift} → blockedBy 없음`);
        for (const b of d.blockedBy ?? []) {
          const entry = all.find((e) => e.swift === b);
          if (!entry) bad.push(`${r.group}: ${d.swift} → blockedBy ${b}가 어느 등록부에도 없다`);
        }
        const unblocked = (d.blockedBy ?? []).every((b) => all.find((e) => e.swift === b)?.status === "ported");
        if (d.blockedBy?.length && unblocked) bad.push(`${r.group}: ${d.swift} → ${d.blockedBy.join(",")} 전부 ported인데 유예 항목이 남아 있다(옮기고 지운다)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("FOUNDATION 그룹은 pending이 없다(M0 완료 조건)", () => {
    const foundation = regs.find((r) => r.group === "foundation")!;
    expect(foundation.entries.filter((e) => e.status === "pending")).toEqual([]);
  });

  it("가드 자체가 살아 있다 (파일 목록이 비면 조용히 통과하지 않는다)", () => {
    expect(() => kitFiles("android/kit/mirrors/does-not-exist")).toThrow();
  });
});
