import type { NearbyOverview, OverviewPlace } from "./nearby-overview";
import type { CompassDirection } from "./geo/bearing";
import { formatDistance } from "./format";
import { directionParticle, subjectParticle, topicParticle } from "./korean-particle";

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

function nearestSentence(t: OverviewTranslator, items: OverviewPlace[], ko: boolean): string {
  const parts = items.map((p) =>
    t("overview.nearestItem", {
      name: nameAsDestination(p.name, ko),
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

/** 불릿 순서 그대로, 불릿당 문장 묶음 하나. */
export function buildOverviewLines(
  overview: NearbyOverview,
  t: OverviewTranslator,
  locale: string,
): string[] {
  const ko = locale === "ko";
  const radius = formatDistance(overview.radiusMeters);
  return overview.bullets.map((b) => {
    if (b.kind === "transit") {
      const parts: string[] = [];
      if (b.station) {
        parts.push(
          t("overview.transitStation", {
            line: b.station.line ? t("overview.transitLine", { line: b.station.line }) : "",
            name: nameAsDestination(b.station.name, ko),
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
              nearest: nearestSentence(t, bus.nearest, ko),
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
        nearest: nearestSentence(t, b.nearest, ko),
      });
    }
    if (b.state === "none") {
      return t("overview.none", { label: withTopic(label, ko), distance: radius });
    }
    if (b.state === "unavailable") {
      return t("overview.unavailableSeoulOnly", { label: withTopic(label, ko) });
    }
    return t("overview.failedItem", { label });
  });
}
