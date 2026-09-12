import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { alightLineText, boardExitAfterWalk, boardExitOnBoardLine } from "../transit-exit-lines";
import type { TransitLeg } from "../types";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import itMessages from "../../../messages/it.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";

/** next-intl 없이 메시지 카탈로그를 직접 채워 로케일별 실문장을 검사한다(`quick-exit-text.test.ts` 동형). */
const translator = (messages: Record<string, string>) => (key: string, values?: Record<string, string>) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? `{${name}}`);

const t = translator(ko.route.transit as Record<string, string>);
const tGuide = translator(ko.transitGuide as unknown as Record<string, string>);
const tEn = translator(en.route.transit as Record<string, string>);
const tGuideEn = translator(en.transitGuide as unknown as Record<string, string>);

const door = (d: string): NonNullable<TransitLeg["quickExit"]>["elevator"] => ({ kind: "door", doors: [d] });

const walk = (): TransitLeg => ({ mode: "walk", minutes: 2, distanceMeters: 131 }) as TransitLeg;
const subway = (exit?: { board?: string; alight?: string }): TransitLeg =>
  ({ mode: "subway", minutes: 20, lineName: "수도권 9호선", fromName: "개화", toName: "중앙보훈병원", ...(exit ? { exit } : {}) }) as TransitLeg;
const bus = (): TransitLeg =>
  ({ mode: "bus", minutes: 10, lineName: "370", fromName: "정류소", toName: "환승정류소" }) as TransitLeg;

