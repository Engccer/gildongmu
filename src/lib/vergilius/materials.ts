/**
 * 앱이 보낸 재료를 모델에게 주는 글로 조립한다(E82 spec V18·§4). React/Next 비의존, 순수 함수.
 *
 * ⚠ **좌표를 넣지 않는다.** 글에 실리는 것은 가게의 id·이름·분류·구획·좌우·거리와 상황 값뿐이다. 요청의 `location`과
 * `places[].lat/lng`는 이 함수가 읽지 않는다(가드 `materials.test.ts`: 요청 좌표의 숫자열이 글에 없다).
 *
 * 방향을 모르면(`headingKnown === false`) 앱이 어떤 구획·좌우를 보냈든 「모름」으로 적는다 — 「방향을 모르면 좌우와 앞을
 * 말하지 않는다」(V19)를 지침에만 맡기지 않고 재료에서 먼저 지운다.
 */
import { formatDistance } from "@/lib/format";
import type { VergiliusAskRequest, VergiliusLogEntry, VergiliusPlace } from "./types";

const ZONE_LABEL: Record<VergiliusPlace["zone"], string> = {
  ahead: "앞",
  beside: "옆",
  behind: "지나옴",
  unknown: "모름",
};

const SIDE_LABEL: Record<VergiliusPlace["side"], string> = {
  left: "왼쪽",
  right: "오른쪽",
  unknown: "모름",
};

const LOG_KIND_LABEL: Record<VergiliusLogEntry["kind"], string> = {
  place: "가게",
  crosswalk: "횡단보도",
  junction: "갈림길",
  road: "길 이름",
  answer: "답",
};

function agoLabel(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}초 전`;
  return `${Math.round(s / 60)}분 전`;
}

function placeLine(p: VergiliusPlace, headingKnown: boolean): string {
  const zone = headingKnown ? ZONE_LABEL[p.zone] : ZONE_LABEL.unknown;
  const side = headingKnown ? SIDE_LABEL[p.side] : SIDE_LABEL.unknown;
  return [p.id, p.name, p.category || "분류 없음", zone, side, formatDistance(p.distance)].join(" | ");
}

function logLine(entry: VergiliusLogEntry): string {
  const cells = [agoLabel(entry.agoSeconds), LOG_KIND_LABEL[entry.kind], entry.text];
  if (entry.placeId) cells.push(`id ${entry.placeId}`);
  return cells.join(" | ");
}

export function buildVergiliusMaterial(req: VergiliusAskRequest): string {
  const lines: string[] = [];

  lines.push("[상황]");
  lines.push(`진행 방향: ${req.headingKnown ? "알고 있음" : "모름"}`);
  lines.push(`지금 걷는 길: ${req.roadName ? req.roadName : "정보 없음"}`);
  lines.push(
    `다음 횡단보도: ${req.nextCrosswalkMeters === null ? "정보 없음" : `${formatDistance(req.nextCrosswalkMeters)} 앞`}`,
  );
  lines.push(
    `앞쪽 갈림길: ${
      req.junctionAhead === null
        ? "정보 없음"
        : `${formatDistance(req.junctionAhead.meters)} 앞, ${req.junctionAhead.branches}갈래`
    }`,
  );

  lines.push("");
  lines.push("[주변 가게] 가까운 순. id | 이름 | 분류 | 구획 | 좌우 | 거리");
  if (req.places.length === 0) lines.push("(앱이 아는 가게가 없다)");
  else for (const p of req.places) lines.push(placeLine(p, req.headingKnown));

  lines.push("");
  lines.push("[방금 말한 것] 최신이 위. 언제 | 종류 | 말한 문장");
  if (req.log.length === 0) lines.push("(아직 말한 것이 없다)");
  else for (const entry of req.log) lines.push(logLine(entry));

  lines.push("");
  lines.push("[질문]");
  lines.push(req.question);

  return lines.join("\n");
}
