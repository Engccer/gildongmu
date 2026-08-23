import { formatDistance } from "./format";
import { pedestrianStepFor } from "./pedestrian-action";
import type { WalkRouteBriefing, WalkRouteStep } from "./types";

/**
 * Tmap 보행자 구조화 필드 → 영어 안내 문장(순수 함수, E16 축3 spec
 * `2026-08-23-non-ko-walk-guidance-design.md` §4.3). ko의 `walk-guidance.ts`(재작성)에 대응하는
 * 비-ko 정본이다 — 그쪽은 provider 문장을 다듬지만 이쪽은 구조화 필드에서 **새로 만든다**.
 *
 * ⚠ **문장 틀은 Tmap 한국어 원문의 구조를 그대로 옮긴다.** 거리의 의미(시설을 지난 뒤인지
 * 통과 거리인지)는 우리가 정하는 것이 아니라 공급자가 정한 것이고 ko 사용자는 오늘 그 문장을
 * 듣고 있다 — 구조를 **바꿀 때** 새 위험이 생긴다(설계 리뷰 #9).
 *
 * ⚠ **POI 상호·교차로명은 뺀다.** juso가 로마자화하지 못하는 고유명사이고, 한글을 en 문장에
 * 남기면 영어 음성이 읽지 못한다. 그 결과 `live` 조각도 없고 주기 통지는 이름 없는 틀
 * (`guide.periodicStraightNoName`)로 떨어진다.
 *
 * ⚠ **거리 표기는 `formatDistance`만 지난다** — 문장 안에서 조립하면 같은 화면의 다른 거리와
 * 갈린다(1km 미만을 "0.8km"로 낸 사본 4곳의 전례).
 */

/** 도착 스텝은 거리·도로명을 달지 않는다 — 문장 자체가 종결이다. */
const ARRIVAL_TURN_TYPE = 201;

/**
 * 영어 행동절. 미지 코드·`turnType` 부재는 **경로 전체를 거부**한다(§4.3): 행동절을 빼고
 * `Walk 90m`만 내면 *회전을 말하지 않은 직진 지시*가 되어 조용히 틀린다. 낭독 채널에서
 * 조용히 틀린 안내는 실패보다 나쁘다.
 */
function phraseOf(step: WalkRouteStep): string | null {
  if (step.turnType === undefined) {
    throw new Error(`[walk-en] turnType 없는 스텝: ${step.description}`);
  }
  const entry = pedestrianStepFor(step.turnType);
  if (!entry) throw new Error(`[walk-en] 미지 turnType ${step.turnType}: ${step.description}`);
  return entry.phrase;
}

function sentenceOf(step: WalkRouteStep, roadNames: Map<string, string>): string {
  const phrase = phraseOf(step);
  if (step.turnType === ARRIVAL_TURN_TYPE) return `${phrase}.`;

  const meters = step.distanceMeters;
  const distance = meters !== undefined && meters > 0 ? formatDistance(meters) : null;
  const roadKo = step.roadNameKo;
  const road = roadKo ? (roadNames.get(roadKo) ?? null) : null;
  const along = road ? ` along ${road}` : "";

  if (!distance) return phrase ? `${phrase}.` : "Continue.";
  if (!phrase) return `Walk ${distance}${along}.`;
  return `${phrase}, then walk ${distance}${along}.`;
}

/** 로마자 조회가 필요한 도로명 키(중복 제거). */
export function roadNameKeysOf(briefing: WalkRouteBriefing): string[] {
  return [
    ...new Set(briefing.steps.map((s) => s.roadNameKo).filter((n): n is string => Boolean(n))),
  ];
}

/** 스텝 문장을 영어로 교체한다. 좌표·거리·행동 등 다른 필드는 보존. */
export function buildEnBriefing(
  briefing: WalkRouteBriefing,
  roadNames: Map<string, string>,
): WalkRouteBriefing {
  const steps = briefing.steps.map((step) => {
    const { live: _live, ...rest } = step;
    return { ...rest, description: sentenceOf(step, roadNames) };
  });
  return { ...briefing, steps };
}
