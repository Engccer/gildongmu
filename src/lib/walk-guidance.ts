import { formatDistance } from "./format";
import type { WalkRouteBriefing, WalkRouteStep } from "./types";

/**
 * 카카오 도보 안내문 재작성(순수 함수, ko 전용).
 *
 * 종전 계약은 "provider 완성 문장이 낭독 정본, 재조합 금지"였다. 그 규칙은
 * 원문을 건드리다 문법이 깨지는 것을 막으려던 것인데, 실호출 364단계 전수
 * 조사로 카카오 문형이 소수의 규칙적 조합임이 확정되어 위원장 판정(2026-08-07)
 * 으로 뒤집었다. 판정 근거는 가독성·일관성이며, 원문이 그대로는 다음 셋을
 * 만족하지 못했다:
 *
 *  1. **거리 침묵 39%**(115/296) — 횡단보도 전량과 역사 내 이동이 거리를 말하지
 *     않는다. 서울역 7번 출구까지 "역사 내 이동"이 실제로는 411m다. 값 자체는
 *     이미 step.distanceMeters에 있는데 문장에만 없었다.
 *  2. **괄호 도로명** — "107m 이동(천호대로)"의 괄호는 SR 구두점 설정에 따라
 *     낭독되지 않아 도로명의 역할이 사라진다. 자동차 브리핑은 이미 Tmap 원문이
 *     "명일로를 따라 244m 이동" 꼴이라 모드 간 어순도 갈려 있었다.
 *  3. **"왼쪽길로"** — "왼쪽 길로"를 붙여 쓴 것이라 "왼쪽길"이라는 명사처럼
 *     읽히고, 자리가 거리 바로 앞이라 목적지를 다 들은 뒤에야 방향이 나온다.
 *     걷는 사람에게 필요한 순서(먼저 돌고 → 어디까지 → 얼마나)의 역순이었다.
 *
 * 결과 틀: `{어디서} {어느 쪽으로 돌아} {어디까지} {어느 길을 따라} {거리} 이동`
 *
 * ⚠ **미매칭 문장은 원문 그대로 통과시킨다(fail-safe).** 카카오가 새 문형을
 * 내면 그 문장만 종전대로 낭독되고 나머지는 정상이다 — 재작성 실패가 낭독
 * 불능이 되지 않게 하는 것이 규칙 확장보다 우선이다. Tmap 폴백 문장과
 * withStepFree의 안전 문장도 같은 경로로 자연히 보존된다(어미가 다르다).
 */

const DIST = String.raw`\d+(?:\.\d+)?\s*k?m`;

/**
 * "…이동" 문장. head는 앞부분을 통째로 흡수한 뒤 HEAD로 재분해한다 —
 * "…에서"/"…까지"만 받는 좁은 패턴은 "길동역 1번 출구 진출 후 94m 이동(양재대로)"
 * 류 5건을 놓쳐 그 문장들만 괄호가 남았다(전수 검사로 검출).
 * road 그룹이 `이동(…)$` 앵커에 묶여 있는 것이 핵심이다: "삼성역 2호선
 * 7번출구(임시폐쇄) 앞에서 326m 이동(영동대로)"에서 마지막 괄호만 도로명이라,
 * 괄호를 훑는 방식이었다면 "임시폐쇄를 따라"가 나갔다.
 */
// ⚠ 이름 있는 캡처 그룹은 tsconfig target(ES2017)에서 컴파일 오류다 — 인덱스 그룹만 쓴다.
/** [1] 앞부분 [2] 방향 [3] 거리 [4] 도로명 */
const MOVE = new RegExp(
  `^(.*?)(?:(왼쪽|오른쪽)길로 )?(${DIST}) 이동(?:\\(([^)]*)\\))?$`,
);
/** head 재분해 [1] …에서 [2] …까지. 그 밖의 꼴이면 전부 from으로 둔다(방향 앞). */
const HEAD = /^(?:(.+?에서) )?(.+까지)$/;
/** [1] …에서 [2] …까지 [3] 개수 [4] 시설 */
const CROSS = /^(?:(.+?에서) )?(?:(.+?까지) )?(?:(\d+)개의 )?(횡단보도|지하보도) 이용$/;
/** [1] …에서 */
const BRIDGE = /^(?:(.+?에서) )?교량 진입$/;
/**
 * 이미 거리를 말하는 문장인지. `DIST`(표준 m·km)보다 넓게 한글 단위까지 본다 —
 * 마지막 `이동` 폴백이 **모든** 미매칭 "…이동" 문장을 대상으로 삼기 때문에,
 * 표기만 다른 문장("100미터 이동")이 오면 "100미터 100m 이동"으로 거리가 겹친다
 * (codex 적대적 리뷰 검출 2026-08-07, 실호출 364단계엔 미관측이나 코드상 확정).
 * 폴백을 "역사 내 이동"으로 좁히지 않는 이유는 어미가 다른 실제 문장들이
 * 같은 폴백으로 거리를 얻기 때문이다("엘레베이터를 이용하여 강동역으로 이동" 등).
 */
