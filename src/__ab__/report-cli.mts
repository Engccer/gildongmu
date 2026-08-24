/**
 * 저장된 A/B 결과 JSON을 리포트로 다시 낸다(재판정·문서 옮길 때).
 * 실행: `npm run eval:ab:report -- .ab-out/<파일>.json` (Node 타입 스트리핑, 의존성 0. `.mts`라 ESM 경고 없음)
 */
import fs from "node:fs";
// @ts-expect-error 노드 타입 스트리핑은 상대 import에 .ts 확장자가 필수이고 tsc는 그것을 금지한다 — 런타임이 정본.
import { buildReport, type ResultFile } from "./report.ts";

const target = process.argv[2];
if (!target) {
  console.error("사용법: npm run eval:ab:report -- <결과.json>");
  process.exit(2);
}
const file = JSON.parse(fs.readFileSync(target, "utf8")) as ResultFile;
if (!file.run || !Array.isArray(file.results)) {
  console.error("결과 파일 계약(run·cases·results) 밖의 파일이다 — 2026-08-25 이전 원시 결과는 이 리포트를 못 낸다.");
  process.exit(1);
}
console.log(buildReport(file));
