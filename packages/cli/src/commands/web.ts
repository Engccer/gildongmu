import { defineCommand } from "citty";
import { runEndpoint, sharedArgs } from "./shared.js";

/** 웹 검색(Perplexity) — 카탈로그 단순 위임 명령. */
export const webCommand = defineCommand({
  meta: { name: "web", description: "웹 검색(Perplexity)" },
  args: {
    query: { type: "positional", description: "검색어", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    await runEndpoint("web-search", { query: args.query }, args.output);
  },
});
