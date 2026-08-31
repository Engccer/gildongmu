import { describe, expect, it } from "vitest";
import * as textModule from "../transit-guide-text";
import {
  approachFrameLine,
  arrivedAtBoardStopLine,
  boardedLine,
  boardingContextLine,
  candidateDescLine,
  contextLine,
  currentStationLine,
  frameLine,
  overviewLegLine,
  prewalkArrivedButtonLine,
  prewalkArrivedLine,
  prewalkStartLine,
  selectedVehicleLine,
  terminatesEarlyLine,
  vehiclePassedLine,
  vehicleSelectedLine,
  viaStopLine,
  waitContextLine,
  type TransitTextLine,
} from "../transit-guide-text";
import type { TransitDisplayItem, TransitDisplayLeg } from "../transit-display";

/**
 * 문장 판정 + **발화 sentinel 불변식**(E27 spec §3.7이 요구한 것, 이 마일스톤 spec §5.1).
 *
 * 조인 필드에 자리마다 **서로 다른** 한국어 토큰을 넣는다 — 공통 sentinel 하나면 board/alight
 * 교환·이전 값 재사용·상수 반환이 전부 통과한다(설계 리뷰 #14).
 */
const S = "ᛥ";
const LEG: TransitDisplayLeg = {
  mode: "subway",
  line: { ko: `노선${S}`, en: "Line 5" },
  board: { ko: `승차${S}`, en: "Cheonho" },
  alight: { ko: `하차${S}`, en: "Gwanghwamun" },
  stops: [
    { ko: `경유0${S}`, en: "Stop0" },
    { ko: `경유1${S}`, en: "Stop1" },
  ],
  stationCount: 8,
  walkBeforeMinutes: 3,
  boardOverridden: false,
};
const ITEM: TransitDisplayItem = {
  message: { ko: `메시지${S}`, en: "In 3 min" },
  direction: { ko: `방향${S}`, en: "Down" },
  destination: { ko: `종착${S}`, en: "Hanam" },
  currentLocation: { ko: `현재${S}`, en: "Singil" },
  express: false,
  remainingStops: 3,
  selectable: true,
};

