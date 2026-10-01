/**
 * 길찾기 `?dir=` 직렬화/파싱 (순수, React/Next 비의존).
 *
 * 형식: `<from>/<to>[/<via>]` (to 없으면 `<from>`만, via는 to가 있을 때만 — N4 경유지)
 * - 현재 위치 토큰 `cur`: 좌표를 절대 싣지 않는다(프라이버시 계약: 공유·
 *   새로고침 URL에 사용자 위치가 남으면 안 되고, 복원 시 재측위가 정본).
 * - 장소 토큰 `encodeURIComponent(라벨)[:encodeURIComponent(로마자)]@lat,lng`: 구조 구분자
 *   `@`·`/`·`,`·`:`는 encodeURIComponent가 라벨·로마자에서 전부 인코딩하므로(%40·%2F·%2C·%3A)
 *   충돌하지 않는다. 로마자 토막은 라틴 표기(E28 `labelRoman`)가 있을 때만 붙는다(A53 —
 *   새로고침·공유 URL에서도 en 브리핑 마지막 도보 줄이 목적지 이름을 잃지 않게). 없으면 종전 토큰 그대로다.
 *
 * 불량 입력은 어떤 경우든 null을 반환한다(호출자는 빈 폼으로 폴백). 예외를
 * 밖으로 흘리지 않는다. URL은 사용자가 임의 조작 가능한 입력이다.
 */
import type { Coord } from "./types";

export type DirEndpoint =
  | { kind: "current" }
  | {
      kind: "place";
      label: string;
      coord: Coord;
      /** 라벨의 라틴 표기(E28, 장소=서버 `nameRoman`·주소=juso `engAddr`). 확정 시점에 손에 있던 값이고 부재는 키 없음. */
      labelRoman?: string;
    };

/** 장소 끝점. 라틴 표기는 비어 있지 않을 때만 싣는다(A53 — 끝점을 만드는 자리는 전부 이 함수를 지난다). */
export function placeEndpoint(label: string, coord: Coord, roman?: string | null): DirEndpoint {
  return { kind: "place", label, coord, ...(roman?.trim() ? { labelRoman: roman } : {}) };
}

const CUR_TOKEN = "cur";
const COORD_RE = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

function serializeEndpoint(ep: DirEndpoint): string {
  if (ep.kind === "current") return CUR_TOKEN;
  const roman = ep.labelRoman?.trim() ? `:${encodeURIComponent(ep.labelRoman)}` : "";
  return `${encodeURIComponent(ep.label)}${roman}@${ep.coord.lat},${ep.coord.lng}`;
}

export function serializeDir(
  from: DirEndpoint,
  to: DirEndpoint | null,
  via?: DirEndpoint | null,
): string {
  const head = serializeEndpoint(from);
  if (!to) return head; // 경유지는 도착지 없이 의미가 없다
  const pair = `${head}/${serializeEndpoint(to)}`;
  return via ? `${pair}/${serializeEndpoint(via)}` : pair;
}

function parseEndpoint(token: string): DirEndpoint | null {
  if (token === CUR_TOKEN) return { kind: "current" };
  const at = token.indexOf("@");
  if (at <= 0) return null; // @ 없음 또는 빈 라벨
  const head = token.slice(0, at);
  const colon = head.indexOf(":");
  const rawLabel = colon < 0 ? head : head.slice(0, colon);
  const rawRoman = colon < 0 ? "" : head.slice(colon + 1);
  const m = COORD_RE.exec(token.slice(at + 1));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let label: string;
  let roman: string;
  try {
    label = decodeURIComponent(rawLabel);
    roman = decodeURIComponent(rawRoman);
  } catch {
    return null; // 깨진 퍼센트 인코딩
  }
  if (!label) return null;
  return placeEndpoint(label, { lat, lng }, roman);
}

export function parseDir(
  raw: string | null,
): { from: DirEndpoint; to: DirEndpoint | null; via: DirEndpoint | null } | null {
  if (!raw) return null;
  const parts = raw.split("/");
  if (parts.length > 3) return null;
  const from = parseEndpoint(parts[0]);
  if (!from) return null;
  if (parts.length === 1) return { from, to: null, via: null };
  const to = parseEndpoint(parts[1]);
  if (!to) return null;
  if (parts.length === 2) return { from, to, via: null };
  // 경유지는 장소 토큰만(현재 위치 불가 — 경유지가 "지금 여기"면 경유가 아니다).
  const via = parseEndpoint(parts[2]);
  if (!via || via.kind === "current") return null;
  return { from, to, via };
}
