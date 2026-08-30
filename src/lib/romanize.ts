/**
 * 한글 → 로마자(국어원 로마자 표기법 2000, 음운 변화 반영). 서버 한 곳에서만 돈다 —
 * 웹·iOS·CLI가 응답의 `nameRoman`(additive)으로 같은 값을 본다.
 * spec `docs/superpowers/specs/2026-08-31-place-name-bilingual-design.md` §3.
 *
 * 대상은 지명·상호(체언)다. 그래서 용언 규칙(ㄱㄷㅂ+ㅎ 격음 병합 `잡혀 japyeo`·`밟-` 겹받침
 * 예외)은 두지 않고 체언 규칙(`묵호 Mukho`·`집현전 Jiphyeonjeon`)을 기본값으로 한다.
 * 형태소 경계가 필요한 변화(ㄴ 첨가·구개음화·합성어 사이시옷)는 적용하지 않는다 —
 * 표기만으로 판정할 수 없고, 어느 쪽으로든 조용히 틀리므로 규칙 표에 없는 변화는
 * "안 한다"가 정답이다(§3.4).
 *
 * `@romanize/korean`은 94어 표에서 30어가 틀려(ㄹㄹ→lr, ㅇ·ㅁ 뒤 ㄹ 비음화 미적용,
 * 겹받침 대표음, 체언 격음) 채택하지 않았다(§3.1).
 */

import { EMBEDDED_BILINGUAL } from "./bilingual-name";

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 초성 19종의 로마자(초성 자리). ㅇ은 무음. */
const ONSET = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
] as const;
const ONSET_G = 0, ONSET_N = 2, ONSET_D = 3, ONSET_R = 5, ONSET_M = 6, ONSET_IEUNG = 11, ONSET_J = 12;

const VOWEL = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
] as const;

/** 음절 끝소리(대표음) 부류. */
type Coda = "K" | "T" | "P" | "N" | "L" | "M" | "NG";
const CODA_LETTER: Record<Coda, string> = { K: "k", T: "t", P: "p", N: "n", L: "l", M: "m", NG: "ng" };

interface Jong {
  /** 자음 앞·어말에서의 대표음. */
  rep: Coda;
  /** 모음 앞 연음 시 남는 받침(겹받침의 앞 자음). null이면 받침 전부가 넘어간다. */
  liaisonCoda: Coda | null;
  /** 모음 앞 연음 시 다음 음절 초성으로 가는 로마자. null이면 넘어갈 자음이 없다(ㅇ·ㅎ). */
  liaisonOnset: string | null;
  /** ㅎ을 품는가(ㅎ·ㄶ·ㅀ) — 뒤 ㄱㄷㅈ을 격음으로. */
  hasH: boolean;
}