/** 케이스 등록부 — 함수마다 유효 입력과 완비 en 기대값(설계 리뷰 #16: export 순회만으로는 분기를 못 만든다). */
const CASES: {
  fn: (...a: never[]) => TransitTextLine;
  name: string;
  run: (isEn: boolean) => TransitTextLine;
  en: TransitTextLine;
}[] = [
  {
    fn: waitContextLine, name: "waitContextLine(도보 있음)",
    run: (e) => waitContextLine(e, LEG, true),
    en: { parts: [{ key: "waitContextWalk", args: ["3", "Cheonho", "Line 5"] }], lang: "en" },
  },
  {
    fn: waitContextLine, name: "waitContextLine(재선택 뒤엔 도보 문구 없음)",
    run: (e) => waitContextLine(e, { ...LEG, boardOverridden: true }, true),
    en: { parts: [{ key: "waitContext", args: ["Cheonho", "Line 5"] }], lang: "en" },
  },
  {
    fn: boardingContextLine, name: "boardingContextLine",
    run: (e) => boardingContextLine(e, LEG),
    en: { parts: [{ key: "boardingContext", args: ["Cheonho", "Line 5"] }], lang: "en" },
  },
  {
    fn: contextLine, name: "contextLine",
    run: (e) => contextLine(e, LEG),
    en: { parts: [{ key: "context", args: ["Line 5", "Gwanghwamun"] }], lang: "en" },
  },
  {
    fn: frameLine, name: "frameLine(지하철 코드 3 → 다음 역)",
    run: (e) => frameLine(e, LEG, ITEM.message, "3"),
    en: { parts: [{ key: "subwayNextStop", args: ["Gwanghwamun"] }], lang: "en" },
  },
  {
    fn: frameLine, name: "frameLine(지하철 미지 코드 → 원문 병치)",
    run: (e) => frameLine(e, LEG, ITEM.message, "77"),
    en: { parts: [{ text: "In 3 min" }], lang: "en" },
  },
  {
    fn: frameLine, name: "frameLine(버스 → 라벨 프레임)",
    run: (e) => frameLine(e, { ...LEG, mode: "bus" }, ITEM.message, null),
    en: { parts: [{ key: "messageFrame", args: ["Gwanghwamun", "In 3 min"] }], lang: "en" },
  },
  {
    fn: approachFrameLine, name: "approachFrameLine",
    run: (e) => approachFrameLine(e, LEG, ITEM.message),
    en: { parts: [{ key: "approachFrame", args: ["Cheonho", "In 3 min"] }], lang: "en" },
  },
  {
    fn: vehicleSelectedLine, name: "vehicleSelectedLine(설명 있음)",
    run: (e) => vehicleSelectedLine(e, LEG, { ko: `설명${S}`, en: "Bound for Hanam" }),
    en: { parts: [{ key: "vehicleSelected", args: ["Bound for Hanam", "Cheonho"] }], lang: "en" },
  },
  {
    fn: vehicleSelectedLine, name: "vehicleSelectedLine(설명 없으면 노선명)",
    run: (e) => vehicleSelectedLine(e, LEG, null),
    en: { parts: [{ key: "vehicleSelected", args: ["Line 5", "Cheonho"] }], lang: "en" },
  },
  {
    fn: selectedVehicleLine, name: "selectedVehicleLine",
    run: (e) => selectedVehicleLine(e, { ko: `설명${S}`, en: "Bound for Hanam" }),
    en: { parts: [{ key: "selectedVehicle", args: ["Bound for Hanam"] }], lang: "en" },
  },
  {
    fn: vehiclePassedLine, name: "vehiclePassedLine",
    run: (e) => vehiclePassedLine(e, LEG),
    en: { parts: [{ key: "vehiclePassed", args: ["Cheonho"] }], lang: "en" },
  },
  {
    fn: arrivedAtBoardStopLine, name: "arrivedAtBoardStopLine",
    run: (e) => arrivedAtBoardStopLine(e, LEG),
    en: { parts: [{ key: "arrivedAtBoardStop", args: ["Line 5"] }], lang: "en" },
  },
  {
    fn: boardedLine, name: "boardedLine(정거장 수 있음)",
    run: (e) => boardedLine(e, LEG),
    en: { parts: [{ key: "boardedCount", args: ["Line 5", "Gwanghwamun", "8"] }], lang: "en" },
  },
  {
    fn: boardedLine, name: "boardedLine(정거장 수 없음)",
    run: (e) => boardedLine(e, { ...LEG, stationCount: null }),
    en: { parts: [{ key: "boarded", args: ["Line 5", "Gwanghwamun"] }], lang: "en" },
  },
  {
    fn: currentStationLine, name: "currentStationLine",
    run: (e) => currentStationLine(e, ITEM.currentLocation!),
    en: { parts: [{ key: "currentStation", args: ["Singil"] }], lang: "en" },
  },
  {
    fn: candidateDescLine, name: "candidateDescLine(급행·관측 시각 포함)",
    run: (e) => candidateDescLine(e, LEG, ITEM, { express: true, departedMinutes: 2 }),
    en: {
      parts: [
        { key: "bound", args: ["Hanam"] },
        { text: "Down" },
        { text: "In 3 min" },
        { key: "expressCheck", args: ["Gwanghwamun"] },
        { key: "departed", args: ["2"] },
      ],
      lang: "en",
    },
  },
  {
    fn: terminatesEarlyLine, name: "terminatesEarlyLine",
    run: (e) => terminatesEarlyLine(e, LEG, ITEM),
    en: { parts: [{ key: "terminatesEarly", args: ["Hanam", "Gwanghwamun"] }], lang: "en" },
  },
  {
    fn: viaStopLine, name: "viaStopLine(승차·현재 위치)",
    run: (e) => viaStopLine(e, LEG.stops[0], "board", true),
    en: {
      parts: [{ text: "Stop0" }, { key: "viaBoard", args: [] }, { key: "viaCurrent", args: [] }],
      lang: "en",
    },
  },
  {
    fn: overviewLegLine, name: "overviewLegLine",
    run: (e) => overviewLegLine(e, 2, LEG.line, LEG.board, LEG.alight),
    en: { parts: [{ key: "overviewLeg", args: ["2", "Line 5", "Cheonho", "Gwanghwamun"] }], lang: "en" },
  },
  {
    fn: prewalkStartLine, name: "prewalkStartLine",
    run: (e) => prewalkStartLine(e, LEG.board, 4),
    en: { parts: [{ key: "prewalkStart", args: ["Cheonho", "4"] }], lang: "en" },
  },
  {
    fn: prewalkArrivedLine, name: "prewalkArrivedLine",
    run: (e) => prewalkArrivedLine(e, LEG.board),
    en: { parts: [{ key: "prewalkArrived", args: ["Cheonho"] }], lang: "en" },
  },
  {
    fn: prewalkArrivedButtonLine, name: "prewalkArrivedButtonLine",
    run: (e) => prewalkArrivedButtonLine(e, LEG.board),
    en: { parts: [{ key: "prewalkArrivedButton", args: ["Cheonho"] }], lang: "en" },
  },
];

