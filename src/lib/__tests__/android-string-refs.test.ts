import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 안드로이드 코드가 참조하는 문자열 리소스는 기본 로케일 리소스에 있어야 한다. 원천(`messages`·ios-extra·android-extra)에서
 * 키를 지우면 생성기가 strings.xml에서도 조용히 빼고, 그 깨짐은 gradle 컴파일에서만 드러난다(2026-10-02: iOS 2.0이
 * ios-extra의 도보 공지 9키를 지워 안드로이드 `:app`이 main에서 컴파일되지 않았다). 웹 레인에서 먼저 잡는다.
 */
const ROOT = join(__dirname, "../../..");
const SRC = join(ROOT, "android/app/src/main/kotlin");
const VALUES = join(ROOT, "android/app/src/main/res/values");

function kotlinFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return kotlinFiles(path);
    return name.endsWith(".kt") ? [path] : [];
  });
}

describe("안드로이드 R.string 참조", () => {
  it("코드가 참조하는 문자열은 모두 기본 리소스(values)에 정의돼 있다", () => {
    const defined = new Set(
      readdirSync(VALUES)
        .filter((name) => name.endsWith(".xml"))
        .flatMap((name) => [...readFileSync(join(VALUES, name), "utf8").matchAll(/<string name="([^"]+)"/g)].map((m) => m[1])),
    );
    const missing = kotlinFiles(SRC).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/\bR\.string\.([A-Za-z0-9_]+)/g)]
        .map((m) => m[1])
        .filter((name) => !defined.has(name))
        .map((name) => `${path.slice(ROOT.length + 1)}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
