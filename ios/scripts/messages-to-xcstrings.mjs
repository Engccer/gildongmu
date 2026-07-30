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
// 범위: 단순 명명 플레이스홀더({name} 형태, ICU plural/select 구문 아님)만 있는 키는
// ko(source language) 원문에서의 등장 순서로 positional specifier(%1$@, %2$@...)로 변환한다
// (같은 이름→같은 인덱스 매핑을 전 로케일에 동일 적용, 로케일별 어순이 달라도 안전).
// Swift 쪽에서는 `String(format: String(localized: "..."), arg1, arg2)`로 소비한다.
// plural/select 구문이 있거나, 로케일 간 플레이스홀더 이름 집합이 어긋나는 키는 스킵한다.
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
const ANY_BRACE_RE = /\{[^{}]*\}/g;
const SIMPLE_TOKEN_RE = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const NAMED_PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MESSAGES_DIR = path.join(REPO_ROOT, 'messages');
const I18N_DIR = path.join(REPO_ROOT, 'ios', 'i18n');

// Kit 네임스페이스: Kit 소스 `kitLocalized` 실참조 도메인만 — 감사 2026-07-30에서
// 나머지 11종 180키 전량 미참조 확정. 앱 타깃은 전 네임스페이스를 담는다
// (일부 중복 수록은 의도 — 카탈로그는 타깃별로 독립 컴파일되므로 정합 문제 없음).
const KIT_NAMESPACES = ['category', 'region', 'whereAmI'];

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

/** 값 안의 `{...}` 토큰을 전부 뽑아 이름 배열로 반환한다. plural/select 등 단순 명명
 * 플레이스홀더가 아닌 토큰이 하나라도 있으면 null(복합 ICU, 변환 불가)을 반환한다. */
function extractPlaceholderNames(value) {
  const tokens = value.match(ANY_BRACE_RE);
  if (!tokens) return [];
  const names = [];
  for (const token of tokens) {
    const match = SIMPLE_TOKEN_RE.exec(token);
    if (!match) return null;
    names.push(match[1]);
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

/** `{name}`을 nameOrder 안 위치 기반 `%N$@`로 치환한다. 문자열 안 등장 순서가 로케일마다
 * 달라도(어순 차이) nameOrder(ko 기준) 인덱스로 고정되므로 안전하다.
 * 리터럴 `%`는 먼저 `%%`로 이스케이프한다 — 이 키들은 Swift String(format:)으로
 * 소비되는데, 유효 지정자로 이어지지 않는 `%`를 format이 조용히 삼킨다
 * (실측: "습도 %1$@%" → "습도 55", % 소실. 코드리뷰 2026-07-19). */
function toPositionalFormat(value, nameOrder) {
  return value.replaceAll('%', '%%').replace(NAMED_PLACEHOLDER_RE, (full, name) => {
    const index = nameOrder.indexOf(name);
    return index === -1 ? full : `%${index + 1}$@`;
  });
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

    const namesByLocale = {};
    let hasComplexIcu = false;
    for (const [locale, value] of Object.entries(valuesByLocale)) {
      const names = extractPlaceholderNames(value);
      if (names === null) {
        hasComplexIcu = true;
        break;
      }
      namesByLocale[locale] = names;
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
    for (const [locale, value] of Object.entries(valuesByLocale)) {
      localizations[locale] = {
        stringUnit: { state: 'translated', value: toPositionalFormat(value, nameOrder) },
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
  if (skipped.length > 0) console.log(`[${name}] 스킵: ${skipped.join(', ')}`);
}

const arg = process.argv[2];
if (!arg || !['app', 'kit', 'all'].includes(arg)) {
  console.error('사용법: node ios/scripts/messages-to-xcstrings.mjs <app|kit|all>');
  process.exit(1);
}
for (const name of arg === 'all' ? ['app', 'kit'] : [arg]) generate(name);
