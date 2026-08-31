import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import itMessages from "../../../messages/it.json";
import ja from "../../../messages/ja.json";

/**
 * 수량 문구 복수형 게이트(A29, spec `docs/superpowers/specs/2026-08-31-plural-forms-design.md` §3.2).
 *
 * "1 places"는 오류도 테스트 실패도 내지 않고 낭독에서만 드러나는 무증상 결함이라
 * 문자열 자원 자체를 판정한다: ① ICU plural 구문이 컴파일되는가 ② one 분기가 other
 * 분기의 수만 바꾼 사본이 아닌가(복사해 넣은 가짜 분기) ③ fr은 0이 one인가 ④ 회피
 * 표기(`(s)`·`/i`·`is/are`)가 남지 않았는가 ⑤ 카테고리 규칙 공유 fixture를
 * `Intl.PluralRules`가 재판정하는가(Kit `LocalizationTests`가 같은 표를 읽는다).
 *
 * ios-extra JSON도 같은 ICU 문법이라 ①~④에 함께 태운다 — iOS 해석기(Kit
 * `resolvePluralBlocks`)는 부분집합이지만 문자열 자원은 한 문법이다.
 */
const WEB: Record<string, unknown> = { ko, en, es, fr, it: itMessages, ja };
const LOCALES = Object.keys(WEB);
const PLURAL_LOCALES = ["en", "es", "fr", "it"];

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, path));
    else out[path] = String(v);
  }
  return out;
}