function textOf(l: TransitTextLine): string {
  return l.parts.map((p) => ("key" in p ? `${p.key}(${p.args.join(",")})` : p.text)).join(" ");
}

describe("descriptor — 완비 en에서 정확한 키·인자·언어", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(c.run(true)).toEqual(c.en);
    });
  }

  it("어떤 발화에도 조인 sentinel이 나오지 않는다(§3.7 불변식)", () => {
    for (const c of CASES) {
      expect(textOf(c.run(true)), c.name).not.toContain(S);
    }
  });
});

describe("역방향 — 영문 조각이 하나라도 없으면 그 줄은 통째로 ko", () => {
  const holes: { name: string; leg?: Partial<TransitDisplayLeg>; item?: Partial<TransitDisplayItem> }[] = [
    { name: "노선명 결측", leg: { line: { ko: `노선${S}` } } },
    { name: "승차역 결측", leg: { board: { ko: `승차${S}` } } },
    { name: "하차역 결측", leg: { alight: { ko: `하차${S}` } } },
    { name: "완성 문장 결측", item: { message: { ko: `메시지${S}` } } },
    { name: "종착역 결측", item: { destination: { ko: `종착${S}` } } },
  ];

  for (const hole of holes) {
    it(`${hole.name} → 그 조각을 쓰는 줄이 정확한 ko 인자와 lang="ko"를 낸다`, () => {
      const leg = { ...LEG, ...hole.leg };
      const item = { ...ITEM, ...hole.item };
      // 각 줄이 "무언가 ko가 됐다"가 아니라 **정확한 ko 결과**를 내는지 본다(설계 리뷰 #15).
      if (hole.leg?.line) {
        expect(contextLine(true, leg)).toEqual({
          parts: [{ key: "context", args: [`노선${S}`, `하차${S}`] }],
          lang: "ko",
        });
      }
      if (hole.leg?.board) {
        expect(boardingContextLine(true, leg)).toEqual({
          parts: [{ key: "boardingContext", args: [`승차${S}`, `노선${S}`] }],
          lang: "ko",
        });
      }
      if (hole.leg?.alight) {
        expect(frameLine(true, { ...leg, mode: "bus" }, item.message, null)).toEqual({
          parts: [{ key: "messageFrame", args: [`하차${S}`, `메시지${S}`] }],
          lang: "ko",
        });
      }
      if (hole.item?.message) {
        expect(approachFrameLine(true, leg, item.message)).toEqual({
          parts: [{ key: "approachFrame", args: [`승차${S}`, `메시지${S}`] }],
          lang: "ko",
        });
      }
      if (hole.item?.destination) {
        expect(candidateDescLine(true, leg, item, { express: false, departedMinutes: null })).toEqual({
          parts: [
            { key: "bound", args: [`종착${S}`] },
            { text: `방향${S}` },
            { text: `메시지${S}` },
          ],
          lang: "ko",
        });
      }
    });
  }

  it("message 슬롯의 빈 문자열은 자리 표시라 영어 줄이 유지된다(TAGO)", () => {
    const tago: TransitDisplayItem = { ...ITEM, message: { ko: "", en: "" } };
    expect(
      candidateDescLine(true, LEG, { ...tago, destination: null }, {
        express: false,
        departedMinutes: null,
      }),
    ).toEqual({ parts: [{ text: "Down" }], lang: "en" });
  });
});

