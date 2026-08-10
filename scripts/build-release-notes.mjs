#!/usr/bin/env node
// docs/appstore/release-notes.md(What's New 정본) → ios/Gildongmu/Resources/release-notes.json
// (설정 > 업데이트 이력 화면의 번들 소스, 스펙 2026-08-10 §2.1)
//
// 파서 규칙: `## <버전> (빌드 N)` 섹션 안 `### ko`/`### en` 각각의 첫 fenced 코드블록이
// 본문. 둘 다 없는 버전은 제외(1.0 — What's New 없는 첫 출시가 정본), 한쪽만 있으면
// throw(불완전 데이터로 조용히 출시되는 것을 막는다). 드리프트는
// src/lib/__tests__/release-notes-bundle.test.ts가 강제한다(이 파서를 그대로 import).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'docs', 'appstore', 'release-notes.md');
const OUTPUT = path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'release-notes.json');

export function parseReleaseNotes(md) {
  const notes = [];
  for (const section of md.split(/^## /m).slice(1)) {
    const header = section.slice(0, section.indexOf('\n'));
    const version = header.match(/^(\d+(?:\.\d+)*) \(빌드 \d+\)/)?.[1];
    if (!version) throw new Error(`버전 헤더 형식 아님: "## ${header}"`);
    const ko = languageBlock(section, 'ko');
    const en = languageBlock(section, 'en');
    if (ko === null && en === null) continue;
    if (ko === null || en === null) {
      throw new Error(`${version}: ko·en 중 한쪽만 있다 — 스펙 §2.1 위반(불완전 데이터)`);
    }
    notes.push({ version, ko, en });
  }
  return notes;
}

// `### <lang>` 하위 절의 첫 fenced 코드블록. 절 분할이 먼저라 ko 검색이 en 블록을
// 넘겨 잡는 일이 구조적으로 없다.
function languageBlock(section, lang) {
  const sub = section.split(/^### /m).slice(1).find((s) => s.startsWith(`${lang}\n`));
  const body = sub?.match(/```\n([\s\S]*?)\n```/)?.[1];
  return body ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = parseReleaseNotes(readFileSync(SOURCE, 'utf8'));
  writeFileSync(OUTPUT, `${JSON.stringify(notes, null, 2)}\n`);
  console.log(`release-notes.json: ${notes.length}개 버전 (최신 ${notes[0]?.version})`);
}