const HAS_DISTANCE = /\d+(?:\.\d+)?\s*(?:km|m|미터|킬로미터)/;

/**
 * 목적격 조사. 실측 도로명 58종은 전부 한글이라 받침으로 판정되지만("…길"→을,
 * "…로"→를), 한글이 아니면 조사를 정할 수 없으므로 null을 돌려 그 문장의
 * 도로명 삽입만 포기한다(괄호 원문 보존).
 */
function objectParticle(word: string): string | null {
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0 ? "을" : "를";
}

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** 안내문 한 줄 재작성. 규칙에 걸리지 않으면 원문 그대로 돌려준다. */
export function rewriteWalkGuidance(description: string, meters?: number): string {
  const move = MOVE.exec(description);
  if (move) {
    const [, head = "", turn, dist, road] = move;
    const trimmed = head.trim();
    const parsed = HEAD.exec(trimmed);
    const from = parsed ? parsed[1] : trimmed || undefined;
    const to = parsed?.[2];
    // 조사를 못 정하는 도로명은 문장 안으로 옮기지 않는다 — 괄호째 원문 유지.
    const particle = road ? objectParticle(road) : null;
    if (road && !particle) return description;
    return `${join(
      from,
      turn ? `${turn}으로 돌아` : undefined,
      to,
      road ? `${road}${particle} 따라` : undefined,
      dist,
    )} 이동`;
  }

  // 아래 규칙들은 원문에 거리가 없어 distanceMeters를 문장 안으로 들여온다.
  if (meters === undefined) return description;
  // 거리 표기 정본은 formatDistance 하나뿐이다 — 여기서 조립하면 같은 화면의
  // 다른 거리와 갈린다(1km 미만을 "0.8km"로 낸 사본 4곳의 전례).
  const dist = formatDistance(meters);

  const cross = CROSS.exec(description);
  if (cross) {
    const [, from, to, count, kind] = cross;
    // 개수는 **2 이상일 때만**. 실측 31건이 전부 "2개의"라 "1개의"는 미관측이지만,
    // 온다면 "횡단보도 1개 이용"은 개수 정보가 아닌 데다 병합 게이트
    // (`MERGED_CROSSWALK`)를 잘못 열어 **단일 횡단보도의 신호기 주석을 지운다**.
    const merged = Number(count) > 1;
    const tail = merged ? `${kind} ${count}개 이용` : `${kind} 이용`;
    return `${join(from, to, dist)} 이동, ${tail}`;
  }

  const bridge = BRIDGE.exec(description);
  if (bridge) {
    // "N m 이동, 교량 진입"은 다리에 올라선 뒤 걷는 순서가 뒤집혀 들린다 —
    // 도로명과 같은 "…를 따라 이동" 틀로 통일한다(위원장 판정 2026-08-07).
    return `${join(bridge[1], "교량을 따라", dist)} 이동`;
  }

  // "…역사 내 이동"류: 목적어 없이 동사로 끝나므로 거리만 앞에 끼운다.
  if (description.endsWith("이동") && !HAS_DISTANCE.test(description)) {
    return `${description.slice(0, -2)}${dist} 이동`;
  }
  return description;
}

/** 브리핑 전체 재작성. description 외 필드(좌표·거리)는 그대로 보존한다. */
export function rewriteWalkBriefing(briefing: WalkRouteBriefing): WalkRouteBriefing {
  const steps: WalkRouteStep[] = briefing.steps.map((step) => ({
    ...step,
    description: rewriteWalkGuidance(step.description, step.distanceMeters),
  }));
  return { ...briefing, steps };
}
