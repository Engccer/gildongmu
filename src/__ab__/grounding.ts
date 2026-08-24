/**
 * 날조 자동 판정(엔티티 대조) · pass^k · 언어 불변 인자 검사 — 순수 함수, LLM 호출 0.
 *
 * 원리(GroundEval, arXiv 2606.22737): 최종 답변의 엔티티는 선행 도구 출력에 있어야 한다.
 * 도구 반환 JSON에서 값을 모아 정규화하고, 답변에서 같은 종류(전화번호·시각·수치+단위·
 * 시설명 후보)를 뽑아 **답변에만 있는 것**을 `leaked`로 낸다. 한국어라 NLI(MiniCheck 등)를
 * 못 쓰므로 문자열 대조가 차선책이 아니라 정답이다(dodo research 2026-08-25 §2①).
 *
 * 한계(의도된 것): ①도구 값을 틀리게 해석한 것(출발 시각을 도착 시각으로)은 못 잡는다
 * ②속성 서술("활기찬 분위기")은 엔티티가 아니라 못 잡는다 — 그래서 `forbidLexicon`이
 * **강등 전용**으로 붙는다(있으면 실패, 없다고 통과 보장 아님). 고유명사 추출은 시설
 * 접미사가 있는 토큰으로 좁혀 오탐을 억제한다(넓히면 잡음이 판정을 잠식한다).
 * ③수치는 "도구 출력 어딘가의 같은 숫자"로 접지된다 — `fields:"*"`면 좌표·id·total 같은 숫자도
 * 근거가 되어 "2층"이 `total:2`로 통과한다(미탐). 정밀하게 재려면 `fields`를 좁힌다.
 * ④"오후 5시"처럼 분이 없는 시각은 시각 엔티티로 뽑지 않는다("1시간"과 갈리지 않는다).
 *
 * 어휘 강등의 면제: 같은 문장에 부정 술어("제공되지 않"·"확인할 수 없" 등)가 있으면 그 낱말은
 * 정직한 한계 고지("화장실 위치 정보는 제공되지 않습니다")이지 단정이 아니다 — 2026-08-25 스모크와
 * 리뷰가 잡은 오탐 기제라 문장 단위로 면제한다.
 */

export type EntityKind = "name" | "phone" | "time" | "number" | "address";

export interface GroundingSpec {
  /** 엔티티를 뽑을 도구 응답(이 도구들의 반환 JSON에서 `fields`를 수집) */
  fromTools: string[];
  /** 수집할 필드 경로("items[].name") 또는 "*"(모든 스칼라 리프) */
  fields: string[];
  kinds: readonly EntityKind[];
  /** 강등 전용 어휘 — 답변에 있으면 실패. 도구 반환에 없는 속성 서술을 잡는다 */
  forbidLexicon?: string[];
}

export interface ToolOutput {
  name: string;
  response: unknown;
}

export interface Entity {
  kind: EntityKind;
  raw: string;
  norm: string;
}

export interface GroundingResult {
  pass: boolean;
  leaked: string[];
}

type Scalar = string | number;

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number";
}

function leaves(v: unknown, out: Scalar[]): void {
  if (isScalar(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, out));
}

/** "items[].name" 같은 경로를 따라 값을 모은다. `[]`는 배열 전개. */
function walk(v: unknown, segs: string[], out: Scalar[]): void {
  if (segs.length === 0) {
    if (isScalar(v)) out.push(v);
    return;
  }
  const [head, ...rest] = segs;
  const key = head.replace(/\[\]$/, "");
  const spread = head.endsWith("[]");
  const next = key === "" ? v : v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  if (next === undefined || next === null) return;
  if (spread) {
    if (Array.isArray(next)) next.forEach((x) => walk(x, rest, out));
  } else {
    walk(next, rest, out);
  }
}

export function collectToolValues(outputs: ToolOutput[], fromTools: string[], fields: string[]): Scalar[] {
  const out: Scalar[] = [];
  for (const o of outputs) {
    if (!fromTools.includes(o.name)) continue;
    for (const f of fields) {
      if (f === "*") leaves(o.response, out);
      else walk(o.response, f.split("."), out);
    }
  }
  return out;
}

/** 공백·하이픈·가운뎃점·괄호·숫자 천 단위 구분자를 벗기고 소문자화. */
export function normalize(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/[\s\-–—·()（）[\]]/g, "");
}

const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const TIME_RE = /(\d{1,2}):(\d{2})|(\d{1,2})\s*시\s*(\d{1,2})\s*분/g;
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)\s*(km|m|분|초|원|대|개|곳|호선|번|층|명|건)(?![a-z])/gi;
/** 시설 접미사가 붙은 토큰만 고유명사 후보로(과잉 추출 금지). */
// 접두 2자 이상("구역"·"지역" 같은 일반어 배제), 접미사 뒤에는 조사 한 글자까지만 허용한다("길동소아과와" → 길동소아과).
const NAME_RE =
  /[가-힣A-Za-z0-9]{2,}(역|점|병원|의원|소아과|내과|치과|한의원|약국|공원|정류장|정류소|대여소|센터|시장|학교)(?=[은는이가을를에도의와과로]?(?![가-힣]))/g;
/** 접미사만으로 이뤄진 일반 명사는 후보가 아니다. */
const GENERIC_NAMES = new Set(["지하철역", "기차역", "버스정류장", "정류장", "정류소", "대여소", "병원", "약국", "공원", "학교", "시장", "센터"]);
// 도로명은 2자 이상 + 뒤에 단위가 오면 조사 "로"("버스로 10분"·"도보로 5분")라 제외한다.
const ADDRESS_RE = /[가-힣]{2,}(?:대로|로|길)\s?\d+(?:-\d+)?(?!\d)(?!\s*(?:분|초|m|km|정거장|대|개|곳|호선|번))/g;