/** 종성 28종(0=없음). 순서는 유니코드 종성 인덱스. */
const JONG: (Jong | null)[] = [
  null,
  { rep: "K", liaisonCoda: null, liaisonOnset: "g", hasH: false }, // ㄱ
  { rep: "K", liaisonCoda: null, liaisonOnset: "kk", hasH: false }, // ㄲ
  { rep: "K", liaisonCoda: "K", liaisonOnset: "s", hasH: false }, // ㄳ
  { rep: "N", liaisonCoda: null, liaisonOnset: "n", hasH: false }, // ㄴ
  { rep: "N", liaisonCoda: "N", liaisonOnset: "j", hasH: false }, // ㄵ
  { rep: "N", liaisonCoda: null, liaisonOnset: "n", hasH: true }, // ㄶ (않아 ana)
  { rep: "T", liaisonCoda: null, liaisonOnset: "d", hasH: false }, // ㄷ
  { rep: "L", liaisonCoda: null, liaisonOnset: "r", hasH: false }, // ㄹ
  { rep: "K", liaisonCoda: "L", liaisonOnset: "g", hasH: false }, // ㄺ
  { rep: "M", liaisonCoda: "L", liaisonOnset: "m", hasH: false }, // ㄻ
  { rep: "L", liaisonCoda: "L", liaisonOnset: "b", hasH: false }, // ㄼ
  { rep: "L", liaisonCoda: "L", liaisonOnset: "s", hasH: false }, // ㄽ
  { rep: "L", liaisonCoda: "L", liaisonOnset: "t", hasH: false }, // ㄾ
  { rep: "P", liaisonCoda: "L", liaisonOnset: "p", hasH: false }, // ㄿ
  { rep: "L", liaisonCoda: null, liaisonOnset: "r", hasH: true }, // ㅀ (뚫어 ttureo)
  { rep: "M", liaisonCoda: null, liaisonOnset: "m", hasH: false }, // ㅁ
  { rep: "P", liaisonCoda: null, liaisonOnset: "b", hasH: false }, // ㅂ
  { rep: "P", liaisonCoda: "P", liaisonOnset: "s", hasH: false }, // ㅄ
  { rep: "T", liaisonCoda: null, liaisonOnset: "s", hasH: false }, // ㅅ
  { rep: "T", liaisonCoda: null, liaisonOnset: "ss", hasH: false }, // ㅆ
  { rep: "NG", liaisonCoda: "NG", liaisonOnset: null, hasH: false }, // ㅇ (강아지 gangaji)
  { rep: "T", liaisonCoda: null, liaisonOnset: "j", hasH: false }, // ㅈ
  { rep: "T", liaisonCoda: null, liaisonOnset: "ch", hasH: false }, // ㅊ
  { rep: "K", liaisonCoda: null, liaisonOnset: "k", hasH: false }, // ㅋ
  { rep: "T", liaisonCoda: null, liaisonOnset: "t", hasH: false }, // ㅌ
  { rep: "P", liaisonCoda: null, liaisonOnset: "p", hasH: false }, // ㅍ
  { rep: "T", liaisonCoda: null, liaisonOnset: null, hasH: true }, // ㅎ (놓아 noa)
];

/** 격음화: ㅎ 받침 뒤 ㄱ·ㄷ·ㅈ 초성 → k·t·ch. */
const ASPIRATED: Partial<Record<number, string>> = { [ONSET_G]: "k", [ONSET_D]: "t", [ONSET_J]: "ch" };

interface Syllable {
  onset: number;
  vowel: number;
  jong: number;
}

function decompose(ch: string): Syllable | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  return { onset: Math.floor(offset / 588), vowel: Math.floor((offset % 588) / 28), jong: offset % 28 };
}

