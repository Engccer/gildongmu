import { formatDistance } from "./format";
// 조사 판정은 공용 모듈이 정본이다 — 최종 접근 안내문도 같은 판정을 쓰므로
// 사본을 두면 두 낭독이 갈린다(2026-08-09 승격).
import { objectParticle } from "./korean-particle";
import type { Coord, WalkRouteBriefing, WalkRouteStep } from "./types";
import type { GuideAction } from "./walk-action";
import {
  ROAD_CROSS_MIN_LENGTH_M,
  crossesWalkedRoad,
  crossingClockOf,
  firstSegmentBearing,
  referenceBearing,
  splitMergedCrossing,
  type CrossingPiece,
} from "./walk-crossing";

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

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * 실시간 표시 계층용 구조화 조각(spec 2026-08-11 §5). 추출 실패 필드는 부재 —
 * 클라이언트가 한국어 문장을 재파싱해 얻지 않는다(재조합 금지 계약의 연장).
 */
export interface WalkLiveFragments {
  /** 직진 목표 이름("빵집까지"의 까지 앞). */
  target?: string;
  /** 경계 기준 이름("카페 앞에서"의 에서·후행 '앞' 제거). */
  anchor?: string;
}

/** "…에서" 절 → 기준 이름. 후행 " 앞"은 벗긴다(예고 틀이 "앞에서"를 붙인다). */
function anchorFrom(from: string | undefined): string | undefined {
  if (!from?.endsWith("에서")) return undefined;
  let name = from.slice(0, -2).trim();
  if (name.endsWith(" 앞")) name = name.slice(0, -2).trim();
  return name || undefined;
}

/** "…까지" 절 → 목표 이름. */
function targetFrom(to: string | undefined): string | undefined {
  if (!to?.endsWith("까지")) return undefined;
  const name = to.slice(0, -2).trim();
  return name || undefined;
}

function liveOf(target?: string, anchor?: string): WalkLiveFragments | undefined {
  if (!target && !anchor) return undefined;
  return { ...(target && { target }), ...(anchor && { anchor }) };
}

/** 안내문 한 줄 재작성 + 구조화 조각. 규칙에 걸리지 않으면 원문 그대로 돌려준다. */
export function rewriteWalkGuidanceWithLive(
  description: string,
  meters?: number,
): { text: string; live?: WalkLiveFragments; crossing?: true } {
  const move = MOVE.exec(description);
  if (move) {
    const [, head = "", turn, dist, road] = move;
    const trimmed = head.trim();
    const parsed = HEAD.exec(trimmed);
    const from = parsed ? parsed[1] : trimmed || undefined;
    const to = parsed?.[2];
    // anchor는 HEAD 매칭과 무관하게 from 절에서 본다 — HEAD는 까지 절이 필수라
    // "가람식당 앞에서 …" 같은 까지 없는 문장에서 매칭이 실패하는데(실호출 확정),
    // 그 head도 기준 이름이다. "…진출 후" 류 서술은 anchorFrom의 "에서" 종결
    // 조건이 걸러 낸다.
    const live = liveOf(targetFrom(to), anchorFrom(from));
    // 조사를 못 정하는 도로명은 문장 안으로 옮기지 않는다 — 괄호째 원문 유지.
    // 파싱된 조각은 그래도 참이므로 live는 붙인다.
    const particle = road ? objectParticle(road) : null;
    if (road && !particle) return { text: description, live };
    return {
      text: `${join(
        from,
        turn ? `${turn}으로 돌아` : undefined,
        to,
        road ? `${road}${particle} 따라` : undefined,
        dist,
      )} 이동`,
      live,
    };
  }

  // 아래 규칙들은 원문에 거리가 없어 distanceMeters를 문장 안으로 들여온다.
  if (meters === undefined) return { text: description };
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
    // 행동 동사 우선(위원장 실보행 판정 2026-08-10): 종전 "{거리} 이동, 횡단보도
    // 이용"은 전언이 행동을 말하지 않았다 — 임박 큐와 같은 동사로 문장을 세우고
    // 거리는 꼬리에 둔다("카페 앞에서 횡단보도를 건너세요, 횡단보도 길이 21m").
    // ⚠ 꼬리는 **무엇의 거리인지 이름을 달고** 나간다(위원장 실보행 판정 2026-08-11):
    // 벌거벗은 "21m"는 같은 화면·낭독의 다른 거리(구간 잔여·다음 안내까지)와
    // 구분되지 않아 "21m 더 가서 건너라"로 들린다. 문장에 "횡단보도"가 두 번
    // 나오는 중복은 그 혼동을 없애는 대가로 의도적으로 수용한다.
    // 병합 표현 "횡단보도 N개"는 MERGED_CROSSWALK 게이트가 그대로 매칭하고,
    // 임박 분류(walkStepAction)의 "횡단보도" 부분 문자열 마커도 유지된다.
    const action =
      kind === "횡단보도"
        ? merged
          ? `횡단보도 ${count}개를 건너세요`
          : "횡단보도를 건너세요"
        : merged
          ? `지하보도 ${count}개로 건너세요`
          : "지하보도로 건너세요";
    return {
      text: `${join(from, to, action)}, ${kind} 길이 ${dist}`,
      live: liveOf(targetFrom(to), anchorFrom(from)),
      // 구간 전체가 횡단인 스텝은 이 분기뿐이다(A26). 표시 계층은 이 플래그로 횡단 유닛을
      // 세운다 — 문장의 "건너"를 다시 찾지 않는다(언어 무관).
      crossing: true,
    };
  }

  const bridge = BRIDGE.exec(description);
  if (bridge) {
    // "N m 이동, 교량 진입"은 다리에 올라선 뒤 걷는 순서가 뒤집혀 들린다 —
    // 도로명과 같은 "…를 따라 이동" 틀로 통일한다(위원장 판정 2026-08-07).
    return {
      text: `${join(bridge[1], "교량을 따라", dist)} 이동`,
      live: liveOf(undefined, anchorFrom(bridge[1])),
    };
  }

  // "…역사 내 이동"류: 목적어 없이 동사로 끝나므로 거리만 앞에 끼운다.
  if (description.endsWith("이동") && !HAS_DISTANCE.test(description)) {
    return { text: `${description.slice(0, -2)}${dist} 이동` };
  }
  return { text: description };
}

