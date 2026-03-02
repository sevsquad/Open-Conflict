// ════════════════════════════════════════════════════════════════
// PRESETS — Pre-built scenarios for quick simulation testing
// ════════════════════════════════════════════════════════════════

let presetCounter = 0;
function uid() { return `unit_preset_${++presetCounter}`; }

/**
 * "Contested River Crossing" — Uses the 12x15 test fixture terrain.
 * Blue Force attacks east-to-west to secure the Stonebrook river crossing.
 * Red Force defends west of the river.
 * ~6 units per side, mixed types.
 */
export function getQuickstartPreset() {
  presetCounter = 0; // reset for deterministic IDs

  return {
    // Scenario fields
    title: "Contested River Crossing",
    description: "Blue Force must secure the bridge over Stonebrook River (col 3, row 4) and establish a bridgehead on the western bank. Red Force defends the crossing and surrounding approaches.",
    initialConditions: "Dawn. Visibility moderate. Both forces are at full readiness. The Stonebrook bridge at Ashbury is the only viable heavy vehicle crossing point. Red Force has had 24 hours to prepare defensive positions west of the river.",
    specialRules: "The bridge can be destroyed by either side (artillery or demolition). If destroyed, only infantry can ford the river at reduced speed. Urban areas (Ashbury, Hexville) provide defensive bonuses.",
    turnDuration: "4 hours",
    startDate: "2024-06-15",

    // Actors
    actors: [
      {
        id: "actor_1",
        name: "Blue Force",
        controller: "player",
        objectives: ["Secure the Stonebrook bridge at grid 3,4", "Establish a bridgehead west of the river", "Neutralize Red Force artillery positions"],
        constraints: ["Minimize civilian casualties in Ashbury and Hexville", "Bridge capture preferred over destruction"],
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: ["Deny Blue Force access to the western bank", "Hold defensive line along the Stonebrook", "Preserve combat strength for counterattack"],
        constraints: ["Bridge destruction is a last resort only", "Do not withdraw past column 1"],
      },
    ],

    // Units — Blue Force (east side, cols 7-11)
    // Units — Red Force (west side, cols 0-4)
    units: [
      // ── Blue Force ──
      { id: uid(), actor: "actor_1", name: "1st Recon (Shadow)", type: "recon", position: "7,3", strength: 100, supply: 100, status: "ready", notes: "Forward screening element" },
      { id: uid(), actor: "actor_1", name: "Alpha Company", type: "infantry", position: "8,4", strength: 100, supply: 100, status: "ready", notes: "Main assault infantry" },
      { id: uid(), actor: "actor_1", name: "Bravo Company", type: "infantry", position: "9,5", strength: 100, supply: 100, status: "ready", notes: "Supporting infantry" },
      { id: uid(), actor: "actor_1", name: "1st Armor (Steel)", type: "armor", position: "9,3", strength: 100, supply: 100, status: "ready", notes: "Exploitation force" },
      { id: uid(), actor: "actor_1", name: "Thunder Battery", type: "artillery", position: "11,6", strength: 100, supply: 100, status: "ready", notes: "Fire support from tree cover" },
      { id: uid(), actor: "actor_1", name: "Blue HQ (Citadel)", type: "headquarters", position: "10,7", strength: 100, supply: 100, status: "ready", notes: "Command post near Camp Ironwood" },

      // ── Red Force ──
      { id: uid(), actor: "actor_2", name: "Viper Recon", type: "recon", position: "4,3", strength: 100, supply: 100, status: "ready", notes: "Forward observation east of river" },
      { id: uid(), actor: "actor_2", name: "Red Guard Platoon", type: "infantry", position: "2,4", strength: 100, supply: 100, status: "ready", notes: "Primary river defense" },
      { id: uid(), actor: "actor_2", name: "Sentinel Platoon", type: "infantry", position: "2,6", strength: 100, supply: 100, status: "ready", notes: "Forest defense line" },
      { id: uid(), actor: "actor_2", name: "Iron Fist Troop", type: "armor", position: "1,5", strength: 100, supply: 100, status: "ready", notes: "Counterattack reserve" },
      { id: uid(), actor: "actor_2", name: "Hammer Battery", type: "artillery", position: "1,8", strength: 100, supply: 100, status: "ready", notes: "Indirect fire from jungle hills" },
      { id: uid(), actor: "actor_2", name: "Red HQ (Bastion)", type: "headquarters", position: "0,6", strength: 100, supply: 100, status: "ready", notes: "Command post" },
    ],
  };
}