/** 한글 음절 연속 하나를 로마자로. 어절 경계(비한글 문자)에서는 음운 변화를 보지 않는다. */
function romanizeRun(syllables: Syllable[]): string {
  const onsets: string[] = syllables.map((s) => ONSET[s.onset]);
  const codas: (string | null)[] = syllables.map(() => null);

  for (let i = 0; i < syllables.length; i++) {
    const jong = JONG[syllables[i].jong];
    if (!jong) continue;
    const next = i + 1 < syllables.length ? syllables[i + 1] : null;

    if (next === null) {
      codas[i] = CODA_LETTER[jong.rep];
      continue;
    }

    const c = next.onset;
    if (c === ONSET_IEUNG) {
      // 연음: 받침이 다음 초성으로. ㅇ은 남고 ㅎ은 탈락한다.
      codas[i] = jong.liaisonCoda ? CODA_LETTER[jong.liaisonCoda] : null;
      if (jong.liaisonOnset !== null) onsets[i + 1] = jong.liaisonOnset;
      continue;
    }

    let rep: Coda = jong.rep;

    if (jong.hasH && ASPIRATED[c] !== undefined) {
      // 격음화(좋고 joko·않고 anko·잃다 ilta·싫다 silta): ㅎ은 사라지고 겹받침의 앞 자음(ㄴ·ㄹ)만
      // 남는다. ⚠ 연음용 `liaisonCoda`(ㄶ·ㅀ은 null — 앞 자음이 초성으로 넘어가는 표)를 여기서
      // 읽으면 받침이 통째로 사라진다(설계 리뷰 검출: 싫다 → Sita). 대표음 `rep`가 정답이다.
      onsets[i + 1] = ASPIRATED[c] as string;
      codas[i] = jong.liaisonOnset === null ? null : CODA_LETTER[jong.rep];
      continue;
    }

    if (c === ONSET_N || c === ONSET_M) {
      // 비음화: 국민 gungmin·입문 immun·앞마당 ammadang.
      if (rep === "K") rep = "NG";
      else if (rep === "T") rep = "N";
      else if (rep === "P") rep = "M";
      // 유음화: 설날 seollal·별내 Byeollae.
      if (rep === "L" && c === ONSET_N) onsets[i + 1] = "l";
    } else if (c === ONSET_R) {
      if (rep === "K" || rep === "P" || rep === "T") {
        // 독립 dongnip·협력 hyeomnyeok·백리 Baengni: 받침 비음화 + ㄹ→ㄴ.
        rep = rep === "K" ? "NG" : rep === "P" ? "M" : "N";
        onsets[i + 1] = "n";
      } else if (rep === "M" || rep === "NG") {
        // 종로 Jongno·심리 simni.
        onsets[i + 1] = "n";
      } else if (rep === "N") {
        // 신라 Silla·선릉 Seolleung.
        rep = "L";
        onsets[i + 1] = "l";
      } else if (rep === "L") {
        // 울릉 Ulleung·플라자 peullaja.
        onsets[i + 1] = "l";
      }
    }
    // c === ㅎ: 체언 규칙 — 받침 k·t·p를 밝혀 적고 h를 유지한다(묵호 Mukho·집현전 Jiphyeonjeon).

    codas[i] = CODA_LETTER[rep];
  }

  let out = "";
  for (let i = 0; i < syllables.length; i++) {
    out += onsets[i] + VOWEL[syllables[i].vowel] + (codas[i] ?? "");
  }
  return out;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** 한 어절(공백 없는 토큰)을 로마자로. 한글 음절 연속마다 변환하고 나머지 문자는 통과한다. */
function romanizeWord(word: string): string {
  let out = "";
  let run: Syllable[] = [];
  let startsWithHangul = false;
  const flush = () => {
    if (run.length === 0) return;
    if (out === "") startsWithHangul = true;
    out += romanizeRun(run);
    run = [];
  };
  for (const ch of word) {
    const s = decompose(ch);
    if (s) run.push(s);
    else {
      flush();
      out += ch;
    }
  }
  flush();
  // 고유명사: 한글로 시작한 어절만 첫 글자를 대문자로(라틴 시작 어절 `GS25`는 손대지 않는다).
  return startsWithHangul ? capitalize(out) : out;
}

/**
 * 주소 어절의 행정구역·도로 단위 접미. 붙임표 앞뒤에서는 음운 변화를 반영하지 않으므로
 * 줄기와 단위를 따로 변환한다(삼죽면 Samjuk-myeon, 표기법 3장 5항). 긴 것부터 대조한다.
 */
const ADDRESS_UNITS = ["대로", "시", "군", "구", "읍", "면", "리", "동", "로", "길"] as const;
/**
 * `도`는 접미 한 글자로 판정하면 섬·지명(여의도·거제도·강화도)이 전부 `-do`로 갈린다(리뷰 검출).
 * 광역 도는 닫힌 집합이라 허용 목록으로만 뗀다(특별자치도는 `METRO_SUFFIXES`가 줄기만 남긴다).
 */
const PROVINCES = new Set(["경기도", "강원도", "충청북도", "충청남도", "전라북도", "전라남도", "경상북도", "경상남도", "제주도"]);
/** 광역 단위 접미는 떼고 줄기만 쓴다(서울특별시 → Seoul, 제주특별자치도 → Jeju). */
const METRO_SUFFIXES = ["특별자치시", "특별자치도", "특별시", "광역시"] as const;
/**
 * 광역시 약칭은 단위 접미와 같은 글자로 끝나도 붙임표를 만들지 않는다(대구 → Daegu, Dae-gu 아님).
 * 카카오 지역명이 이 약칭을 쓴다("대구 중구 …"). 설계 리뷰 검출.
 */
const METRO_SHORT_NAMES = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);