describe("alightLineText — 하차 줄", () => {
  it("빠른하차와 출구가 함께 있으면 문 먼저, 출구가 끝에 온다", () => {
    expect(alightLineText(t, tGuide, "노량진", { transfer: door("6-3") }, "7")).toBe(
      "노량진 하차, 빠른 환승 6-3 문, 7번 출구 방면",
    );
  });

  it("빠른하차가 없으면 하차역과 출구만으로 줄이 선다(지금은 줄 자체가 없던 자리)", () => {
    expect(alightLineText(t, tGuide, "중앙보훈병원", undefined, "1")).toBe("중앙보훈병원 하차, 1번 출구 방면");
  });

  it("출구가 없으면 종전 빠른하차 문장 그대로다", () => {
    expect(alightLineText(t, tGuide, "여의도", { elevator: door("6-4") }, null)).toBe(
      "여의도 하차, 엘리베이터 6-4 문",
    );
  });

  it("둘 다 없으면 줄을 만들지 않는다(3-state — 부재 문구 금지)", () => {
    expect(alightLineText(t, tGuide, "여의도", undefined, null)).toBeNull();
  });

  it("형식에 맞지 않는 출구 번호는 부재로 본다(소비자 형식 게이트)", () => {
    expect(alightLineText(t, tGuide, "여의도", undefined, "null")).toBeNull();
    expect(alightLineText(t, tGuide, "여의도", undefined, "1 2")).toBeNull();
    expect(alightLineText(t, tGuide, "여의도", undefined, "")).toBeNull();
    // 가지번호 출구는 통과한다.
    expect(alightLineText(t, tGuide, "여의도", undefined, "3-1")).toBe("여의도 하차, 3-1번 출구 방면");
  });

  it("0 계열 차단은 서버 게이트의 몫이라 소비자 게이트는 통과시킨다", () => {
    // ⚠ 안내 세션과 **같은** 술어(`validExitNo` = `^\d+(-\d+)?$`)를 쓴다. 여기만 더 조이면
    //   같은 값이 브리핑에선 사라지고 안내 중엔 들려 두 화면이 어긋난다. 0 계열은
    //   `odsay.ts`의 `exitNumber`가 투영 시점에 이미 떨어뜨린다(E25 긍정 정규식).
    expect(alightLineText(t, tGuide, "여의도", undefined, "0")).toBe("여의도 하차, 0번 출구 방면");
  });

  it("역 이름이 없으면 줄을 만들지 않는다", () => {
    expect(alightLineText(t, tGuide, "", undefined, "1")).toBeNull();
  });

  it("en은 안내 중 낭독과 같은 문구를 쓴다(두 화면이 갈리지 않게)", () => {
    expect(alightLineText(tEn, tGuideEn, "Noryangjin", { transfer: door("6-3") }, "7")).toBe(
      "Get off at Noryangjin, quick transfer at door 6-3, Toward Exit 7",
    );
    expect(alightLineText(tEn, tGuideEn, "Jungang Bohun Hospital", undefined, "1")).toBe(
      "Get off at Jungang Bohun Hospital, Toward Exit 1",
    );
  });

  it("6로케일 모두 하차역 단독 줄이 키 이름으로 새지 않는다", () => {
    for (const messages of [ko, en, es, fr, itMessages, ja]) {
      const line = alightLineText(
        translator(messages.route.transit as Record<string, string>),
        translator(messages.transitGuide as unknown as Record<string, string>),
        "Gaehwa",
        undefined,
        "1",
      );
      expect(line).not.toBeNull();
      expect(line).not.toMatch(/alightAt|exitBound|\{/);
    }
  });
});

describe("승차 출구는 정확히 한 줄이 싣는다", () => {
  it("도보 다음이 탑승이면 그 도보 줄이 싣는다", () => {
    const legs = [walk(), subway({ board: "1" })];
    expect(boardExitAfterWalk(legs, 0)).toBe("1");
    expect(boardExitOnBoardLine(legs, 1)).toBeNull();
  });

  it("앞에 도보가 없으면 탑승 줄이 싣는다(0m 도보는 화면에서 지워진다)", () => {
    const legs = [bus(), subway({ board: "5" })];
    expect(boardExitOnBoardLine(legs, 1)).toBe("5");
  });

  it("첫 구간이 곧 탑승이어도 탑승 줄이 싣는다", () => {
    const legs = [subway({ board: "2" })];
    expect(boardExitOnBoardLine(legs, 0)).toBe("2");
  });

  it("도보 다음이 도보이거나 마지막 도보면 실을 것이 없다", () => {
    expect(boardExitAfterWalk([walk(), walk()], 0)).toBeNull();
    expect(boardExitAfterWalk([walk()], 0)).toBeNull();
  });

  it("승차 출구가 없는 구간은 어느 줄도 싣지 않는다(환승 leg 포함)", () => {
    const legs = [walk(), subway({ alight: "1" })];
    expect(boardExitAfterWalk(legs, 0)).toBeNull();
    expect(boardExitOnBoardLine(legs, 1)).toBeNull();
  });

  it("도보 구간 자신에게는 탑승 줄 꼬리가 없다", () => {
    expect(boardExitOnBoardLine([walk(), subway({ board: "1" })], 0)).toBeNull();
  });

  it("형식에 맞지 않는 승차 출구는 두 줄 모두 싣지 않는다", () => {
    expect(boardExitAfterWalk([walk(), subway({ board: " " })], 0)).toBeNull();
    expect(boardExitOnBoardLine([bus(), subway({ board: "null" })], 1)).toBeNull();
  });

  it("불변식 — 어떤 구간 배열에서도 한 탑승 구간의 승차 출구는 한 줄에만 실린다", () => {
    const routes: TransitLeg[][] = [
      [walk(), subway({ board: "1" }), walk()],
      [bus(), subway({ board: "5" }), walk()],
      [subway({ board: "2" }), walk(), bus()],
      [walk(), subway({ board: "1" }), subway({ alight: "3" }), walk()],
      [walk(), bus(), walk(), subway({ board: "4" }), walk()],
    ];
    for (const legs of routes) {
      legs.forEach((leg, i) => {
        if (leg.mode === "walk") return;
        const onWalk = i > 0 && legs[i - 1].mode === "walk" ? boardExitAfterWalk(legs, i - 1) : null;
        const onBoard = boardExitOnBoardLine(legs, i);
        expect([onWalk, onBoard].filter(Boolean).length).toBeLessThanOrEqual(1);
        // 서버가 실은 값은 반드시 어느 한 줄에 도달한다(조용한 누락 금지).
        const expected = leg.exit?.board ?? null;
        expect(onWalk ?? onBoard ?? null).toBe(expected);
      });
    }
  });
});

describe("iOS 배선 — 뷰 계층은 테스트 레인이 없어 소스로 잠근다", () => {
  const swift = readFileSync(join(__dirname, "../../../ios/Gildongmu/RouteBriefing.swift"), "utf8");

  it("하차 줄 역명은 구간 줄과 같은 영어 자격 술어를 지난다 (`toName`을 직접 읽지 않는다)", () => {
    // en 세션에서 하차 줄만 "Get off at 여의도"로 떨어졌던 결함(2026-09-13). 구간 줄(`transitLegLine`)과
    // 하차 줄(`TransitRouteRows`)이 Kit `transitLegUsesEnglish` 하나를 봐야 같은 역을 같은 이름으로 부른다.
    expect(swift).toContain("station: transitAlightStationName(leg, lang: AppLanguage.dataLocaleValue)");
    expect(swift).not.toMatch(/station:\s*leg\.toName/);
    expect(swift).toContain("guard transitLegUsesEnglish(leg, lang: AppLanguage.dataLocaleValue)");
    // 종전 인라인 판정이 되살아나면 두 자리가 다시 갈린다.
    expect(swift).not.toContain('AppLanguage.dataLocale == "en"');
  });
});
