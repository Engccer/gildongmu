import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 시트로 띄운 장소 상세에는 닫기 버튼이 있어야 한다(2026-09-16 실승차: 대중교통 안내 시트의 역 상세에서
 * 빠져나오는 버튼을 찾지 못했다 — 아래로 쓸기·VO 문지르기만 남아 있었다).
 *
 * 계약: `PlaceDetailView(`를 부르는 자리는 **push**(`NavigationLink`·`navigationDestination` — 뒤로 버튼이
 * 있다)이거나 닫기 버튼을 다는 `PlaceDetailSheet` 본문 하나뿐이다. 시트 클로저에 `NavigationStack {
 * PlaceDetailView(...) }`를 직접 쓰면 이 가드가 막는다. 앱 타깃엔 뷰 테스트 레인이 없어 소스로 잠근다.
 */

const APP = join(__dirname, "../../..", "ios/Gildongmu");

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return swiftFiles(full);
    return name.endsWith(".swift") ? [full] : [];
  });
}

/** 호출 직전 코드 줄(주석·빈 줄 제외) 몇 개 — push 문맥은 호출 바로 위에 온다. */
function precedingCode(lines: string[], index: number, count: number): string {
  const out: string[] = [];
  for (let i = index; i >= 0 && out.length < count; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("///")) continue;
    out.push(trimmed);
  }
  return out.join("\n");
}

/** 호출 줄을 감싸는 가장 가까운 `struct` 선언 이름(들여쓰기 0의 선언만 — 파일 최상위 뷰). */
function enclosingStruct(lines: string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^(?:private |fileprivate )?struct (\w+)/);
    if (m) return m[1];
  }
  return null;
}

describe("장소 상세 시트 닫기 버튼 가드", () => {
  it("PlaceDetailView 호출은 push이거나 PlaceDetailSheet 본문뿐이다", () => {
    const offenders: string[] = [];
    let sheetBodies = 0;
    for (const file of swiftFiles(APP)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || !/\bPlaceDetailView\(/.test(code)) return;
        const context = precedingCode(lines, i, 3);
        if (/NavigationLink|navigationDestination/.test(context)) return;
        if (enclosingStruct(lines, i) === "PlaceDetailSheet") {
          sheetBodies += 1;
          return;
        }
        offenders.push(`${relative(APP, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
    expect(sheetBodies).toBe(1);
  });

  it("PlaceDetailSheet는 닫기 버튼을 시트 툴바에 단다", () => {
    const src = readFileSync(join(APP, "PlaceDetailView.swift"), "utf8");
    const start = src.indexOf("struct PlaceDetailSheet");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("@Environment(\\.dismiss)");
    expect(body).toContain("ToolbarItem(placement: .cancellationAction)");
    expect(body).toContain('Button(appLocalized("actions.close")) { dismiss() }');
  });
});