function romanizeAddressWord(word: string): string {
  // "성내로3길"·"성내로3번길" — 도로명 뒤 숫자 길(표기법 예: Seongnae-ro 3beon-gil).
  const numberedGil = /^([가-힣]+)(\d+)(번길|길)([^가-힣]*)$/.exec(word);
  if (numberedGil) {
    const [, road, digits, gil, tail] = numberedGil;
    return `${romanizeAddressWord(road)} ${digits}${gil === "번길" ? "beon" : ""}-gil${tail}`;
  }
  // "성내1동"·"을지로3가" — 숫자 뒤 행정동·가(표기법 예: Seongnae 1-dong, Euljiro 3-ga). 실페이지 실측 2026-08-31.
  const numberedDong = /^([가-힣]+)(\d+)(동|가)([^가-힣]*)$/.exec(word);
  if (numberedDong) {
    const [, stem, digits, unit, tail] = numberedDong;
    return `${romanizeWord(stem)} ${digits}-${unit === "동" ? "dong" : "ga"}${tail}`;
  }
  const match = /^([가-힣]+)([^가-힣]*)$/.exec(word);
  if (!match) return romanizeWord(word);
  const [, hangul, tail] = match;
  if (METRO_SHORT_NAMES.has(hangul)) return romanizeWord(hangul) + tail;
  if (PROVINCES.has(hangul)) {
    return `${romanizeWord(hangul.slice(0, -1))}-do${tail}`;
  }
  for (const suffix of METRO_SUFFIXES) {
    if (hangul.length > suffix.length && hangul.endsWith(suffix)) {
      return romanizeWord(hangul.slice(0, -suffix.length)) + tail;
    }
  }
  for (const unit of ADDRESS_UNITS) {
    if (hangul.length > unit.length && hangul.endsWith(unit)) {
      const stem = hangul.slice(0, -unit.length);
      return `${romanizeWord(stem)}-${romanizeWord(unit).toLowerCase()}${tail}`;
    }
  }
  return romanizeWord(word);
}

export interface RomanizeOptions {
  /**
   * 주소 어절 규칙: 행정구역·도로 단위(시·도·군·구·읍·면·리·동·로·길·대로)를 붙임표로 뗀다
   * (강동구 Gangdong-gu·길동 Gil-dong·성내로 Seongnae-ro). 장소명에는 켜지 말 것 —
   * 상호 "명동교자"가 갈린다. 호출부가 주소임을 아는 자리만 켠다.
   */
  address?: boolean;
}

/**
 * 서버 투영용: 한글이 있는 이름에만 로마자를 만든다(없으면 `undefined` — 필드 자체를 싣지 않는다).
 * 영문 원천 이름(TourAPI en·`CU`)은 한글이 없어 자동 제외된다(spec §7 `hasHangul` 게이트).
 */
export function romanNameOf(name: string | null | undefined): string | undefined {
  // NFD(분해 자모)로 온 한글은 음절 정규식에 안 걸린다 — 게이트 앞에서 NFC로 맞춘다(리뷰 검출).
  const nfc = name?.normalize("NFC");
  if (!nfc || !/[가-힣]/.test(nfc)) return undefined;
  // 이미 `Latin (한글)`로 병기된 원천(TourAPI en)은 로마자를 만들지 않는다 — 만들면
  // `Starbucks Gyeongdong Market (seutabeokseu Gyeongdong1960)` 같은 쓰레기 값이 CLI·채팅 data에 실린다
  // (a11y 감사 실호출 2026-08-31).
  if (EMBEDDED_BILINGUAL.test(nfc)) return undefined;
  return romanize(nfc);
}

/** `romanNameOf`의 주소판 — 행정구역·도로 단위 붙임표 규칙을 켠다. */
export function romanAddressOf(address: string | null | undefined): string | undefined {
  const nfc = address?.normalize("NFC");
  if (!nfc || !/[가-힣]/.test(nfc)) return undefined;
  return romanize(nfc, { address: true });
}

/**
 * 한글 문자열을 로마자로. 한글이 하나도 없으면 입력을 그대로 돌려준다(멱등).
 * 공백으로 나뉜 어절 단위로 변환하고 어절 경계에서는 음운 변화를 적용하지 않는다.
 */
export function romanize(text: string, options: RomanizeOptions = {}): string {
  if (!/[가-힣]/.test(text)) return text;
  const normalized = text.normalize("NFC");
  return normalized
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) return token;
      return options.address ? romanizeAddressWord(token) : romanizeWord(token);
    })
    .join("");
}
