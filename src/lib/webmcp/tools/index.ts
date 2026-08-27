/**
 * 도구 목록 정본은 `../manifest.ts`다(W2 spec §5.1). 여기서는 re-export만 — 이 밖에서
 * `registerTool`에 넘길 도구를 만들지 않는다.
 */
export { buildAppTools, manifest, TOOL_NAMES, type ToolGates, type ToolName } from "../manifest";
