#!/usr/bin/env node
// messages/{ko,en,es,fr,it,ja}.json (웹 i18n 정본, flat 파일·최상위 키가 네임스페이스)
//   → ios/Gildongmu/Resources/Localizable.xcstrings (앱 타깃)
//   → ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings (Kit)
// 결정론 변환: 같은 입력으로 재실행하면 byte-identical한 출력을 생성한다.
//
// 사용법: node ios/scripts/messages-to-xcstrings.mjs <app|kit|all>
// dodo-planet 스크립트 이식본. 차이: ① gildongmu는 로케일별 flat 파일이라 로더가 다르고
// ② CLI 인자는 네임스페이스가 아니라 타깃명뿐(dodo의 인자 오염→카탈로그 truncation
// 실사고를 원천 차단 — 네임스페이스 목록은 아래 상수로 고정) ③ 출력이 두 카탈로그다.
//
// 범위: 명명 플레이스홀더 `{name}`과 ICU 복수 블록 `{name, plural, one {…} other {…}}`
// (A29, spec 2026-08-31-plural-forms-design.md §4)만 있는 키를 ko(source language) 원문
// 등장 순서로 positional specifier(%1$@, %2$@...)로 변환한다(같은 이름→같은 인덱스를 전
// 로케일에 동일 적용, 로케일별 어순이 달라도 안전). 복수 블록은 이름을 인덱스로 바꾼
// `{N, plural, one {…} other {…}}`로 **문자열 그대로** 싣고, 블록 안 `#`은 그 인자의
// `%N$@`가 된다 — Swift `formatLocalized`(Kit Localization.swift)가 실행 시 분기를 고른 뒤
// String(format:)을 태운다. xcstrings 네이티브 `variations.plural`을 쓰지 않는 이유는 lproj로
// 컴파일되면 `.stringsdict`(`%#@value@`)가 되어 앱의 명시 언어 조회가 one/other 값에 닿지
// 못하기 때문이다(실험 2026-08-31, spec §4.1). 분기 이름은 one·other만 지원한다.
// select·few/many·중첩 plural이 있거나, 로케일 간 인자 이름 집합이 어긋나는 키는 스킵한다.
//
// extra 병합 입력(타깃별, 매 실행 항상 병합):
//   ios/i18n/ios-extra/{locale}.json → app 타깃 (iOS 전용 키 + 웹 카피 오버라이드)
//   ios/i18n/kit-extra/{locale}.json → kit 타깃
// 웹과 같은 키를 넣으면 extra 값이 웹 값을 오버라이드한다(나중 병합 승리) — iOS 실문구가
// 웹 카피와 다를 때 ko 표시 문자열 불변식을 지키는 공식 경로.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['ko', 'en', 'es', 'fr', 'it', 'ja'];
const SOURCE_LANGUAGE = 'ko';
const SIMPLE_ARG_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/;
const PLURAL_HEAD_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*plural\s*,([\s\S]*)$/;
const BRANCH_HEAD_RE = /^\s*([a-zA-Z]+)\s*\{/;
const PLURAL_BRANCHES = ['one', 'other'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MESSAGES_DIR = path.join(REPO_ROOT, 'messages');
const I18N_DIR = path.join(REPO_ROOT, 'ios', 'i18n');

// Kit 네임스페이스: Kit 소스 `kitLocalized` 실참조 도메인만 — 감사 2026-07-30에서
// 나머지 11종 180키 전량 미참조 확정. 앱 타깃은 전 네임스페이스를 담는다
// (일부 중복 수록은 의도 — 카탈로그는 타깃별로 독립 컴파일되므로 정합 문제 없음).
// `route`는 2026-08-08 빠른하차(QuickExitText)가 참조를 만들며 추가됐다 — 규칙을
// 되돌린 것이 아니라 "실참조 도메인만"이라는 규칙이 그대로 적용된 결과다.
const KIT_NAMESPACES = ['category', 'region', 'route', 'whereAmI'];

const TARGETS = {
  app: {
    namespaces: null, // null = messages/ko.json의 전 네임스페이스
    extraDir: path.join(I18N_DIR, 'ios-extra'),
    output: path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'Localizable.xcstrings'),
  },
  kit: {
    namespaces: KIT_NAMESPACES,
    extraDir: path.join(I18N_DIR, 'kit-extra'),
    output: path.join(
      REPO_ROOT, 'ios', 'GildongmuKit', 'Sources', 'GildongmuKit', 'Resources', 'Localizable.xcstrings'
    ),
  },
};

/** `open` 위치의 `{`와 짝이 되는 `}` 인덱스(깊이 계산). 없으면 -1. */
function matchingBrace(value, open) {
  let depth = 0;
  for (let i = open; i < value.length; i += 1) {
    if (value[i] === '{') depth += 1;
    else if (value[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * ICU 부분집합 파서. 값을 조각 배열로 돌려준다:
 *   { kind: 'text', text }            리터럴
 *   { kind: 'arg', name }             `{name}`
 *   { kind: 'plural', name, branches } `{name, plural, one {…} other {…}}` — branches는
 *                                     분기 이름 → 조각 배열(`#`는 { kind: 'hash' }, `{name}`은
 *                                     'arg', 중첩 plural 불가)
 * 지원 밖 구문(select·few/many·중첩 plural·짝 없는 `}`)이 하나라도 있으면 null(스킵).
 * 짝 없는 `{`는 종전 동작대로 리터럴로 본다.
 */
function parseIcu(value, { insidePlural = false } = {}) {
  const parts = [];
  let text = '';
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === '}') return null;
    // ICU 아포스트로피 인용(`'{'`·`'#'`·`''`)은 지원하지 않는다 — 웹은 리터럴로 풀지만 이
    // 변환기·Swift 스캐너는 구조 문자로 세어 양쪽이 갈린다. 낱말 속 `'`(C'è)는 리터럴이다.
    if (ch === "'" && i + 1 < value.length && "{}#'".includes(value[i + 1])) return null;
    if (ch === '#' && insidePlural) {
      if (text) parts.push({ kind: 'text', text });
      text = '';
      parts.push({ kind: 'hash' });
      i += 1;
      continue;
    }
    if (ch !== '{') {
      text += ch;
      i += 1;
      continue;
    }
    const close = matchingBrace(value, i);
    if (close === -1) {
      text += ch;
      i += 1;
      continue;
    }
    const inner = value.slice(i + 1, close);
    const simple = SIMPLE_ARG_RE.exec(inner);
    if (simple) {
      if (text) parts.push({ kind: 'text', text });
      text = '';
      parts.push({ kind: 'arg', name: simple[1] });
      i = close + 1;
      continue;
    }
    const plural = PLURAL_HEAD_RE.exec(inner);
    if (!plural || insidePlural) return null;
    const branches = parsePluralBranches(plural[2]);
    if (!branches) return null;
    if (text) parts.push({ kind: 'text', text });
    text = '';
    parts.push({ kind: 'plural', name: plural[1], branches });
    i = close + 1;
  }
  if (text) parts.push({ kind: 'text', text });
  return parts;
}

/** `one {…} other {…}` 꼬리를 분기 사전으로. 이름은 one·other만, 둘 다 있어야 하고 중복 불가. */
function parsePluralBranches(tail) {
  const branches = {};
  let rest = tail;
  while (rest.trim().length > 0) {
    const head = BRANCH_HEAD_RE.exec(rest);
    if (!head) return null;
    const name = head[1];
    if (!PLURAL_BRANCHES.includes(name) || name in branches) return null;
    const open = head[0].length - 1;
    const close = matchingBrace(rest, open);
    if (close === -1) return null;
    const body = parseIcu(rest.slice(open + 1, close), { insidePlural: true });
    if (!body) return null;
    branches[name] = body;
    rest = rest.slice(close + 1);
  }
  return PLURAL_BRANCHES.every((name) => name in branches) ? branches : null;
}

/** 조각 배열이 참조하는 인자 이름(등장 순서, plural 인자 포함, 분기 안 인자 포함). */
function referencedNames(parts) {
  const names = [];
  for (const part of parts) {
    if (part.kind === 'arg' || part.kind === 'plural') names.push(part.name);
    if (part.kind === 'plural') {
      for (const body of Object.values(part.branches)) names.push(...referencedNames(body));
    }
  }
  return names;
}

function dedupeInOrder(names) {
  const seen = [];
  for (const name of names) {
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** 조각 배열을 nameOrder 인덱스 기반 문자열로 되돌린다. `{name}` → `%N$@`, plural →
 * `{N, plural, one {…} other {…}}`, 분기 안 `#` → 그 인자의 `%N$@`. 리터럴 `%`는 `%%`로
 * 이스케이프한다 — 이 문자열은 Swift String(format:)으로 소비되는데, 유효 지정자로
 * 이어지지 않는 `%`를 format이 조용히 삼킨다(실측: "습도 %1$@%" → "습도 55", % 소실.
 * 코드리뷰 2026-07-19). 문자열 안 등장 순서가 로케일마다 달라도(어순 차이) nameOrder
 * (ko 기준) 인덱스로 고정되므로 안전하다. */
function toPositionalFormat(parts, nameOrder, hashIndex = null) {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') out += part.text.replaceAll('%', '%%');
    else if (part.kind === 'hash') out += `%${hashIndex}$@`;
    else if (part.kind === 'arg') out += `%${nameOrder.indexOf(part.name) + 1}$@`;
    else {
      const index = nameOrder.indexOf(part.name) + 1;
      const branches = PLURAL_BRANCHES.map(
        (name) => `${name} {${toPositionalFormat(part.branches[name], nameOrder, index)}}`
      );
      out += `{${index}, plural, ${branches.join(' ')}}`;
    }
  }
  return out;
}

function flatten(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function loadLocaleMessages(locale) {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function loadExtraLocale(extraDir, locale) {
  const filePath = path.join(extraDir, `${locale}.json`);
  if (!existsSync(filePath)) return {};
  return flatten(JSON.parse(readFileSync(filePath, 'utf8')));
}

function buildCatalog(target) {
  const perLocale = Object.fromEntries(LOCALES.map((locale) => [locale, {}]));
  const allKeys = new Set();

  for (const locale of LOCALES) {
    const messages = loadLocaleMessages(locale);
    const namespaces = target.namespaces ?? Object.keys(messages);
    for (const namespace of namespaces) {
      const value = messages[namespace];
      if (value === undefined) continue;
      const flat = flatten(value, namespace);
      for (const [key, v] of Object.entries(flat)) {
        perLocale[locale][key] = v;
        allKeys.add(key);
      }
    }
  }

  for (const locale of LOCALES) {
    const flat = loadExtraLocale(target.extraDir, locale);
    for (const [key, value] of Object.entries(flat)) {
      perLocale[locale][key] = value;
      allKeys.add(key);
    }
  }

  const sortedKeys = [...allKeys].sort();
  const strings = {};
  const skipped = [];

  for (const key of sortedKeys) {
    const valuesByLocale = {};
    let hasNonString = false;

    for (const locale of LOCALES) {
      const value = perLocale[locale][key];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        hasNonString = true;
        continue;
      }
      valuesByLocale[locale] = value;
    }

    if (hasNonString) {
      skipped.push(key);
      continue;
    }

    const partsByLocale = {};
    const namesByLocale = {};
    let hasComplexIcu = false;
    for (const [locale, value] of Object.entries(valuesByLocale)) {
      const parts = parseIcu(value);
      if (parts === null) {
        hasComplexIcu = true;
        break;
      }
      partsByLocale[locale] = parts;
      namesByLocale[locale] = referencedNames(parts);
    }

    if (hasComplexIcu) {
      skipped.push(key);
      continue;
    }

    const hasAnyPlaceholder = Object.values(namesByLocale).some((names) => names.length > 0);

    if (!hasAnyPlaceholder) {
      const localizations = {};
      for (const [locale, value] of Object.entries(valuesByLocale)) {
        localizations[locale] = { stringUnit: { state: 'translated', value } };
      }
      strings[key] = { localizations };
      continue;
    }

    // ko 원문 등장 순서로 name → 인덱스 매핑 확정. 다른 로케일이 ko에 없는 이름을 쓰면
    // (표기 불일치·오타) 안전하게 변환을 포기하고 스킵한다.
    const nameOrder = dedupeInOrder(namesByLocale[SOURCE_LANGUAGE] ?? []);
    const hasUnmappedName = Object.values(namesByLocale).some((names) =>
      names.some((name) => !nameOrder.includes(name))
    );

    if (nameOrder.length === 0 || hasUnmappedName) {
      skipped.push(key);
      continue;
    }

    const localizations = {};
    for (const locale of Object.keys(valuesByLocale)) {
      localizations[locale] = {
        stringUnit: { state: 'translated', value: toPositionalFormat(partsByLocale[locale], nameOrder) },
      };
    }
    strings[key] = { localizations };
  }

  return {
    catalog: { sourceLanguage: SOURCE_LANGUAGE, strings, version: '1.0' },
    totalKeys: sortedKeys.length,
    skipped,
  };
}

function generate(name) {
  const target = TARGETS[name];
  const { catalog, totalKeys, skipped } = buildCatalog(target);
  writeFileSync(target.output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const written = Object.keys(catalog.strings).length;
  console.log(`[${name}] ${target.output}`);
  console.log(`[${name}] 키 ${totalKeys}개 중 ${written}개 수록, ${skipped.length}개 스킵`);
  if (skipped.length > 0) {
    // 스킵은 조용한 실패다 — 키가 카탈로그에서 빠지면 화면엔 키 문자열이 낭독되고 린터가
    // 잡는 것은 Swift가 참조하는 키뿐이다. 지원 밖 ICU(select·few/many·중첩·인용)와
    // 로케일 간 인자 이름 불일치는 정본 JSON을 고쳐야 하므로 생성을 실패시킨다.
    console.error(`[${name}] 스킵: ${skipped.join(', ')}`);
    process.exitCode = 1;
  }
}

// 테스트(src/lib/__tests__/xcstrings-plural.test.ts)가 변환 함수를 직접 부른다.
export { parseIcu, referencedNames, dedupeInOrder, toPositionalFormat, buildCatalog, TARGETS };

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const arg = process.argv[2];
  if (!arg || !['app', 'kit', 'all'].includes(arg)) {
    console.error('사용법: node ios/scripts/messages-to-xcstrings.mjs <app|kit|all>');
    process.exit(1);
  }
  for (const name of arg === 'all' ? ['app', 'kit'] : [arg]) generate(name);
}
