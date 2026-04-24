import { buildScenario, runMatch } from "./rtsHarness.mjs";
import { getHeloInsertionPreset } from "../src/simulation/presets.js";
import { getTestFixture } from "../src/testFixture.js";

const terrainData = getTestFixture();

const heloScenario = buildScenario(getHeloInsertionPreset(), {
  seed: 7719,
  actorOverride: () => ({ controller: "player", isAi: false }),
  rtsOptions: { objectiveHoldSeconds: 60 },
});
heloScenario.victoryConditions = {
  ...(heloScenario.victoryConditions || {}),
  vpGoal: 999,
};

const heloSchedule = [
  { tick: 0, kind: "embark_helo", unitNames: ["Air Assault Infantry"], targetUnitName: "Falcon Lift 1", targetHex: "10,8" },
  { tick: 1, kind: "move", unitNames: ["Falcon Lift 1"], targetHex: "7,4" },
  { tick: 1, kind: "attack_move", unitNames: ["Viper Gunship"], targetHex: "7,5", targetUnitName: "Shilka Section" },
  { tick: 200, kind: "disembark_helo", unitNames: ["Falcon Lift 1"], targetHex: "8,5" },
];

const run = runMatch({ scenario: heloScenario, terrainData, seed: 7719, totalTicks: 260, schedule: heloSchedule });

const events = run.state.replay?.events || run.state.truthState?.eventLog || [];
const relevant = events.filter((e) => {
  const m = (e.message || "").toLowerCase();
  return m.includes("helo") || m.includes("embark") || m.includes("disembark")
    || m.includes("helicopter") || m.includes("falcon") || m.includes("viper")
    || m.includes("shilka") || m.includes("air assault")
    || m.includes("engaged") || m.includes("destroyed") || m.includes("withdraw");
});

console.log("Total events:", events.length);
console.log("Relevant events:", relevant.length);
for (const e of relevant) {
  console.log(`[${e.type || "?"}] tick=${e.tick ?? e.atMs ?? "?"} ${e.message}`);
}

const transport = run.state.units.find((u) => u.name === "Falcon Lift 1");
const gunship = run.state.units.find((u) => u.name === "Viper Gunship");
const infantry = run.state.units.find((u) => u.name === "Air Assault Infantry");
const shilka = run.state.units.find((u) => u.name === "Shilka Section");

console.log("\nFinal unit states:");
for (const u of [transport, gunship, infantry, shilka]) {
  if (!u) continue;
  console.log(`  ${u.name}: pos=${u.position} strength=${u.strength} alive=${u.strength > 0} embarkedIn=${u.embarkedIn || "-"} destroyed=${u.destroyed || false}`);
}