/** 종전 계약 유지 래퍼 — 기존 소비자는 문자열만 필요하다. */
export function rewriteWalkGuidance(description: string, meters?: number): string {
  return rewriteWalkGuidanceWithLive(description, meters).text;
}

/**
 * 브리핑 전체 재작성. description 외 필드(좌표·거리)는 그대로 보존한다.
 * ⚠ `includeLive`는 기본값 없는 필수 인자다 — 응답 모양을 바꾸는 스위치라 호출
 * 지점이 판단을 건너뛸 수 없어야 한다([[no-default-for-safety-parameters]] 동형).
 * live 조각은 `includeGeometry=1`(실시간 안내 옵트인) 응답에만 싣는다(spec §5).
 */
export function rewriteWalkBriefing(
  briefing: WalkRouteBriefing,
  includeLive: boolean,
): WalkRouteBriefing {
  const steps: WalkRouteStep[] = briefing.steps.map((step) => {
    const { text, live, crossing } = rewriteWalkGuidanceWithLive(
      step.description,
      step.distanceMeters,
    );
    return {
      ...step,
      description: text,
      ...(includeLive && live ? { live } : {}),
      ...(includeLive && crossing ? { crossing } : {}),
    };
  });
  return { ...briefing, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// 판본 2(E62, spec `2026-10-03-crosswalk-guidance-design.md` §3) — 옵트인 `wording=2`.
// 판본 1(위)은 스토어 iOS 2.0·1.19와 안드로이드가 받는 문장이라 손대지 않는다(§1: 그 빌드들은 횡단 스텝 문장을
// 15초마다 되읽어, 새 문장이 가면 차도 위에서 "9시 방향으로 도세요"를 듣는다).
// ─────────────────────────────────────────────────────────────────────────────

/** 서버 안내 문장의 판본. 1 = 종전(미지정 응답), 2 = E62 문안 확정본. 기본값 없음. */
export type WalkWording = 1 | 2;

/** 판본 2 재작성 선택지. 셋 다 기본값 없는 필수 — 응답 모양을 바꾸는 스위치다. */
export interface WalkWordingV2Options {
  /** live·crossing·parts·crossingClock를 싣는가(`includeGeometry=1`). */
  includeLive: boolean;
  /**
   * 경로 기하로 방향·분해를 판정하는가. 카카오 스텝만 참 — Tmap 폴백 스텝의 기하는 다음 결정 지점까지의
   * LineString이라 방위가 횡단을 뜻하지 않는다(spec §3.3).
   */
  geometry: boolean;
  /** 건너는 길 이름(옵트인 `crossingRoad=1`, iOS 실험판만). */
  crossingRoad: boolean;
}

/** 이동 문장 분해 결과(재작성 전 원재료). */
interface MoveParts {
  from?: string;
  turn?: "왼쪽" | "오른쪽";
  to?: string;
  dist: string;
  road?: string;
}

function parseMove(description: string): MoveParts | null {
  const move = MOVE.exec(description);
  if (!move) return null;
  const [, head = "", turn, dist, road] = move;
  const trimmed = head.trim();
  const parsed = HEAD.exec(trimmed);
  return {
    from: parsed ? parsed[1] : trimmed || undefined,
    turn: turn as MoveParts["turn"],
    to: parsed?.[2],
    dist,
    road,
  };
}

/** "{name}을/를 향해". 조사를 못 정하면 null — 그 자리 조각을 뺀다(지어내지 않는다). */
function towardOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const particle = objectParticle(name);
  return particle ? `${name}${particle} 향해` : undefined;
}

/** 시계 방향 회전 문장(마침표 없음). 6시는 "뒤로 도세요"(문안 확정본 다). */
function clockTurn(clock: number): string {
  return clock === 6 ? "뒤로 도세요" : `${clock}시 방향으로 도세요`;
}

/** 재작성 한 스텝의 결과. `parts`·`clock`은 includeLive 게이트 전의 원재료다. */
interface V2Step {
  text: string;
  parts?: { turn: string; body: string };
  action?: GuideAction;
  resolved: boolean;
  crossing?: true;
  clock?: number;
  live?: WalkLiveFragments;
}

/** 회전을 끊어 말하는 조립: "{turn}. 그 후 {body}". */
function turned(turn: string, body: string): Pick<V2Step, "text" | "parts"> {
  return { text: `${turn}. 그 후 ${body}`, parts: { turn, body } };
}

function moveV2(description: string, m: MoveParts): V2Step {
  const live = liveOf(targetFrom(m.to), anchorFrom(m.from));
  const action: GuideAction | undefined =
    m.turn === "왼쪽" ? "left" : m.turn === "오른쪽" ? "right" : undefined;
  const particle = m.road ? objectParticle(m.road) : null;
  // 조사를 못 정하는 도로명은 판본 1처럼 원문 유지(fail-safe). 행동은 구조로 알았으니 싣는다.
  if (m.road && !particle) return { text: description, action, resolved: true, live };
  const rest = `${join(m.road ? `${m.road}${particle} 따라` : undefined, m.to, m.dist)} 이동`;
  if (m.turn) {
    return { ...turned(join(m.from, `${m.turn}으로 도세요`), rest), action, resolved: true, live };
  }
  return { text: join(m.from, rest), resolved: true, live };
}

/** 횡단 꼬리(". 횡단보도 길이 21m"). */
function lengthTail(kind: string, meters: number): string {
  return `. ${kind} 길이 ${formatDistance(Math.round(meters))}`;
}

interface CrossContext {
  /** 직전 스텝(출력 기준) 폴리라인. */
  prevCoords?: Coord[];
  /** 직전 스텝이 이동 문장이었으면 그 원문 괄호 도로명(재작성 전 캡처). 횡단 뒤면 부재. */
  prevRoad?: string;
}

/** 단일 횡단보도·지하보도(병합 아님). */
function crossSingleV2(
  from: string | undefined,
  to: string | undefined,
  kind: "횡단보도" | "지하보도",
  meters: number,
  coords: Coord[] | undefined,
  ctx: CrossContext,
  opts: WalkWordingV2Options,
): V2Step {
  const live = liveOf(targetFrom(to), anchorFrom(from));
  const toward = towardOf(targetFrom(to));
  const tail = lengthTail(kind, meters);
  if (kind === "지하보도") {
    // 지하보도는 방향을 싣지 않는다 — 입구 방향은 경로 기하가 말해 주지 않는다(spec §3.1).
    return { text: `${join(from, toward, "지하보도로 건너세요")}${tail}`, action: "underpass", resolved: true, crossing: true, live };
  }
  const base = { action: "crosswalk" as const, resolved: true, crossing: true as const, live };
  const ref = opts.geometry ? referenceBearing(ctx.prevCoords) : null;
  const cross = opts.geometry ? firstSegmentBearing(coords) : null;
  if (ref === null || cross === null) {
    return { ...base, text: `${join(from, toward, "횡단보도를 건너세요")}${tail}` };
  }
  const clock = crossingClockOf(ref, cross);
  if (clock === 12) {
    return {
      ...base,
      clock,
      text: `${join(from, toward, "진행 방향 그대로 횡단보도를 건너세요")}${tail}`,
      parts: { turn: "진행 방향 그대로", body: `${join(from, toward, "횡단보도를 건너세요")}${tail}` },
    };
  }
  const roadParticle = ctx.prevRoad ? objectParticle(ctx.prevRoad) : null;
  const road =
    opts.crossingRoad && ctx.prevRoad && roadParticle && meters >= ROAD_CROSS_MIN_LENGTH_M &&
    crossesWalkedRoad(ref, cross)
      ? `${ctx.prevRoad}${roadParticle} 건너세요`
      : undefined;
  return {
    ...base,
    clock,
    ...turned(join(from, clockTurn(clock)), `${road ?? join(toward, "횡단보도를 건너세요")}${tail}`),
  };
}

/** 나눌 수 없는 병합 횡단(위원장 판정 2026-10-03: 한 문장, 길이 라벨 "전체 길이"). */
function crossMergedV2(
  from: string | undefined,
  to: string | undefined,
  kind: "횡단보도" | "지하보도",
  count: number,
  meters: number,
  coords: Coord[] | undefined,
  ctx: CrossContext,
  opts: WalkWordingV2Options,
): V2Step {
  const live = liveOf(targetFrom(to), anchorFrom(from));
  const toward = towardOf(targetFrom(to));
  const tail = `. 전체 길이 ${formatDistance(Math.round(meters))}`;
  if (kind === "지하보도") {
    return { text: `${join(from, toward, `지하보도 ${count}개로 건너세요`)}${tail}`, action: "underpass", resolved: true, crossing: true, live };
  }
  const act = `횡단보도 ${count}개를 연속으로 건너세요`;
  const base = { action: "crosswalk" as const, resolved: true, crossing: true as const, live };
  const ref = opts.geometry ? referenceBearing(ctx.prevCoords) : null;
  const cross = opts.geometry ? firstSegmentBearing(coords) : null;
  if (ref === null || cross === null) return { ...base, text: `${join(from, toward, act)}${tail}` };
  const clock = crossingClockOf(ref, cross);
  if (clock === 12) {
    return {
      ...base,
      clock,
      text: `${join(from, toward, "진행 방향 그대로", act)}${tail}`,
      parts: { turn: "진행 방향 그대로", body: `${join(from, toward, act)}${tail}` },
    };
  }
  return { ...base, clock, ...turned(join(from, clockTurn(clock)), `${join(toward, act)}${tail}`) };
}

/**
 * 분해된 병합 횡단 조각들(spec §3.3). 첫 조각은 리드 "…횡단보도 N개를 연속으로 건넙니다. 먼저 …"(리드가 `{from}`을
 * 소비한다), 둘째부터는 "…다음 횡단보도를 건너세요". `{toward}`는 싣지 않는다 — 위원장이 확정본 예문에서 뺐다.
 */
function crossSplitV2(
  from: string | undefined,
  to: string | undefined,
  pieces: CrossingPiece[],
  ctx: CrossContext,
  opts: WalkWordingV2Options,
): V2Step[] {
  const ref = referenceBearing(ctx.prevCoords);
  const longest = Math.max(...pieces.map((p) => p.length));
  return pieces.map((piece, k) => {
    const tail = lengthTail("횡단보도", piece.length);
    const object = k === 0 ? "횡단보도를 건너세요" : "다음 횡단보도를 건너세요";
    // 둘째부터의 기준은 앞 조각을 다 건넌 뒤의 진행 방향(마지막 선분)이다.
    const pieceRef = k === 0 ? ref : pieces[k - 1].exitBearing;
    let core: Pick<V2Step, "text" | "parts">;
    let clock: number | undefined;
    if (pieceRef === null) {
      core = { text: `${object}${tail}` };
    } else {
      clock = crossingClockOf(pieceRef, piece.bearing);
      if (clock === 12) {
        core = {
          text: `진행 방향 그대로 ${object}${tail}`,
          parts: { turn: "진행 방향 그대로", body: `${object}${tail}` },
        };
      } else {
        // 길 이름은 첫 조각이 주 조각 중 가장 길 때만(길동사거리 9.4m 첫 조각은 큰길이 아니다 — 50m 조각이 큰길).
        const roadParticle = ctx.prevRoad ? objectParticle(ctx.prevRoad) : null;
        const road =
          k === 0 && opts.crossingRoad && ctx.prevRoad && roadParticle &&
          piece.length >= longest && piece.length >= ROAD_CROSS_MIN_LENGTH_M &&
          crossesWalkedRoad(pieceRef, piece.bearing)
            ? `${ctx.prevRoad}${roadParticle} 건너세요`
            : undefined;
        core = turned(clockTurn(clock), `${road ?? object}${tail}`);
      }
    }
    const lead = k === 0 ? `${join(from, `횡단보도 ${pieces.length}개를 연속으로 건넙니다`)}. 먼저 ` : "";
    // 첫 조각에 기준 이름(anchor), 마지막 조각에 직진 목표(target) — 표시 계층 원재료(문장에는 싣지 않는다).
    const live = liveOf(
      k === pieces.length - 1 ? targetFrom(to) : undefined,
      k === 0 ? anchorFrom(from) : undefined,
    );
    return {
      text: `${lead}${core.text}`,
      ...(core.parts ? { parts: core.parts } : {}),
      action: "crosswalk",
      resolved: true,
      crossing: true,
      ...(clock !== undefined ? { clock } : {}),
      live,
    };
  });
}

/**
 * 판본 2 경로 단위 재작성(spec §3). 방향은 직전 스텝의 기하가 필요해 스텝 단위가 아니다. 병합 횡단은 확실할 때만
 * 조각 스텝으로 나눠(조각마다 `pathCoords`·거리·`crossing`·`action`) `waypoint.stepIndex`를 함께 민다.
 * `includeLive`가 아니면 live·crossing·parts·crossingClock를 싣지 않는다(행동·내부 표식은 `attachStepActions`가 정리).
 */
export function rewriteWalkBriefingV2(
  briefing: WalkRouteBriefing,
  opts: WalkWordingV2Options,
): WalkRouteBriefing {
  const out: WalkRouteStep[] = [];
  // 경유지 인덱스는 원본 기준이다 — 그 앞에서 늘어난 조각 수만큼 민다(병합 스텝 자체를 가리키면 첫 조각).
  let waypointShift = 0;
  let prevRoad: string | undefined;
  briefing.steps.forEach((step, index) => {
    const ctx: CrossContext = { prevCoords: out[out.length - 1]?.pathCoords, prevRoad };
    prevRoad = undefined;
    const emit = (r: V2Step, extra?: Partial<WalkRouteStep>) => {
      out.push({
        ...step,
        ...extra,
        description: r.text,
        ...(r.action ? { action: r.action } : {}),
        ...(r.resolved ? { actionResolved: true as const } : {}),
        ...(opts.includeLive && r.live ? { live: r.live } : {}),
        ...(opts.includeLive && r.crossing ? { crossing: r.crossing } : {}),
        ...(opts.includeLive && r.parts ? { parts: r.parts } : {}),
        ...(opts.includeLive && r.clock !== undefined ? { crossingClock: r.clock } : {}),
      });
    };

    const move = parseMove(step.description);
    if (move) {
      prevRoad = move.road;
      emit(moveV2(step.description, move));
      return;
    }
    const meters = step.distanceMeters;
    const cross = meters === undefined ? null : CROSS.exec(step.description);
    if (cross && meters !== undefined) {
      const [, from, to, countText, kindText] = cross;
      const kind = kindText as "횡단보도" | "지하보도";
      const count = Number(countText);
      if (count > 1) {
        const pieces =
          opts.geometry && kind === "횡단보도" ? splitMergedCrossing(step.pathCoords, count) : null;
        if (pieces) {
          // 카카오 거리를 조각 기하 길이 비례로 반올림해 나누고 마지막 조각이 나머지를 갖는다(합 보존).
          const total = pieces.reduce((sum, p) => sum + p.pathLength, 0);
          let assigned = 0;
          crossSplitV2(from, to, pieces, ctx, opts).forEach((r, k) => {
            const share = k === pieces.length - 1 ? meters - assigned : Math.round((meters * pieces[k].pathLength) / total);
            assigned += share;
            emit(r, { pathCoords: pieces[k].coords, distanceMeters: share, noCrossingNote: true });
          });
          if (briefing.waypoint && index < briefing.waypoint.stepIndex) waypointShift += pieces.length - 1;
          return;
        }
        emit(crossMergedV2(from, to, kind, count, meters, step.pathCoords, ctx, opts));
        return;
      }
      emit(crossSingleV2(from, to, kind, meters, step.pathCoords, ctx, opts));
      return;
    }
    // 그 밖의 문형은 판본 1 규칙 그대로(교량·역사 내 이동·미매칭 원문). 행동은 종전처럼 문장 분류기에 맡긴다 —
    // 거리만 끼워 넣는 폴백 문장 속 회전·지하보도 표지를 "행동 없음"으로 확정하면 그 행동이 빠진다(구현 리뷰).
    const v1 = rewriteWalkGuidanceWithLive(step.description, meters);
    emit({ text: v1.text, resolved: false, live: v1.live });
  });
  return {
    ...briefing,
    steps: out,
    ...(briefing.waypoint && waypointShift > 0
      ? { waypoint: { ...briefing.waypoint, stepIndex: briefing.waypoint.stepIndex + waypointShift } }
      : {}),
  };
}
