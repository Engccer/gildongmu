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
  meta: { name: "gildongmu", version: "0.5.0", description: "길동무: 접근성 우선 대한민국 길찾기 CLI" },
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
