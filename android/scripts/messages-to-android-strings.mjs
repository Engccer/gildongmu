#!/usr/bin/env node
// messages/{ko,en,es,fr,it,ja}.json + android/i18n/android-extra/{lang}.json
//   → android/app/src/main/res/values/strings.xml (ko = 기본) · values-{en,es,fr,it,ja}/strings.xml
//
// iOS 빌더 `buildCatalog`를 import해 같은 규칙(ko 등장 순서 positional, ICU 복수 블록은 문자열 그대로,
// `#` → `%N$@`, 로케일 간 인자 이름 불일치는 스킵)으로 만든 뒤 `%N$@` → `%N$s`로 바꾼다. 복수형은
// Android `<plurals>`로 가지 않는다 — 한 문장에 복수 블록이 둘인 키(`bike.availability`)가 있어 표현이 안 되고,
// 앱 언어와 리소스 로케일이 같으므로 :kit `formatLocalized`가 런타임에 분기를 고른다(spec §6, A29).
// 그래서 **인자 있는 문자열은 `appLocalized(...)`만 지난다**(`getString(id, args)` 금지 — 소스 가드가 잠근다).
//
// 리소스 이름은 키의 `.`을 `_`로(충돌 0 확인). 각 로케일 파일 첫 항목 `app_locale`은 리소스 해석기가 실제로
// 고른 폴더를 앱에 알리는 마커다(`AppLocale.current` — `configuration.locales[0]`는 해석 결과와 갈린다).
// 인자 순서 잠금은 iOS `syncArgOrder`를 `android/i18n/arg-order.json`에 그대로 적용한다(기존 키 순서 변경은
// exit 1, `--update-arg-order`로만, 부트스트랩도 그 플래그로만).
//
// ios-extra(`ios.*`)는 `android.*`로 개명해 일괄 들이고(M2 spec §7) android-extra가 같은 이름을 덮는다 — 문안 오버라이드는
// android-extra에서만. `%%`·`%N$s` 밖의 `%`가 남은 값은 거부한다(iOS 지정자 `%@` 원문 키).
//
// 사용법: node android/scripts/messages-to-android-strings.mjs [--check] [--update-arg-order]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, syncArgOrder, UPDATE_ARG_ORDER_FLAG } from '../../ios/scripts/messages-to-xcstrings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
export const LOCALES = ['ko', 'en', 'es', 'fr', 'it', 'ja'];
export const SOURCE_LANGUAGE = 'ko';
export const ARG_ORDER_PATH = path.join(REPO_ROOT, 'android', 'i18n', 'arg-order.json');
export const EXTRA_DIR = path.join(REPO_ROOT, 'android', 'i18n', 'android-extra');
export const IOS_EXTRA_DIR = path.join(REPO_ROOT, 'ios', 'i18n', 'ios-extra');
/** ios-extra에서 안드로이드로 개명해 들이는 접두(`ios.nearby.subway` → `android.nearby.subway`). 나머지 키는 웹 오버라이드라 무시. */
const IOS_PREFIX = 'ios.';
const ANDROID_PREFIX = 'android.';
export const OUTPUT_DIR = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'res');
const TARGET = { namespaces: null, extraDir: EXTRA_DIR, output: null };

export function valuesDir(locale) {
  return path.join(OUTPUT_DIR, locale === SOURCE_LANGUAGE ? 'values' : `values-${locale}`);
}

/** 키 → 리소스 이름(`search.placeCount` → `search_placeCount`). */
export function resourceName(key) {
  return key.replace(/\./g, '_');
}

/**
 * aapt2 이스케이프. `'`·`"` → `\'`·`\"`, `&`·`<`·`>` → 엔티티, 선두 `@`·`?` → `\@`·`\?`,
 * 선두·후행 공백이 있으면 큰따옴표로 감싼다(aapt2는 감싸지 않은 양끝 공백을 지운다 — 실재 키
 * `whereAmI.overview.transitLine` = "{line} "). `%`는 그대로(빌더가 리터럴 `%`를 `%%`로 이미 바꿨다).
 */
export function escapeAndroid(value) {
  let v = value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
  if (/^[@?]/.test(v)) v = `\\${v}`;
  if (/^\s|\s$/.test(v)) v = `"${v}"`;
  return v;
}

/** `escapeAndroid`의 역함수(왕복 검사용). */
export function unescapeAndroid(value) {
  let v = value;
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (/^\\[@?]/.test(v)) v = v.slice(1);
  return v
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\\\\/g, '\\');
}

/** iOS 전용 카탈로그(`ios/i18n/ios-extra`)만 따로 빌드한다 — `namespaces: []`는 messages를 건너뛰고 extra만 읽는다. */
export function buildIosExtra() {
  return buildCatalog({ namespaces: [], extraDir: IOS_EXTRA_DIR, output: null });
}

/**
 * `%%`·`%N$s` 밖의 `%`가 남았는가(iOS 지정자 `%@`가 원문에 박힌 키 등 — aapt2 거부 또는 `String.format` 예외).
 * 전방탐색 정규식은 `습도 %1$s%%`의 둘째 `%`를 오탐하므로 `%%`·`%N$s`를 먼저 소비하는 스캐너로 쓴다.
 */
