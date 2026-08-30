import type { NearbyOverview, OverviewPlace } from "./nearby-overview";
import type { CompassDirection } from "./geo/bearing";
import { formatDistance } from "./format";
import { directionParticle, subjectParticle, topicParticle } from "./korean-particle";
import { bilingualName } from "./bilingual-name";

/**
 * "한눈에 보기" 불릿 문장 조립 — Kit `buildOverviewLines`(`LocationNarrative.swift`) ↔ CLI
 * `formatNearbyOverview` 미러. 서버는 구조화 데이터만 내고 문장은 소비자가 `whereAmI.overview.*`
 * 템플릿(6 로케일)으로 만든다(LLM 아님). 불릿당 문장 묶음 하나 = 한 접근성 객체.
 *
 * 상태별 문장이 전부 다르다(3-state 불변식: 0건 ≠ 정보 없음 ≠ 실패). 반경 문구는 헤딩 부제가
 * 한 번만 말하고 `none` 문장만 반경을 품는다.
 *
 * 조사는 코드가 고른다(ko만): 라벨은 전부 한글이라 판정 불가가 없고, 장소명은 동적이라 판정
 * 불가(비한글)면 조사 대신 쉼표로 물러난다("GS25, 남쪽 40m" — 조사를 못 정하는 것이 낭독
 * 불능이 되면 안 된다).
 */

/** next-intl `useTranslations("whereAmI")`와 같은 모양 — 컴포넌트가 주입한다. */
export type OverviewTranslator = (key: string, params?: Record<string, string | number>) => string;

/** 불릿 한 줄의 문장 + 한글 병기 꼬리(E28). `secondary`는 병기한 이름들의 한글 원문을 순서대로 쉼표로 이었고, 없으면 null. */
export interface OverviewLine {
  text: string;
  secondary: string | null;
}

/** 불릿 하나가 병기한 한글 이름을 모은다. */
type KoSink = string[];

/**
 * 불릿에 넣을 이름 — 비-ko는 원천 영문(역 `nameEn`) → 로마자 → 한글 순(`bilingualName` 규칙 그대로).
 * 병기한 한글은 sink에 쌓여 줄 끝 괄호가 된다(웹 R1·R5: 괄호는 접근성 객체의 마지막 노드).
 */
function pickName(
  p: { name: string; nameEn?: string; nameRoman?: string },
  locale: string,
  sink: KoSink,
): string {
  const b = bilingualName(locale, p.name, { en: p.nameEn, roman: p.nameRoman });
  if (b.secondary) sink.push(b.secondary);
  return b.primary;
}

function nameAsDestination(name: string, ko: boolean): string {
  if (!ko) return name;
  const particle = directionParticle(name);
  return particle === null ? `${name},` : `${name}${particle}`;
}

function withSubject(label: string, ko: boolean): string {
  return ko ? label + (subjectParticle(label) ?? "") : label;
}

function withTopic(label: string, ko: boolean): string {
  return ko ? label + (topicParticle(label) ?? "") : label;
}

function direction(t: OverviewTranslator, bearing: CompassDirection): string {
  return t(`direction.${bearing}`);
}

function nearestSentence(
  t: OverviewTranslator,
  items: OverviewPlace[],
  locale: string,
  sink: KoSink,
): string {
  const ko = locale === "ko";
  const parts = items.map((p) =>
    t("overview.nearestItem", {
      name: nameAsDestination(pickName(p, locale, sink), ko),
      direction: direction(t, p.bearing),
      distance: formatDistance(p.distanceMeters),
    }),
  );
  return t("overview.nearestLead", { items: parts.join(", ") });
}

const LABEL_KEY = {
  food: "overview.labelFood",
  cafe: "overview.labelCafe",
  kids: "overview.labelKids",
  events: "overview.labelEvents",
  barrierFree: "overview.labelBarrierFree",
} as const;

/** 불릿 순서 그대로, 불릿당 문장 묶음 하나(+한글 병기 꼬리). */
export function buildOverviewLines(
  overview: NearbyOverview,
  t: OverviewTranslator,
  locale: string,
): OverviewLine[] {
  const ko = locale === "ko";
  const radius = formatDistance(overview.radiusMeters);
  return overview.bullets.map((b) => {
    const sink: KoSink = [];
    const text = bulletText(b, t, locale, ko, radius, sink);
    return { text, secondary: sink.length > 0 ? sink.join(", ") : null };
  });
}

function bulletText(
  b: NearbyOverview["bullets"][number],
  t: OverviewTranslator,
  locale: string,
  ko: boolean,
  radius: string,
  sink: KoSink,
): string {
  {
    if (b.kind === "transit") {
      const parts: string[] = [];
      if (b.station) {
        parts.push(
          t("overview.transitStation", {
            line: b.station.line ? t("overview.transitLine", { line: b.station.line }) : "",
            name: nameAsDestination(pickName(b.station, locale, sink), ko),
            direction: direction(t, b.station.bearing),
            distance: formatDistance(b.station.distanceMeters),
          }),
        );
      } else {
        parts.push(t("overview.transitNoStation", { distance: radius }));
      }
      const bus = b.busStops;
      if (bus) {
        if (bus.state === "ok") {
          parts.push(
            t("overview.transitBus", {
              count: bus.count,
              nearest: nearestSentence(t, bus.nearest, locale, sink),
            }),
          );
        } else if (bus.state === "none") parts.push(t("overview.transitBusNone"));
        else if (bus.state === "uncovered") parts.push(t("overview.transitBusUncovered"));
        else parts.push(t("overview.transitBusFailed"));
      }
      return t("overview.transitLead", { body: parts.join(" ") });
    }
    const label = t(LABEL_KEY[b.kind]);
    if (b.state === "ok") {
      return t(b.countCapped ? "overview.okCapped" : "overview.ok", {
        label: withSubject(label, ko),
        count: b.count,
        nearest: nearestSentence(t, b.nearest, locale, sink),
      });
    }
    if (b.state === "none") {
      return t("overview.none", { label: withTopic(label, ko), distance: radius });
    }
    if (b.state === "unavailable") {
      return t("overview.unavailableSeoulOnly", { label: withTopic(label, ko) });
    }
    return t("overview.failedItem", { label });
  }
}
