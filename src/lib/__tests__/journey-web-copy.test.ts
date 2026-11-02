import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 여정 웹 문안 가드(E70-f spec §8) — 웹 `journey.*`(messages/ko.json)의 ko 문장은 iOS `ios.journey.*`(ios-extra/ko.json)의 같은
 * 이름 키와 글자 하나까지 같아야 한다. 같은 앱의 두 창구가 다른 말을 하면 화면을 못 보는 사용자에게 둘이 같은 기능이라는
 * 근거가 없다. 웹 전용 키(아래 목록)만 대응이 없다.
 */
const WEB_ONLY = new Set(["searchField"]);

const root = join(__dirname, "../../..");
const web = JSON.parse(readFileSync(join(root, "messages/ko.json"), "utf8")).journey as Record<string, string>;
const ios = JSON.parse(readFileSync(join(root, "ios/i18n/ios-extra/ko.json"), "utf8")).ios.journey as Record<string, string>;

describe("여정 웹 문안 = iOS 문안", () => {
  it("웹 키마다 iOS 같은 이름 키가 있고 ko 문장이 같다", () => {
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(web)) {
      if (WEB_ONLY.has(key)) continue;
      if (ios[key] !== value) mismatches.push(`${key}: web「${value}」 ≠ ios「${ios[key] ?? "(없음)"}」`);
    }
    expect(mismatches).toEqual([]);
  });
});