export function hasStrayPercent(value) {
  let i = 0;
  while ((i = value.indexOf('%', i)) >= 0) {
    if (value.startsWith('%%', i)) { i += 2; continue; }
    const m = /^%\d+\$s/.exec(value.slice(i));
    if (!m) return true;
    i += m[0].length;
  }
  return false;
}

/**
 * 로케일별 {키: 값}. messages + android-extra(`built`)에 ios-extra의 `ios.` 접두 키를 `android.`로 개명해 더한다 —
 * 같은 이름이 android-extra에 있으면 android-extra가 이긴다(플랫폼 문안 오버라이드). ios-extra의 나머지 키(웹 키를 덮는
 * iOS 오버라이드, 예: "iPhone 만보계")는 무시하고 수만 센다(`ignoredIosOverrides`). `skipped`(지원 밖 ICU·인자 이름 불일치)가
 * 있으면 throw — 조용히 빠져 키 문자열이 낭독되게 두지 않는다. `rejected`는 (a) 인자 0인데 `%%`를 담은 키(`stringResource(id)`가
 * `%%`를 그대로 보인다) (b) `%%`·`%N$s` 밖의 `%`가 남은 값.
 */
export function buildAndroidStrings(built = buildCatalog(TARGET), iosExtra = buildIosExtra()) {
  const { catalog, skipped } = built;
  if (skipped.length > 0) throw new Error(`[android-strings] 변환 불가 키(지원 밖 ICU·인자 이름 불일치): ${skipped.join(', ')}`);
  if (iosExtra.skipped.length > 0) throw new Error(`[android-strings] ios-extra 변환 불가 키: ${iosExtra.skipped.join(', ')}`);
  const merged = { ...catalog.strings };
  const argOrder = { ...built.argOrder };
  let ignoredIosOverrides = 0;
  const imported = [];
  for (const key of Object.keys(iosExtra.catalog.strings)) {
    if (!key.startsWith(IOS_PREFIX)) { ignoredIosOverrides += 1; continue; }
    const renamed = ANDROID_PREFIX + key.slice(IOS_PREFIX.length);
    if (renamed in merged) continue; // android-extra 우선
    merged[renamed] = iosExtra.catalog.strings[key];
    if (key in iosExtra.argOrder) argOrder[renamed] = iosExtra.argOrder[key];
    imported.push(renamed);
  }
  const strings = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  const rejected = [];
  for (const key of Object.keys(merged).sort()) {
    for (const [lang, unit] of Object.entries(merged[key].localizations)) {
      if (!LOCALES.includes(lang)) throw new Error(`[android-strings] LOCALES 밖 로케일 ${lang} (${key}) — LOCALES와 values-${lang}/를 함께 더한다`);
      const value = unit.stringUnit.value.replace(/%(\d+)\$@/g, '%$1$$s');
      if (!(key in argOrder) && value.includes('%%')) rejected.push(`${key}/${lang}: 인자 0에 %%`);
      if (hasStrayPercent(value)) rejected.push(`${key}/${lang}: %%·%N$s 밖의 %`);
      strings[lang][key] = value;
    }
  }
  return { strings, argOrder, rejected, imported, ignoredIosOverrides };
}

/** 한 로케일의 strings.xml 본문(결정론: 키 정렬·끝 개행 1개). */
export function renderStringsXml(locale, built = buildAndroidStrings()) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- 생성물: node android/scripts/messages-to-android-strings.mjs — 손으로 고치지 않는다. 정본은 messages/*.json + android/i18n/android-extra. -->',
    '<resources>',
    `    <string name="app_locale">${locale}</string>`,
  ];
  for (const key of Object.keys(built.strings[locale]).sort()) {
    lines.push(`    <string name="${resourceName(key)}">${escapeAndroid(built.strings[locale][key])}</string>`);
  }
  lines.push('</resources>', '');
  return lines.join('\n');
}

/** 생성된 strings.xml → {리소스이름: 원문}(왕복 검사·테스트용). */
export function parseStringsXml(xml) {
  const out = {};
  for (const m of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) out[m[1]] = unescapeAndroid(m[2]);
  return out;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  const built = buildCatalog(TARGET);
  const android = buildAndroidStrings(built);
  if (android.rejected.length > 0) {
    console.error(`[android-strings] 거부 키: ${android.rejected.join(', ')}`);
    process.exit(1);
  }
  console.log(`[android-strings] ios-extra 도입 ${android.imported.length}키, 웹 오버라이드 ${android.ignoredIosOverrides}키 무시`);
  const sync = syncArgOrder({ update: args.includes(UPDATE_ARG_ORDER_FLAG), manifestPath: ARG_ORDER_PATH, current: android.argOrder });
  if (!sync.ok) process.exit(1);
  let stale = false;
  for (const locale of LOCALES) {
    const file = path.join(valuesDir(locale), 'strings.xml');
    const rendered = renderStringsXml(locale, android);
    if (args.includes('--check')) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (current !== rendered) { stale = true; console.error(`[android-strings] 낡음: ${path.relative(REPO_ROOT, file)}`); }
    } else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, rendered, 'utf8');
      console.log(`[android-strings] ${path.relative(REPO_ROOT, file)} ${Object.keys(android.strings[locale]).length}키`);
    }
  }
  if (stale) process.exit(1);
  if (args.includes('--check')) console.log('[android-strings] 최신');
}
