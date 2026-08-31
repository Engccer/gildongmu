import { defineCommand } from "citty";
import { runEndpoint, sharedArgs } from "./shared.js";

/** 무장애 관광지 편의시설 상세 — nearby barrier-free 결과의 contentId로 조회. */
const barrierFreeCommand = defineCommand({
  meta: { name: "barrier-free", description: "무장애 관광지 편의시설 상세" },
  args: {
    contentId: { type: "positional", description: "콘텐츠 ID(nearby barrier-free 결과)", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    await runEndpoint("barrier-free-detail", { contentId: args.contentId }, args.output, undefined);
  },
});

export const placeCommand = defineCommand({
  meta: { name: "place", description: "장소 상세 조회" },
  subCommands: { "barrier-free": barrierFreeCommand },
});
