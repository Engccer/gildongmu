/**
 * 불투명 ref(spec §5.3): `{nonce}.{attempt}.{source}.{row}` base36.
 * nonce는 문서 로드마다 새 값 — 리로드 뒤 옛 ref가 새 결과의 같은 순번으로 풀리지 않게(리뷰 #7).
 * 해석은 정착 시 동결한 스냅샷에서 한 번이고 가변 화면 상태를 다시 읽지 않는다.
 * 검사 순서: nonce → attempt(둘 다 staleResult) → row(notFound).
 */
import type { JusoAddress, Place } from "@/lib/types";

export interface SearchSnapshot {
  attempt: number;
  query: string;
  sort: "accuracy" | "review";
  places: readonly Place[];
  addresses: readonly JusoAddress[];
}

export type RefResolution =
  | { kind: "place"; place: Place; ref: string }
  | { kind: "address"; address: JusoAddress; ref: string }
  | { kind: "staleResult" }
  | { kind: "notFound" };

let nonce = Math.floor(Math.random() * 36 ** 6).toString(36);
const REF_RE = /^([a-z0-9]+)\.([a-z0-9]+)\.([pa])\.([a-z0-9]+)$/;

export function encodeRef(attempt: number, source: "p" | "a", row: number): string {
  return `${nonce}.${attempt.toString(36)}.${source}.${row.toString(36)}`;
}

export function resolveRef(ref: unknown, snapshot: SearchSnapshot | null): RefResolution {
  if (typeof ref !== "string") return { kind: "notFound" };
  const m = REF_RE.exec(ref);
  if (!m) return { kind: "notFound" };
  if (m[1] !== nonce) return { kind: "staleResult" };
  if (!snapshot || parseInt(m[2], 36) !== snapshot.attempt) return { kind: "staleResult" };
  const row = parseInt(m[4], 36);
  if (m[3] === "p") {
    const place = snapshot.places[row];
    return place ? { kind: "place", place, ref } : { kind: "notFound" };
  }
  const address = snapshot.addresses[row];
  return address ? { kind: "address", address, ref } : { kind: "notFound" };
}

/** 테스트 전용: nonce를 고정해 리로드(새 nonce) 시나리오를 재현한다. */
export function __setNonceForTest(n: string): void {
  nonce = n;
}
