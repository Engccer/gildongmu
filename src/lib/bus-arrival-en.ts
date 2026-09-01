/**
 * 시내버스 도착 완성 문장(TOPIS `arrmsg1`)의 파싱과 영문 투영 (E27 잔여 ①, spec §3.11) — 순수.
 *
 * `lang=en` 응답에만 실린다. 원칙은 지하철 도착 영문(`subway-arrival-en.ts`)과 같다 —
 * **거짓 문장보다 부재**. 모양 밖·범위 밖은 전부 부재로 떨어지고 소비자가 한국어 원문으로 폴백한다.
 *
 * ⚠ **파싱을 ko 재작성(`rewriteBusArrivalMessage`)과 갈라 두지 않는다.** 원문을 각자 해석하면
 * provider 변형이 한쪽에만 반영돼 잔여 정거장 수와 영어 문장이 서로 다른 원문 해석을 하게 된다.
 * 그래서 꼬리 정규식은 `ARRMSG_REMAINING_TAIL`을 그대로 공유하고, 잔여 해석은 계약 테스트가
 * 기존 `remainingFromArrmsg`와의 일치를 전 코퍼스에서 단언한다.
 */
import { ARRMSG_REMAINING_TAIL, remainingFromArrmsg } from "./providers/seoul-bus";

export type BusArrmsgKind = "eta" | "soon" | "waiting" | "ended" | "unknown";

export interface BusArrmsg {
  kind: BusArrmsgKind;
  /** eta일 때만 채워진다(분 없는 "55초후"는 null). */
  minutes: number | null;
  /** eta일 때만 채워진다(초 없는 "15분후"는 null). */
  seconds: number | null;
  /** 잔여 정거장 — 기존 `remainingFromArrmsg`와 같은 값(계약 테스트가 잠근다). */
  remainingStops: number | null;
}

/** "6분47초후" / "15분후" / "55초후" — 꼬리를 떼고 남은 몸통에 걸린다. */
const ETA_RE = /^(?:(\d+)분)?(?:\s*(\d+)초)?\s*후$/;

const warnedShapes = new Set<string>();
function warnShape(shape: string): void {
  if (warnedShapes.has(shape)) return;
  warnedShapes.add(shape);
  // 숫자만 N으로 마스킹한 모양(지하철 warnShape 동형) — 정류소명이 섞이지 않는 문장이지만
  // 계측 형태를 맞춘다. 조용한 강등 대신 로그로 provider 변형을 드러내는 것이 목적이다.
  console.warn(`[bus-arrival-en] 모양 밖 도착 문장: shape=${shape}`);
}

/** 원문 → 구조. 미지 모양은 `kind: "unknown"`이고 `remainingStops`는 그래도 채운다. */
export function parseBusArrmsg(message: string): BusArrmsg {
  const remainingStops = remainingFromArrmsg(message);
  const body = message.replace(ARRMSG_REMAINING_TAIL, "").trim();
  if (/^곧\s*도착$/.test(body)) return { kind: "soon", minutes: null, seconds: null, remainingStops };
  if (body === "출발대기") return { kind: "waiting", minutes: null, seconds: null, remainingStops };
  if (body === "운행종료") return { kind: "ended", minutes: null, seconds: null, remainingStops };
  const m = ETA_RE.exec(body);
  if (m && (m[1] != null || m[2] != null)) {
    const minutes = m[1] == null ? null : Number(m[1]);
    const seconds = m[2] == null ? null : Number(m[2]);
    return { kind: "eta", minutes, seconds, remainingStops };
  }
  return { kind: "unknown", minutes: null, seconds: null, remainingStops };
}

/**
 * 구조 → 영문 문장. **국면 인자는 필수다** — 같은 원문이 대기(버스가 오기까지)와 승차(내릴 곳까지)에서
 * 뜻이 다르고 영어는 어순 자체가 갈린다. 기본값을 두면 신규 호출부가 국면을 빠뜨려도 컴파일이
 * 통과해 조용히 틀린 문장을 낸다([[no-default-for-safety-parameters]], `slotToItem` 선례).
 */
export function busArrivalMessageEn(parsed: BusArrmsg, phase: "wait" | "ride"): string | undefined {
  switch (parsed.kind) {
    case "soon":
      return "Arriving soon";
    case "waiting":
      return "Waiting to depart";
    case "ended":
      return "Service ended";
    case "eta": {
      const { minutes, seconds } = parsed;
      if (minutes != null && (!Number.isInteger(minutes) || minutes < 0)) return undefined;
      if (seconds != null && (!Number.isInteger(seconds) || seconds < 0 || seconds > 59)) return undefined;
      const parts: string[] = [];
      if (minutes != null && minutes > 0) parts.push(`${minutes} min`);
      if (seconds != null && seconds > 0) parts.push(`${seconds} sec`);
      // 분·초가 둘 다 0이면 남은 시간이 없다는 뜻인데 "In " / " left"에 담을 값이 없다 — 부재.
      if (parts.length === 0) return undefined;
      const body = parts.join(" ");
      // ⚠ **대기 국면에선 잔여 정거장을 붙인다.** ko 원문은 꼬리 `[N번째 전]`을 달고 있고
      // 대기 후보 목록은 `remainingStops`를 따로 렌더하지 않으므로(`rewriteBusArrivalMessage`
      // 주석) **그 꼬리가 잔여 정보의 유일한 채널**이다 — 안 붙이면 en 사용자만 "몇 번째 전
      // 버스인가"를 못 듣는다. 승차 국면은 상태줄이 잔여 수를 따로 말하므로 붙이지 않는다.
      const eta = phase === "wait" ? `In ${body}` : `${body} left`;
      const stops = parsed.remainingStops;
      if (phase === "wait" && stops != null && stops > 0) {
        return `${eta}, ${stops === 1 ? "1 stop away" : `${stops} stops away`}`;
      }
      return eta;
    }
    default:
      return undefined;
  }
}

/** 원문에서 바로 영문을 얻는 편의 판(라우트 투영용) — 미지 모양이면 계측하고 부재. */
export function busArrivalMessageEnFrom(message: string, phase: "wait" | "ride"): string | undefined {
  const parsed = parseBusArrmsg(message);
  if (parsed.kind === "unknown") {
    warnShape(message.replace(/\d+/g, "N"));
    return undefined;
  }
  return busArrivalMessageEn(parsed, phase);
}
