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
// exit 0이 되어 **무력화된 게이트가 통과와 구분되지 않는다**. dodo
// `LocalizedKeyDriftTests`의 동형 가드 역이식.
//
// ⚠ **하한은 합계가 아니라 패턴마다 둔다**(리뷰 검출 2026-08-23): app의 두 패턴은
// 기여도가 947 대 6이라, 합계 하한은 소수 패턴이 통째로 죽어도 1% 미만만 움직여
// 그대로 통과한다 — 가드가 막으려던 바로 그 결함("있다"와 "그 자리에서 돈다"가
// 갈리는 것)을 한 층 아래에서 반복하는 셈이다. `LocalizedStringResource`는 App
// Intents 단축어 문자열의 유일한 통로라 그 축만 죽으면 누락이 영영 안 잡힌다.
//
// 값은 현 실측치의 절반 수준(측정 2026-08-23: appLocalized 947 ·
// LocalizedStringResource 6 · kitLocalized 57 · 카탈로그 app 1170 · kit 109).
// 정상적인 증감에는 걸리지 않고, 정당하게 하한 밑으로 줄면 그때 상수를 내린다.
const CHECKS = [
  {
    name: 'app',
    minCatalogKeys: 550,
    sourceDirs: [path.join(REPO_ROOT, 'ios', 'Gildongmu')],
    catalog: path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'Localizable.xcstrings'),
    patterns: [
      { label: 'appLocalized', re: /appLocalized\(\s*"((?:[^"\\]|\\.)*)"/g, min: 450 },
      { label: 'LocalizedStringResource', re: /LocalizedStringResource\(\s*"((?:[^"\\]|\\.)*)"/g, min: 3 },
    ],
  },
  {
    name: 'kit',
    minCatalogKeys: 50,
    sourceDirs: [path.join(REPO_ROOT, 'ios', 'GildongmuKit', 'Sources')],
    catalog: path.join(
      REPO_ROOT, 'ios', 'GildongmuKit', 'Sources', 'GildongmuKit', 'Resources', 'Localizable.xcstrings'
    ),
    patterns: [
      { label: 'kitLocalized', re: /kitLocalized\(\s*"((?:[^"\\]|\\.)*)"/g, min: 25 },
    ],
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
  const counts = new Map(check.patterns.map((p) => [p.label, 0]));

  for (const dir of check.sourceDirs) {
    for (const file of swiftFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of check.patterns) {
        for (const match of source.matchAll(pattern.re)) {
          counts.set(pattern.label, counts.get(pattern.label) + 1);
          const key = match[1];
          if (!catalogKeys.has(key)) {
            missing.push(`${path.relative(REPO_ROOT, file)}: ${key}`);
          }
        }
      }
    }
  }
  const referenced = [...counts.values()].reduce((a, b) => a + b, 0);

  const breakdown = check.patterns.map((p) => `${p.label} ${counts.get(p.label)}`).join(', ');
  console.log(`[${check.name}] 참조 ${referenced}건(${breakdown}), 카탈로그 ${catalogKeys.size}키`);
  for (const pattern of check.patterns) {
    const n = counts.get(pattern.label);
    if (n < pattern.min) {
      failed = true;
      console.error(
        `[${check.name}] ${pattern.label} 참조 ${n}건 < 하한 ${pattern.min}건 — 이 패턴의 스캔이 빗나갔다(경로·호출 규약 변경 의심). 대조가 성립하지 않으므로 통과로 치지 않는다.`
      );
    }
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
