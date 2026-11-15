/**
 * 저장된 A/B 결과 JSON을 리포트로 다시 낸다(재판정·문서 옮길 때).
 * 실행: `npm run eval:ab:report -- .ab-out/<파일>.json` (Node 타입 스트리핑, 의존성 0. `.mts`라 ESM 경고 없음)
 *
 * `--rescore`: 채점기(`grounding.ts`)를 고친 뒤 실호출 없이 날조 축을 다시 채점한다. 결과에 남긴 도구 반환 원문
 * (`toolOutputs`)과 답 글로 `checks.grounding`만 새로 계산하고, 판정이 바뀐 실행을 stderr에 적는다.
 * `--write <경로>`를 함께 주면 재채점한 결과 파일을 그 경로에 쓴다(원본은 건드리지 않는다).
 */
import fs from "node:fs";
// @ts-expect-error 노드 타입 스트리핑은 상대 import에 .ts 확장자가 필수이고 tsc는 그것을 금지한다 — 런타임이 정본.
import { buildReport, instructionKey, type ResultFile } from "./report.ts";
// @ts-expect-error 위와 같다.
import { scoreGrounding, type ToolOutput } from "./grounding.ts";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--write");
const rescore = args.includes("--rescore");
const writeAt = args.indexOf("--write");
const writePath = writeAt >= 0 ? args[writeAt + 1] : undefined;
if (!target) {
  console.error("사용법: npm run eval:ab:report -- <결과.json> [--rescore [--write <재채점 결과.json>]]");
  process.exit(2);
}
const file = JSON.parse(fs.readFileSync(target, "utf8")) as ResultFile;
if (!file.run || !Array.isArray(file.results)) {
  console.error("결과 파일 계약(run·cases·results) 밖의 파일이다 — 2026-08-25 이전 원시 결과는 이 리포트를 못 낸다.");
  process.exit(1);
}

if (rescore) {
  let changed = 0;
  // 지침 원문이 없는 파일(2026-11-14 이전 형식)은 지침 문구 면제 없이 채점한다 — 그 사실을 알린다.
  if (!file.run.instructions) console.error("run.instructions 없음 — 지침 문구 대조 없이 재채점한다");
  for (const r of file.results) {
    const c = file.cases.find((x) => x.id === r.caseId);
    const outputs = (r as { toolOutputs?: ToolOutput[] }).toolOutputs;
    if (!c?.grounding || !r.ok || !outputs) continue;
    // 실행기(`model-ab.spec.ts` `checksOf`)와 같은 인자: 장소 앵커 이름과 사용자 발화는 도구 밖에서 이미 주어진 문자열이다.
    const place = (c.context as { place?: { name?: string; category?: string } } | undefined)?.place;
    const instruction = file.run.instructions?.[instructionKey(place)] ?? "";
    const next = scoreGrounding(c.grounding, outputs, r.text, [place?.name ?? "", ...c.turns], instruction);
    const before = r.checks.grounding;
    if (before && (before.pass !== next.pass || before.leaked.join("|") !== next.leaked.join("|"))) {
      changed++;
      console.error(`재채점 ${r.caseId} ${r.model} rep${r.rep}: [${before.leaked.join(", ")}] → [${next.leaked.join(", ")}]`);
    }
    r.checks.grounding = next;
  }
  console.error(`재채점으로 바뀐 실행 ${changed}건`);
  if (writePath) fs.writeFileSync(writePath, JSON.stringify(file, null, 2));
}
console.log(buildReport(file));
