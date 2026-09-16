#!/usr/bin/env node
// messages/{ko,en,es,fr,it,ja}.json + ios/i18n/kit-extra/*.json
//   → android/kit/src/main/resources/gildongmu-kit-strings.json (:kit 카탈로그)
//
// iOS Kit 카탈로그(`ios/scripts/messages-to-xcstrings.mjs`의 kit 타깃)와 **같은 빌더**를 import해
// 같은 입력·같은 네임스페이스·같은 ko 위치 인자 순서로 만든다. 다른 것은 지정자뿐이다:
// Swift `String(format:)`의 `%N$@` → Kotlin `String.format`의 `%N$s`. 그래서 두 카탈로그는
// 값 단위로 대응하고, 웹 vitest `src/lib/__tests__/android-kit-drift.test.ts`가 (1) 이 파일이 최신인지,
// (2) Kit xcstrings와 값이 일치하는지 매 커밋 대조한다. iOS 스크립트와 같은 실패 조건을 지킨다 —
// 스킵된 키(지원 밖 ICU·로케일 간 인자 이름 불일치)가 있으면 실패, manifest 부재도 실패(조용한 부트스트랩 금지).
//
// 인자 순서 게이트(`ios/i18n/arg-order.json`)는 iOS 스크립트가 소유한다 — 여기서는 manifest를
// 갱신하지 않고, 우리가 만든 순서가 manifest와 어긋나면 실패한다(한 키에 ABI 둘은 성립하지 않는다).
//
// 사용법: node android/scripts/messages-to-kit-strings.mjs        # 생성
//         node android/scripts/messages-to-kit-strings.mjs --check # 최신 여부만(exit 1이면 재생성)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, TARGETS, ARG_ORDER_PATH } from '../../ios/scripts/messages-to-xcstrings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
export const OUTPUT_PATH = path.join(REPO_ROOT, 'android', 'kit', 'src', 'main', 'resources', 'gildongmu-kit-strings.json');

/** Swift 지정자 `%N$@` → Kotlin `%N$s`. `%%`는 그대로. */
export function toKotlinFormat(value) {
  return value.replace(/%(\d+)\$@/g, '%$1$$s');
}

/** :kit 카탈로그 객체(결정론: 키 정렬·로케일 순서 고정). 스킵된 키가 있으면 throw — 카탈로그에서 조용히 빠져 `kitLocalized`가 키 문자열을 낭독하게 두지 않는다. */
export function buildKitStrings(built = buildCatalog(TARGETS.kit)) {
  const { catalog, skipped } = built;
  if (skipped.length > 0) throw new Error(`[kit-strings] 변환 불가 키(지원 밖 ICU·인자 이름 불일치): ${skipped.join(', ')}`);
  const strings = {};
  for (const key of Object.keys(catalog.strings).sort()) {
    const byLang = {};
    for (const [lang, unit] of Object.entries(catalog.strings[key].localizations)) {
      byLang[lang] = toKotlinFormat(unit.stringUnit.value);
    }
    strings[key] = byLang;
  }
  return { sourceLanguage: catalog.sourceLanguage, strings };
}

/** 렌더링된 파일 본문(byte-identical 계약). */
export function renderKitStrings(built = buildCatalog(TARGETS.kit)) {
  return `${JSON.stringify(buildKitStrings(built), null, 2)}\n`;
}

/** manifest 대조: 우리 키의 ko 인자 순서가 iOS manifest와 다르면 그 목록을 돌려준다(빈 배열 = 정합). manifest 부재는 throw. */
export function argOrderMismatches(built = buildCatalog(TARGETS.kit)) {
  if (!existsSync(ARG_ORDER_PATH)) throw new Error(`[kit-strings] ios/i18n/arg-order.json이 없다 — iOS 스크립트로 먼저 만든다`);
  const manifest = JSON.parse(readFileSync(ARG_ORDER_PATH, 'utf8'));
  const { argOrder } = built;
  return Object.keys(argOrder)
    .filter((key) => key in manifest && manifest[key].join(',') !== argOrder[key].join(','))
    .sort();
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const built = buildCatalog(TARGETS.kit);
  const mismatches = argOrderMismatches(built);
  if (mismatches.length > 0) {
    console.error(`[kit-strings] ko 인자 순서가 ios/i18n/arg-order.json과 다르다: ${mismatches.join(', ')}`);
    process.exit(1);
  }
  const rendered = renderKitStrings(built);
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : '';
    if (current !== rendered) {
      console.error(`[kit-strings] ${path.relative(REPO_ROOT, OUTPUT_PATH)}가 낡았다 — 스크립트를 다시 돌려 커밋한다`);
      process.exit(1);
    }
    console.log('[kit-strings] 최신');
  } else {
    writeFileSync(OUTPUT_PATH, rendered);
    console.log(`[kit-strings] ${path.relative(REPO_ROOT, OUTPUT_PATH)} ${Object.keys(buildKitStrings(built).strings).length}키`);
  }
}