function loadExtra(locale: string): unknown {
  const file = join(__dirname, "..", "..", "..", "ios", "i18n", "ios-extra", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

const PLURAL_RE = /\{\s*(\w+)\s*,\s*plural\s*,/g;
const ARG_RE = /\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g;
const TAG_RE = /<(\w+)>/g;

function pluralArgs(s: string): string[] {
  return [...new Set([...s.matchAll(PLURAL_RE)].map((m) => m[1]))];
}

/** 모든 인자를 채운 값 사전 — 수량 인자는 n, 나머지는 자리 표시 문자열, 태그는 항등 핸들러. */
function valuesFor(s: string, n: number): Record<string, string | number | ((c: string) => string)> {
  const counts = new Set([...pluralArgs(s), "count"]);
  const values: Record<string, string | number | ((c: string) => string)> = {};
  for (const m of s.matchAll(ARG_RE)) values[m[1]] = counts.has(m[1]) ? n : "x";
  for (const m of s.matchAll(TAG_RE)) values[m[1]] = (chunk: string) => chunk;
  return values;
}

/** 중첩 메시지 객체 그대로 번역기를 만들고 점 경로 키를 t()에 넘긴다. */
function render(src: Source, key: string, n: number): string {
  const t = createTranslator({
    locale: src.locale,
    messages: src.messages as Parameters<typeof createTranslator>[0]["messages"],
    onError: (error) => {
      throw error;
    },
  });
  const values = valuesFor(src.flat[key], n);
  return /<\w+>/.test(src.flat[key])
    ? t.markup(key, values as Parameters<typeof t.markup>[1])
    : t(key, values as Parameters<typeof t>[1]);
}

type Source = { name: string; locale: string; messages: unknown; flat: Record<string, string> };
function source(name: string, locale: string, messages: unknown): Source {
  return { name, locale, messages, flat: flatten(messages) };
}
const SOURCES: Source[] = [
  ...LOCALES.map((locale) => source(`messages/${locale}`, locale, WEB[locale])),
  ...LOCALES.map((locale) => source(`ios-extra/${locale}`, locale, loadExtra(locale))),
];
const web = (locale: string) => SOURCES.find((s) => s.name === `messages/${locale}`)!;

describe("수량 문구 복수형(A29)", () => {
  it("ko·ja에는 plural 블록이 없다(복수 굴절 없음, 문자열 불변)", () => {
    for (const src of SOURCES.filter((s) => s.locale === "ko" || s.locale === "ja")) {
      const offenders = Object.entries(src.flat).filter(([, v]) => pluralArgs(v).length > 0).map(([k]) => k);
      expect(offenders, src.name).toEqual([]);
    }
  });

  it("en·es·fr·it에 plural 키가 실제로 있다(게이트 무력화 하한)", () => {
    for (const locale of PLURAL_LOCALES) {
      const flat = flatten(WEB[locale]);
      const n = Object.values(flat).filter((v) => pluralArgs(v).length > 0).length;
      expect(n, locale).toBeGreaterThanOrEqual(25);
    }
  });

  for (const src of SOURCES.filter((s) => PLURAL_LOCALES.includes(s.locale))) {
    const pluralKeys = Object.entries(src.flat).filter(([, v]) => pluralArgs(v).length > 0).map(([k]) => k);

    it(`${src.name}: plural 키 전부가 1·2에서 컴파일되고 one 분기가 other의 사본이 아니다`, () => {
      const fake: string[] = [];
      for (const key of pluralKeys) {
        const one = render(src, key, 1);
        const other = render(src, key, 2);
        if (other.replaceAll("2", "1") === one) fake.push(`${key}: ${one}`);
        // 인자 자리에 남은 ICU 조각(치환 실패)은 없어야 한다.
        expect(one, key).not.toMatch(/[{}#]/);
        expect(other, key).not.toMatch(/[{}#]/);
      }
      expect(fake).toEqual([]);
    });

    if (src.locale === "fr") {
      it(`${src.name}: 0은 one 분기(CLDR fr)`, () => {
        for (const key of pluralKeys) {
          expect(render(src, key, 0), key).toBe(render(src, key, 1).replaceAll("1", "0"));
        }
      });
    }

    it(`${src.name}: 회피 표기 잔존 없음`, () => {
      const leaked = Object.entries(src.flat)
        .filter(([, v]) => /\w\(s\)/.test(v) || /\w\/i\b/.test(v) || /\bis\/are\b/.test(v))
        .map(([k, v]) => `${k} = ${v}`);
      expect(leaked).toEqual([]);
    });
  }

  // plural 피연산자는 수량 인자여야 한다 — 인자 **집합** 동일성 게이트(i18n-messages)는
  // `{name, plural…}`처럼 엉뚱한 인자에 걸린 블록을 통과시킨다(설계 리뷰 #7). 로케일 간
  // 피연산자 집합은 같지 않아도 된다(en "{bikes} available"은 명사가 없고 es는 형용사가
  // 굴절한다 — 판정 단위는 로케일별 문장, spec §2).
  const NUMERIC_ARGS = new Set(["count", "seconds", "racks", "bikes", "prev", "transfers", "steps", "n"]);
  it("plural 피연산자는 수량 인자 허용 목록 안이다", () => {
    const bad: string[] = [];
    for (const src of SOURCES) {
      for (const [key, value] of Object.entries(src.flat)) {
        for (const name of pluralArgs(value)) {
          if (!NUMERIC_ARGS.has(name)) bad.push(`${src.name} ${key}: 피연산자 ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // en 골든(count=1). 구조 차이 검사(one ≠ other)는 "1 places!" 같은 가짜 분기를 못 잡는다
  // (설계 리뷰 #15) — en plural 키 전부는 여기 승인 문장이 있어야 한다. 비-수량 인자는
  // "x", 태그는 빈 조각.
  const EN_GOLDEN_ONE: Record<string, string> = {
    "search.placeCount": "1 place",
    "search.webCount": "1 web result",
    "search.addressCount": "1 address",
    "route.transit.legBoard": "Board  at , 1 stop",
    "route.transit.legTransfer": "Transfer to  at , 1 stop",
    "route.transit.summary": "x min, x won, 1 transfer",
    "directions.candidateCount": "Found 1 candidate.",
    "directions.readySummary": "Route guidance is ready for 1 mode.",
    "guide.detailStart": "Walking guidance started. 1 instruction, x total. x",
    "guide.rerouteDone": "Route recalculated from your current location. 1 instruction, x total. x",
    "guide.carStart": "Car guidance started. 1 instruction, x total. x",
    "guide.band.transitRiding": "On x, 1 stop left",
    "walkInfra.audioSummary": "1 device within 300m",
    "walkInfra.audioSite": "x, x (1 device)",
    "walkInfra.osmSummary": "1 crosswalk/tactile paving point",
    "whereAmI.overview.transitBus": "There is 1 bus stop. x",
    "transitGuide.started": "Starting transit guidance. 1 ride segment.",
    "transitGuide.boardedCount": "Boarded x. Get off at x, 1 stop.",
    "transitGuide.remainingCount": "1 stop remaining.",
    "transitGuide.stationCountAbout": "About 1 stop.",
    "transitGuide.waitingCount": "1 boarding option.",
    "transitGuide.viaStopsTrain": "1 station on this leg",
    "transitGuide.viaStopsBus": "1 stop on this leg",
    "transitGuide.dataAge": "As of 1 second ago.",
    "bike.availability": "x available · 1 rack",
    "bus.arrival": "Route x x, 1 stop away, in about x min",
    "surroundings.count": "1 place",
    "ios.chat.placesHeading": "1 place",
    "ios.chat.addressesHeading": "1 address",
    "ios.chat.webResultsHeading": "1 web result",
    "ios.search.announceCount": "1 result",
    "ios.route.transfers": "1 transfer",
    "ios.route.stopCount": "1 stop",
    "ios.route.stationCount": "1 station",
    "ios.nearby.bikesAvailable": "1 bike available",
    "ios.nearby.racksTotal": "1 rack",
    "ios.nearby.stopsBefore": "1 stop away",
    "ios.nearby.announcePlaces": "1 place nearby",
    "ios.nearby.announceBikes": "1 bike station nearby",
    "ios.nearby.announceStops": "1 bus stop nearby",
    "ios.nearby.announceStations": "1 station nearby",
    "ios.nearby.announceEvents": "1 event nearby",
    "guide.switchedToShortest": "Switched to the shortest route. 1 step, x total. x",
    "guide.switchedToRecommended": "Switched to the recommended route. 1 step, x total. x",
    "guide.proposalReady": "A route from your current location is ready. 1 step, x total. x",
    "ios.beacon.healthSummary": "You walked 1 step on this leg and burned about x kcal.",
    "ios.beacon.food.ramyeonMany": "That's about 1 bowl of ramyeon!",
  };
  it("en plural 키 전부에 count=1 골든 문장이 있고 일치한다", () => {
    for (const src of SOURCES.filter((s) => s.locale === "en")) {
      for (const [key, value] of Object.entries(src.flat)) {
        if (pluralArgs(value).length === 0) continue;
        expect(EN_GOLDEN_ONE, `${src.name} ${key}: 골든 없음`).toHaveProperty(key);
        expect(render(src, key, 1), `${src.name} ${key}`).toBe(EN_GOLDEN_ONE[key]);
      }
    }
  });

  it("대표 낭독: en 1 place / 2 places, fr 0 lieu, it Trovato 1 candidato, en There is 1 bus stop", () => {
    expect(render(web("en"), "search.placeCount", 1)).toBe("1 place");
    expect(render(web("en"), "search.placeCount", 2)).toBe("2 places");
    expect(render(web("fr"), "search.placeCount", 0)).toBe("0 lieu");
    expect(render(web("it"), "directions.candidateCount", 1)).toBe("Trovato 1 candidato.");
    expect(render(web("en"), "whereAmI.overview.transitBus", 1)).toBe("There is 1 bus stop. x");
    expect(render(web("en"), "route.transit.legBoard", 1)).toBe("Board  at , 1 stop");
    expect(render(web("ko"), "search.placeCount", 1)).toBe("장소 1건");
  });

  // fixture의 `category`는 CLDR 원 카테고리가 아니라 **one/other 두 분기 메시지에서
  // 고르는 분기**다. fr·es·it은 백만 단위에 CLDR `many`가 있지만 우리 문자열은
  // `many` 분기를 정의하지 않아 intl-messageformat이 `other`로 떨어진다 — Kit
  // `pluralCategory`(one/other만)가 맞추는 것은 그 분기 선택이다.
  it("카테고리 규칙 공유 fixture를 Intl.PluralRules가 재판정한다", () => {
    const cases: { lang: string; n: number; category: string }[] = JSON.parse(
      readFileSync(join(__dirname, "fixtures", "plural-category-cases.json"), "utf8"),
    );
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const branch = new Intl.PluralRules(c.lang).select(c.n) === "one" ? "one" : "other";
      expect(branch, `${c.lang} ${c.n}`).toBe(c.category);
    }
  });
});
