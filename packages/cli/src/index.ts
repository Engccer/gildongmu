import { defineCommand, runMain } from "citty";
import { searchCommand } from "./commands/search.js";
import { webCommand } from "./commands/web.js";

const main = defineCommand({
  meta: { name: "gildongmu", version: "0.1.0", description: "길동무 — 접근성 우선 대한민국 길찾기 CLI" },
  subCommands: {
    search: searchCommand,
    web: webCommand,
  }, // 이후 태스크에서 나머지 명령을 채운다
});

runMain(main);
