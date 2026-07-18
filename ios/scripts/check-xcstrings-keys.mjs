#!/usr/bin/env node
// Swift 소스가 참조하는 로컬라이즈 키 전수를 String Catalog와 대조한다.
// 누락 키는 런타임에 키 문자열이 그대로 노출되는 무증상 결함이라 빌드가 못 잡는다 — 이 린터가 머지 게이트.
//
// 대조 규칙(플랜 Global Constraints의 호출 규약과 쌍):
//   앱 타깃(ios/Gildongmu/**)      String(localized: "키") · LocalizedStringResource("키") → 앱 카탈로그
//   Kit(ios/GildongmuKit/Sources)  kitLocalized("키"                                        → Kit 카탈로그
// 키는 항상 문자열 리터럴이어야 한다(동적 조립 금지). 사용법: node ios/scripts/check-xcstrings-keys.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const CHECKS = [
  {
    name: 'app',
    sourceDirs: [path.join(REPO_ROOT, 'ios', 'Gildongmu')],
    catalog: path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'Localizable.xcstrings'),
    patterns: [
      /String\(localized:\s*"((?:[^"\\]|\\.)*)"/g,
      /LocalizedStringResource\(\s*"((?:[^"\\]|\\.)*)"/g,
    ],
  },
  {
    name: 'kit',
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
  if (missing.length > 0) {
    failed = true;
    console.error(`[${check.name}] 카탈로그에 없는 키 ${missing.length}건:`);
    for (const line of missing) console.error(`  ${line}`);
  }
}

process.exit(failed ? 1 : 0);
