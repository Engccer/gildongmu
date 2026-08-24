import { defineCommand, runMain } from "citty";
import { searchCommand } from "./commands/search.js";
import { webCommand } from "./commands/web.js";
import { nearbyCommand } from "./commands/nearby.js";
import { stationCommand } from "./commands/station.js";
import { busCommand } from "./commands/bus.js";
import { placeCommand } from "./commands/place.js";
import { routeCommand } from "./commands/route.js";
import { weatherCommand, airCommand } from "./commands/env.js";
import { whereamiCommand } from "./commands/whereami.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";
import { completionCommand } from "./commands/completion.js";

const main = defineCommand({
  // ⚠ package.json version과 동조 필수(version-drift.test.ts가 강제). 릴리스 때 함께 올린다.
  meta: { name: "gildongmu", version: "0.9.0", description: "길동무: 접근성 우선 대한민국 길찾기 CLI" },
  subCommands: {
    search: searchCommand,
    web: webCommand,
    nearby: nearbyCommand,
    station: stationCommand,
    bus: busCommand,
    place: placeCommand,
    route: routeCommand,
    weather: weatherCommand,
    air: airCommand,
    whereami: whereamiCommand,
    chat: chatCommand,
    config: configCommand,
    completion: completionCommand,
  },
});

runMain(main);
