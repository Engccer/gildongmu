import { describe, expect, it } from "vitest";
// 검사 스크립트는 순수 JS(.mjs)라 타입 선언이 없다(allowJs가 추론을 대신한다).
import { positionalArg, sameVersion } from "../../../ios/scripts/check-release-artifact.mjs";

/**
 * 산출물 검사의 버전 대조가 **제출 경로의 실제 입력 조합**에서 통과하는지 고정한다.
 *
 * 이 축이 필요한 이유: ASC의 `versionString`(`1.7`)과 산출물의
 * `CFBundleShortVersionString`(= `MARKETING_VERSION`, `1.7.0`)은 같은 버전인데 표기가
 * 다르다. `asc-submit.mjs`가 ASC 표기를 그대로 검사에 넘기므로, 문자열 완전 일치로
 * 비교하던 종전 구현은 **어떤 산출물이든 제출을 막았다**(1.7 제출에서 실측). 게이트를
 * 도입한 마일스톤이 실제 제출로 밟아보지 않아 드러나지 않은 결함이라, 그 조합을 여기
 * 못 박는다.
 *
 * ⚠ 느슨하게 만드는 수정이므로 반대 방향도 함께 고정한다 — 다른 버전은 여전히 막아야
 * 하고, 그렇지 않으면 "낡은 아카이브를 통과시킬 수 있다"는 원래 위험이 되돌아온다.
 */
describe("sameVersion — 산출물 버전 대조", () => {
  it("ASC 표기와 MARKETING_VERSION 표기를 같은 버전으로 본다", () => {
    expect(sameVersion("1.7.0", "1.7")).toBe(true);
    expect(sameVersion("1.7", "1.7.0")).toBe(true);
    expect(sameVersion("2.0.0", "2")).toBe(true);
    expect(sameVersion("1.7.0", "1.7.0")).toBe(true);
  });

  it("다른 버전은 막는다", () => {
    expect(sameVersion("1.7.0", "1.8")).toBe(false);
    expect(sameVersion("1.7.0", "1.7.1")).toBe(false);
    expect(sameVersion("1.6.0", "1.7")).toBe(false);
    expect(sameVersion("1.7.0", "17")).toBe(false);
  });

  it("숫자가 아닌 세그먼트가 섞이면 판정을 지어내지 않고 문자열 일치로 되돌린다", () => {
    expect(sameVersion("1.7.0-beta", "1.7")).toBe(false);
    expect(sameVersion("1.7.0-beta", "1.7.0-beta")).toBe(true);
  });
});

/**
 * 위치 인자 파싱. `asc-submit.mjs`가 넘기는 형태(경로 없이 `--expect-*`만)에서
 * 플래그 값을 산출물 경로로 오인하던 결함을 고정한다 — 오인하면 `경로가 없다: 1.7`로
 * 제출이 항상 막혔다(1.7 제출에서 실측).
 */
describe("positionalArg — 산출물 경로 인자", () => {
  it("값을 갖는 플래그의 값을 경로로 읽지 않는다", () => {
    expect(positionalArg(["--expect-version", "1.7", "--expect-build", "13"])).toBe(null);
  });

  it("진짜 경로는 플래그와 섞여 있어도 찾는다", () => {
    expect(positionalArg(["--expect-version", "1.7", "/tmp/a.xcarchive"])).toBe("/tmp/a.xcarchive");
    expect(positionalArg(["/tmp/a.xcarchive", "--expect-build", "13"])).toBe("/tmp/a.xcarchive");
    expect(positionalArg([])).toBe(null);
  });
});
