import { prefersEnglish } from "./data-locale";
import { hasHangul } from "./format";

/**
 * 장소명 영문 병기 조립(E28) — Kit `BilingualName.swift` 미러, 공유 fixture
 * `__tests__/fixtures/bilingual-name-cases.json`이 규칙을 못 박는다.
 * spec `docs/superpowers/specs/2026-08-31-place-name-bilingual-design.md` §4.
 *
 * 위원장 판정(2026-08-31): 영문 원천 없는 이름은 한글 + 로마자(서버 `nameRoman`) 한 줄 괄호
 * `Roman (한글)`, **접근 가능한 이름은 괄호 앞만**. 이 함수는 "무엇을 1순위로 보이고 무엇을
 * 괄호에 넣는가"만 정한다 — 괄호 span의 자리(웹 R1: 접근성 객체의 마지막 노드)와
 * `.accessibilityLabel`(iOS)은 렌더 계층의 몫이다.
 *
 * 규칙(순서가 곧 우선순위):
 * 1. ko 로케일 → 병기 없음(ko 화면은 byte-identical).
 * 2. 후보 = en 원천 → 로마자 → 없음. **한글이 섞인 후보는 후보가 아니다**(접근 가능한 이름에
 *    한글이 새는 유일한 경로를 막는다 — 설계 리뷰 검출). 없으면 한글 그대로(`lang="ko"`는 종전대로).
 * 3. 한글이 없는 이름(`CU`·`GS25`)은 괄호가 잉여 — 후보만 보인다.
 * 4. 후보가 한글 원문과 같으면 병기 없음.
 * 0. (규칙 1 뒤, 2 앞) 원문이 이미 `Latin (한글)` 병기 형태면 그대로 가른다(TourAPI en, `parseEmbeddedBilingual`).
 */
export interface BilingualName {
  /** 시각·낭독 모두의 1순위 이름. 병기하지 않으면 ko 원문. */
  primary: string;
  /** 괄호에 넣을 한글 원문. null이면 병기 없음. */
  secondary: string | null;
}

export interface BilingualSource {
  /** 원천 영문명(역 `nameEn`·juso `engAddr`·TourAPI). 로마자보다 앞선다. */
  en?: string | null;
  /** 서버 투영 로마자(`nameRoman`). 원천 영문이 없을 때만 쓰인다. */
  roman?: string | null;
}

/**
 * 원천이 **이미 병기된 이름**인가 — TourAPI en `title`은 `Starbucks Gyeongdong Market (스타벅스 경동1960)`
 * 모양이다(a11y 감사 실호출 2026-08-31: en 검색 결과 201건 중 78건). 이 모양은 라틴 선두가 곧 primary이고
 * 괄호 안 한글이 secondary다 — 로마자로 다시 만들면 접근 가능한 이름이 원문보다 나빠진다.
 * 서버 `romanNameOf`도 같은 술어로 로마자를 만들지 않는다(웹 ↔ Kit ↔ 서버 한 정규식).
 */
export const EMBEDDED_BILINGUAL = /^([^가-힣()]*[A-Za-z][^가-힣()]*?)\s*\(([^()]*[가-힣][^()]*)\)\s*$/;

export function parseEmbeddedBilingual(name: string): BilingualName | null {
  const m = EMBEDDED_BILINGUAL.exec(name.normalize("NFC"));
  if (!m) return null;
  const primary = m[1].trim();
  return primary ? { primary, secondary: m[2].trim() } : null;
}

function latinCandidate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !hasHangul(trimmed) ? trimmed : null;
}

export function bilingualName(locale: string, ko: string, source: BilingualSource): BilingualName {
  if (!prefersEnglish(locale)) return { primary: ko, secondary: null };
  // 원천이 이미 `Latin (한글)`이면 그 형태가 정답이다 — 로마자·en 후보를 보지 않는다.
  const embedded = parseEmbeddedBilingual(ko);
  if (embedded) return embedded;
  const candidate = latinCandidate(source.en) ?? latinCandidate(source.roman);
  if (candidate === null) return { primary: ko, secondary: null };
  if (!hasHangul(ko)) return { primary: candidate, secondary: null };
  // 비교는 양끝 공백·NFC를 맞춰서(표시는 원문 그대로) — "서울역 " vs "서울역"이 중복 병기되지 않게.
  if (candidate.normalize("NFC") === ko.trim().normalize("NFC")) return { primary: ko, secondary: null };
  return { primary: candidate, secondary: ko };
}

/** 시각 문자열 `Primary (한글)` — 비-React 소비자(테스트·문자열 조립)용. 웹 렌더는 `<KoTail>`. */
export function bilingualDisplay(b: BilingualName): string {
  return b.secondary === null ? b.primary : `${b.primary} (${b.secondary})`;
}
