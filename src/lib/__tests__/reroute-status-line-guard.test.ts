import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자동 재조회 채택 문장의 앱 층 배선 소스 가드(A57·A58). iOS 앱 타깃은 테스트 레인이 없고 안드로이드 모델 배선도
 * `GuideTextTest`(문장 조립) 밖이라, 아래를 되돌려도 다른 테스트가 초록으로 통과한다.
 * ① 상태 행(`statusText`)에는 머리말을 뺀 `statusLine`, 음성에는 `spoken` — 상태 행에 음성 문장을 두면 시트 착지·화면 복귀
 *   상환이 이미 지난 시계 방향을 다시 지시한다(이탈 상태 행 "벗어난 쪽만"과 같은 판정).
 * ② 머리말 판정(A58)은 안내 데이터 언어를 실제로 넘긴다 — 상수를 넘기면 en 횡단이 방향을 두 번 말하거나 ko 횡단이 방향을 잃는다.
 */
const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** 자동 채택 지점(계측 줄 `rerouteAdopt source=<자동> result=adopted` — 버튼 채택 줄은 출처가 상수다)부터 다음 `catch`/함수 끝까지. */
function adoptBlock(src: string, marker: string, end: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const stop = src.indexOf(end, start);
  expect(stop, end).toBeGreaterThan(start);
  return src.slice(start, stop);
}

describe("iOS BeaconModel 자동 재조회 채택", () => {
  const block = adoptBlock(
    read("ios/Gildongmu/Directions/BeaconModel.swift"),
    "rerouteAdopt source=\\(source) result=adopted",
    "} catch {",
  );

  it("① 상태 행은 statusLine, 음성은 spoken", () => {
    expect(block).toMatch(/statusText = notice\.map \{ "\\\(\$0\) \\\(summary\.statusLine\)" \} \?\? summary\.statusLine/);
    expect(block).toMatch(/let text = notice\.map \{ "\\\(\$0\) \\\(summary\.spoken\)" \} \?\? summary\.spoken/);
    expect(block).toContain("announce(text,");
    expect(block).not.toMatch(/statusText = text\b/);
  });

  it("② 안내 데이터 언어를 넘긴다", () => {
    expect(block).toContain("english: AppLanguage.dataLocaleValue == .en");
  });
});

describe("안드로이드 WalkGuideModel 자동 재조회 채택", () => {
  const block = adoptBlock(
    read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/WalkGuideModel.kt"),
    "rerouteAdopt source=$source result=adopted",
    "private fun clearProposal()",
  );

  it("① 상태 행은 statusLine, 음성은 spoken", () => {
    expect(block).toContain('statusText = if (notice != null) "$notice ${lines.statusLine}" else lines.statusLine');
    expect(block).toContain('val spoken = if (notice != null) "$notice ${lines.spoken}" else lines.spoken');
    expect(block).toMatch(/announce\(spoken,/);
    expect(block).not.toMatch(/statusText = spoken\b/);
  });

  it("② 안내 데이터 언어를 넘긴다", () => {
    expect(block).toContain("english = dataLocale() != DataLocale.ko");
  });
});