describe("등록부 완전성", () => {
  it("모듈의 전 문장 함수가 케이스 등록부에 있다 — 새 프레임을 더하고 테스트를 안 고치는 경로 차단", () => {
    const registered = new Set(CASES.map((c) => c.fn));
    const exported = Object.entries(textModule).filter(
      ([name, v]) => typeof v === "function" && name.endsWith("Line"),
    );
    expect(exported.length).toBeGreaterThan(0);
    for (const [name, fn] of exported) {
      expect(registered.has(fn as (...a: never[]) => TransitTextLine), `미등록: ${name}`).toBe(true);
    }
  });

  it("TRANSIT_TEXT_KEYS가 실제로 나오는 키를 전부 담는다", () => {
    const emitted = new Set<string>();
    for (const c of CASES) {
      for (const isEn of [true, false]) {
        for (const p of c.run(isEn).parts) if ("key" in p) emitted.add(p.key);
      }
    }
    // subway 프레임 4종은 코드별 분기라 위 케이스에서 일부만 나온다 — 직접 채운다.
    for (const code of ["0", "1", "2", "4", "5"]) {
      for (const p of frameLine(true, LEG, ITEM.message, code).parts) {
        if ("key" in p) emitted.add(p.key);
      }
    }
    for (const key of emitted) {
      expect(textModule.TRANSIT_TEXT_KEYS as readonly string[], key).toContain(key);
    }
  });
});

// === 공유 fixture(웹 ↔ Kit 동조) ===

import fixtureFile from "./fixtures/transit-guide-text-cases.json";
import type { TransitLabel } from "../transit-display";

interface FixtureCase {
  name: string;
  fn: string;
  isEn: boolean;
  expect: TransitTextLine;
  leg?: TransitDisplayLeg;
  item?: TransitDisplayItem;
  message?: TransitLabel;
  arrivalCode?: string | null;
  desc?: TransitLabel | null;
  location?: TransitLabel;
  station?: TransitLabel;
  stop?: TransitLabel;
  role?: "board" | "via" | "alight";
  here?: boolean;
  isCurrentLeg?: boolean;
  express?: boolean;
  departedMinutes?: number | null;
  minutes?: number;
  n?: number;
  line?: TransitLabel;
  board?: TransitLabel;
  alight?: TransitLabel;
}

function runFixtureCase(c: FixtureCase): TransitTextLine {
  const e = c.isEn;
  switch (c.fn) {
    case "waitContext": return waitContextLine(e, c.leg!, c.isCurrentLeg!);
    case "boardingContext": return boardingContextLine(e, c.leg!);
    case "context": return contextLine(e, c.leg!);
    case "frame": return frameLine(e, c.leg!, c.message!, c.arrivalCode ?? null);
    case "approachFrame": return approachFrameLine(e, c.leg!, c.message!);
    case "vehicleSelected": return vehicleSelectedLine(e, c.leg!, c.desc ?? null);
    case "selectedVehicle": return selectedVehicleLine(e, c.desc!);
    case "vehiclePassed": return vehiclePassedLine(e, c.leg!);
    case "arrivedAtBoardStop": return arrivedAtBoardStopLine(e, c.leg!);
    case "boarded": return boardedLine(e, c.leg!);
    case "currentStation": return currentStationLine(e, c.location!);
    case "candidateDesc":
      return candidateDescLine(e, c.leg!, c.item!, {
        express: c.express!,
        departedMinutes: c.departedMinutes ?? null,
      });
    case "terminatesEarly": return terminatesEarlyLine(e, c.leg!, c.item!);
    case "viaStop": return viaStopLine(e, c.stop!, c.role!, c.here!);
    case "overviewLeg": return overviewLegLine(e, c.n!, c.line!, c.board!, c.alight!);
    case "prewalkStart": return prewalkStartLine(e, c.station!, c.minutes!);
    case "prewalkArrived": return prewalkArrivedLine(e, c.station!);
    case "prewalkArrivedButton": return prewalkArrivedButtonLine(e, c.station!);
    default: throw new Error(`미지 fn: ${c.fn}`);
  }
}

describe("descriptor 공유 fixture — Kit TransitGuideTextTests와 한 표", () => {
  const cases = (fixtureFile as unknown as { cases: FixtureCase[] }).cases;
  it("케이스가 비어 있지 않다", () => expect(cases.length).toBeGreaterThan(20));
  for (const c of cases) {
    it(c.name, () => {
      expect(runFixtureCase(c)).toEqual(c.expect);
    });
  }
});
