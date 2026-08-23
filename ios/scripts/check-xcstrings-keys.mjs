#!/usr/bin/env node
// Swift 소스가 참조하는 로컬라이즈 키 전수를 String Catalog와 대조한다.
// 누락 키는 런타임에 키 문자열이 그대로 노출되는 무증상 결함이라 빌드가 못 잡는다 — 이 린터가 머지 게이트.
//
// 대조 규칙(플랜 Global Constraints의 호출 규약과 쌍):
//   앱 타깃(ios/Gildongmu/**)      appLocalized("키") · LocalizedStringResource("키") → 앱 카탈로그
//   Kit(ios/GildongmuKit/Sources)  kitLocalized("키"                                        → Kit 카탈로그
// 키는 항상 문자열 리터럴이어야 한다(동적 조립 금지). 사용법: node ios/scripts/check-xcstrings-keys.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// 하한 가드: 경로·규약이 바뀌어 스캔이 통째로 빗나가면 참조 0건·누락 0건으로
// exit 0이 되어 **무력화된 게이트가 통과와 구분되지 않는다**. 현 실측치의 절반
// 수준으로 잡아 정상적인 증감에는 걸리지 않게 한다(측정 2026-08-23: app 953참조·
// 1170키, kit 57참조·109키). dodo `LocalizedKeyDriftTests`의 동형 가드 역이식.
const CHECKS = [
  {
    name: 'app',
    minReferenced: 450,
    minCatalogKeys: 550,
    sourceDirs: [path.join(REPO_ROOT, 'ios', 'Gildongmu')],
    catalog: path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'Localizable.xcstrings'),
    patterns: [
      /appLocalized\(\s*"((?:[^"\\]|\\.)*)"/g,
      /LocalizedStringResource\(\s*"((?:[^"\\]|\\.)*)"/g,
    ],
  },
  {
    name: 'kit',
    minReferenced: 25,
    minCatalogKeys: 50,
    sourceDirs: [path.join(REPO_ROOT, 'ios', 'GildongmuKit', 'Sources')],
    catalog: path.join(
      REPO_ROOT, 'ios', 'GildongmuKit', 'Sources', 'GildongmuKit', 'Resources', 'Localizable.xcstrings'
    ),
    patterns: [/kitLocalized\(\s*"((?:[^"\\]|\\.)*)"/g],
  },
];

function swiftFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...swiftFiles(full));
    else if (entry.endsWith('.swift')) result.push(full);
  }
  return result;
}

let failed = false;

for (const check of CHECKS) {
  const catalogKeys = new Set(
    Object.keys(JSON.parse(readFileSync(check.catalog, 'utf8')).strings)
  );
  const missing = [];
  let referenced = 0;

  for (const dir of check.sourceDirs) {
    for (const file of swiftFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of check.patterns) {
        for (const match of source.matchAll(pattern)) {
          referenced += 1;
          const key = match[1];
          if (!catalogKeys.has(key)) {
            missing.push(`${path.relative(REPO_ROOT, file)}: ${key}`);
          }
        }
      }
    }
  }

  console.log(`[${check.name}] 참조 ${referenced}건, 카탈로그 ${catalogKeys.size}키`);
  if (referenced < check.minReferenced) {
    failed = true;
    console.error(
      `[${check.name}] 참조 ${referenced}건 < 하한 ${check.minReferenced}건 — 스캔이 빗나갔다(경로·호출 규약 변경 의심). 대조가 성립하지 않으므로 통과로 치지 않는다.`
    );
  }
  if (catalogKeys.size < check.minCatalogKeys) {
    failed = true;
    console.error(
      `[${check.name}] 카탈로그 ${catalogKeys.size}키 < 하한 ${check.minCatalogKeys}키 — 카탈로그를 잘못 읽었다(경로·구조 변경 의심).`
    );
  }
  if (missing.length > 0) {
    failed = true;
    console.error(`[${check.name}] 카탈로그에 없는 키 ${missing.length}건:`);
    for (const line of missing) console.error(`  ${line}`);
  }
}

process.exit(failed ? 1 : 0);