function pad2(n: string): string {
  return n.padStart(2, "0");
}

export function extractEntities(text: string, kinds: readonly EntityKind[]): Entity[] {
  const out: Entity[] = [];
  // 시각 표현은 수치 추출 전에 지운다("5시 30분"의 "30분"이 수치로 새지 않게).
  let stripped = text;
  const times: Entity[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    const hh = m[1] ?? m[3];
    const mm = m[2] ?? m[4];
    times.push({ kind: "time", raw: m[0], norm: `${pad2(hh)}:${pad2(mm)}` });
    stripped = stripped.replace(m[0], " ");
  }
  const phones: Entity[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    phones.push({ kind: "phone", raw: m[0], norm: m[0].replace(/\D/g, "") });
    stripped = stripped.replace(m[0], " ");
  }
  if (kinds.includes("phone")) out.push(...phones);
  if (kinds.includes("time")) out.push(...times);
  if (kinds.includes("number")) {
    for (const m of stripped.matchAll(NUMBER_RE)) {
      out.push({ kind: "number", raw: m[0], norm: `${m[1].replace(/,/g, "")}${m[2].toLowerCase()}` });
    }
  }
  if (kinds.includes("name")) {
    for (const m of text.matchAll(NAME_RE)) {
      if (GENERIC_NAMES.has(m[0])) continue;
      out.push({ kind: "name", raw: m[0], norm: normalize(m[0]) });
    }
  }
  if (kinds.includes("address")) {
    for (const m of text.matchAll(ADDRESS_RE)) out.push({ kind: "address", raw: m[0], norm: normalize(m[0]) });
  }
  return out;
}

/** 답변이 적은 자릿수만큼만 일치를 요구한다 — 1,123m를 "약 1km"로 반올림한 것은 날조가 아니다. */
function matchesRounded(n: number, v: number, decimals: number): boolean {
  return Math.abs(n - v) <= 0.5 * 10 ** -decimals + 1e-9;
}

/** 부정 술어 — 같은 문장 안의 강등 어휘를 면제한다(한계 고지이지 단정이 아니다). */
const NEGATION_RE = /제공되지 않|제공하지 않|제공되지 않|확인할 수 없|확인하기 어렵|어렵습니다|없습니다|않습니다|지 않아|불가능|알 수 없/;

function grounded(e: Entity, corpus: string, corpusNumbers: number[]): boolean {
  if (corpus.includes(e.norm)) return true;
  if (e.kind === "time") {
    // 값 경계(`|`)를 살려 좌표 127.1325가 13:25를 접지하지 않게 한다.
    const compact = e.norm.replace(":", "");
    return new RegExp(`(^|\\|)${compact}(00)?($|\\|)`).test(corpus);
  }
  if (e.kind === "number") {
    const m = /^([\d.]+)(.*)$/.exec(e.norm);
    if (!m) return false;
    const v = Number(m[1]);
    const unit = m[2];
    if (corpusNumbers.some((n) => n === v)) return true;
    const decimals = (m[1].split(".")[1] ?? "").length;
    if (unit === "km") return corpusNumbers.some((n) => matchesRounded(n / 1000, v, decimals));
    if (unit === "분") return corpusNumbers.some((n) => matchesRounded(n / 60, v, decimals));
    return false;
  }
  return false;
}

/**
 * 답변의 엔티티를 도구 출력(+`known`: 장소 앵커 이름·사용자 발화처럼 도구 밖에서 이미
 * 주어진 문자열)과 대조한다. `leaked`는 "종류:원문" 또는 "어휘:단어".
 */
export function scoreGrounding(
  spec: GroundingSpec,
  outputs: ToolOutput[],
  text: string,
  known: string[] = [],
): GroundingResult {
  const values = collectToolValues(outputs, spec.fromTools, spec.fields);
  const corpus = normalize([...values.map(String), ...known].join("|"));
  const corpusNumbers = [...corpus.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const leaked: string[] = [];
  const seen = new Set<string>();
  for (const e of extractEntities(text, spec.kinds)) {
    const key = `${e.kind}:${e.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!grounded(e, corpus, corpusNumbers)) leaked.push(key);
  }
  const sentences = text.split(/(?<=[.!?。])\s+|\n+/).filter((x) => !NEGATION_RE.test(x));
  const assertive = sentences.join("\n").toLowerCase();
  const hits = (spec.forbidLexicon ?? [])
    .map((term) => ({ term, at: assertive.indexOf(term.toLowerCase()) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  leaked.push(...hits.map((h) => `어휘:${h.term}`));
  return { pass: leaked.length === 0, leaked };
}

/** pass^k — 전부 통과해야 통과. 표본이 없으면 null. */
export function passK(passes: boolean[]): boolean | null {
  if (passes.length === 0) return null;
  return passes.every(Boolean);
}

export interface LangInvariantSpec {
  tool: string;
  key: string;
  pattern: string;
}

/** 인자 값이 정규형(regex)인가. 해당 도구 호출이 하나도 없으면 null(판정 불가). */
export function checkLangInvariantArgs(
  specs: LangInvariantSpec[],
  toolArgs: { name: string; args: Record<string, unknown> }[],
): boolean | null {
  let seen = false;
  for (const s of specs) {
    const re = new RegExp(s.pattern);
    for (const t of toolArgs) {
      if (t.name !== s.tool || !(s.key in t.args)) continue;
      seen = true;
      if (!re.test(String(t.args[s.key]))) return false;
    }
  }
  return seen ? true : null;
}
