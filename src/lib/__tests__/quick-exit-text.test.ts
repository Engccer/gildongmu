import { describe, expect, it } from "vitest";

import { quickExitText } from "../quick-exit-text";
import type { QuickExit } from "../types";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import itMessages from "../../../messages/it.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";

/** next-intl 없이 메시지 카탈로그를 직접 채워 로케일별 실문장을 검사한다. */
const translator = (messages: Record<string, string>) => (key: string, values?: Record<string, string>) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? `{${name}}`);

const t = translator(ko.route.transit as Record<string, string>);
const tEn = translator(en.route.transit as Record<string, string>);
const tJa = translator(ja.route.transit as Record<string, string>);

const door = (d: string): QuickExit["elevator"] => ({ kind: "door", doors: [d] });
const between = (a: string, b: string): QuickExit["elevator"] => ({
  kind: "between",
  doors: [a, b],
});

describe("quickExitText", () => {
  it("둘 다", () => {
    expect(quickExitText(t, "여의도", { elevator: door("6-4"), stairs: door("5-4") })).toBe(
      "여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문",
    );
  });

  it("엘리베이터만", () => {
    expect(quickExitText(t, "연신내", { elevator: door("6-2") })).toBe(
      "연신내 하차, 엘리베이터 6-2 문",
    );
  });

  it("계단만", () => {
    expect(quickExitText(t, "장암", { stairs: door("3-1") })).toBe("장암 하차, 계단 3-1 문");
  });

  it("문 사이는 별도 조각이라 문장이 깨지지 않는다", () => {
    // 문 번호 자리에 원문을 그대로 넣으면 "엘리베이터 3-2,3-3 사이 문"이 된다.
    expect(quickExitText(t, "군자", { elevator: between("3-2", "3-3") })).toBe(
      "군자 하차, 엘리베이터 3-2 문과 3-3 문 사이",
    );
  });

  it("값이 없으면 null(문구를 만들지 않는다)", () => {
    expect(quickExitText(t, "여의도", undefined)).toBeNull();
    expect(quickExitText(t, "여의도", {})).toBeNull();
    expect(quickExitText(t, "", { elevator: door("6-4") })).toBeNull();
  });

  it("빈 doors 배열은 그 시설을 없는 것으로 본다", () => {
    expect(quickExitText(t, "여의도", { elevator: { kind: "door", doors: [] } })).toBeNull();
  });

  it("between인데 문이 하나뿐이면 단일 문 형태로 떨어진다", () => {
    expect(quickExitText(t, "여의도", { elevator: { kind: "between", doors: ["6-4"] } })).toBe(
      "여의도 하차, 엘리베이터 6-4 문",
    );
  });

  it("로케일별로 절 순서가 다르다(변수만 비우는 방식이 성립하지 않는 이유)", () => {
    const value: QuickExit = { elevator: door("6-4"), stairs: between("5-3", "5-4") };
    // ⚠ "elevator door 6-4"는 "엘리베이터의 문"으로 읽히는 고정 결합이라 뜻이 뒤집힌다
    //   (a11y 감사 검출). 처소 표지 "at"이 그 결합을 끊는다 — es·fr·it도 같은 이유로
    //   전치사를 갖는다. between 형태는 자기 전치사가 있어 원래 문제가 없었다.
    expect(quickExitText(tEn, "Yeouido", value)).toBe(
      "Get off at Yeouido, elevator at door 6-4, stairs between doors 5-3 and 5-4",
    );
    expect(quickExitText(tJa, "汝矣島", value)).toBe(
      "汝矣島で下車、エレベーターは6-4のドア、階段は5-3と5-4のドアの間",
    );
  });

  it("남는 플레이스홀더가 없다(6로케일 전수)", () => {
    const value: QuickExit = { elevator: door("6-4"), stairs: between("5-3", "5-4") };
    for (const messages of [ko, en, es, fr, itMessages, ja]) {
      const text = quickExitText(
        translator(messages.route.transit as Record<string, string>),
        "역",
        value,
      );
      expect(text).not.toMatch(/[{}]/);
    }
  });
});
