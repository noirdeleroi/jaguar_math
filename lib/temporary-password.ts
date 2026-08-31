import "server-only";
import { randomInt } from "crypto";

const words = ["Amber", "Bamboo", "Canyon", "Cedar", "Comet", "Coral", "Dawn", "Ember", "Falcon", "Fern", "Harbor", "Indigo", "Iris", "Jaguar", "Juniper", "Lagoon", "Maple", "Meadow", "Meteor", "Nimbus", "Oak", "Orchid", "Otter", "Pebble", "Puma", "Quartz", "Raven", "River", "Saffron", "Sequoia", "Sky", "Solstice", "Spruce", "Starling", "Summit", "Tango", "Thistle", "Topaz", "Vale", "Velvet", "Willow", "Zephyr"];

export function createTemporaryPassword(used = new Set<string>()) {
  let candidate = "";
  do {
    const phrase = Array.from({ length: 3 }, () => words[randomInt(words.length)]).join("-");
    candidate = `${phrase}-${randomInt(10_000).toString().padStart(4, "0")}!`;
  } while (used.has(candidate));
  used.add(candidate); return candidate;
}
