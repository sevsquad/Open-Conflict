// ═══════════════════════════════════════════════════════════════
// FRICTION EVENTS — Curated Clausewitzian complications
// Pre-adjudication random events the LLM must incorporate.
// Filtered by scale tier, unit types present, and weather.
// ═══════════════════════════════════════════════════════════════

// Each entry: { id, tiers:[min,max], category, severity, requiresUnitTypes, requiresWeather,
//               positive, template, templateVars }
// Template placeholders: {actor}, {unit}, {duration}, {location}

const FRICTION_TABLE = [
  // ── Communications ──
  { id: "comms_intermittent", tiers: [1, 4], category: "communications", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s communications experience intermittent disruptions, causing delays in coordinating fire support and movement orders." },
  { id: "comms_total_failure", tiers: [1, 3], category: "communications", severity: "major",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s primary radio net goes down completely. Units must rely on runners and visual signals until repairs are made." },
  { id: "comms_encryption_issue", tiers: [3, 5], category: "communications", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s encrypted communications system has a key synchronization failure. Sensitive traffic is delayed while units revert to backup codes." },
  { id: "comms_intercept", tiers: [2, 5], category: "communications", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "{actor}'s signals intelligence unit intercepts enemy radio traffic, revealing the general disposition of opposing forces." },

  // ── Equipment ──
  { id: "vehicle_breakdown", tiers: [2, 4], category: "equipment", severity: "minor",
    requiresUnitTypes: ["armor", "mechanized"], requiresWeather: null, positive: false,
    template: "A key vehicle in {actor}'s formation throws a track / suffers engine failure, briefly blocking a road and causing a traffic jam in the column." },
  { id: "weapon_malfunction", tiers: [1, 3], category: "equipment", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A crew-served weapon in {actor}'s forward element malfunctions at a critical moment, reducing suppressive fire capability until cleared." },
  { id: "artillery_calibration", tiers: [2, 4], category: "equipment", severity: "moderate",
    requiresUnitTypes: ["artillery"], requiresWeather: null, positive: false,
    template: "{actor}'s artillery battery discovers a calibration error after the first fire mission. Accuracy is degraded until corrections are applied." },
  { id: "sensor_malfunction", tiers: [3, 5], category: "equipment", severity: "minor",
    requiresUnitTypes: ["recon", "air_defense"], requiresWeather: null, positive: false,
    template: "{actor}'s surveillance/sensor equipment suffers intermittent failures, creating gaps in the reconnaissance picture." },
  { id: "engineering_success", tiers: [2, 4], category: "equipment", severity: "moderate",
    requiresUnitTypes: ["engineer"], requiresWeather: null, positive: true,
    template: "{actor}'s engineer element completes a task ahead of schedule, opening a route or clearing an obstacle faster than expected." },

  // ── Personnel ──
  { id: "leader_casualty", tiers: [1, 3], category: "personnel", severity: "major",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A key leader in {actor}'s forward unit is wounded or incapacitated. The next-in-command takes over but initial orders are muddled during the transition." },
  { id: "unit_hesitation", tiers: [1, 3], category: "personnel", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A forward element of {actor} hesitates under fire, losing momentum. The unit recovers but the delay costs time." },
  { id: "exceptional_initiative", tiers: [1, 3], category: "personnel", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "A junior leader in {actor}'s force shows exceptional initiative, exploiting a local opportunity that was not part of the original plan." },
  { id: "deserters_intel", tiers: [2, 5], category: "personnel", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "Enemy deserters/prisoners provide {actor} with useful intelligence about opposing force dispositions and morale." },

  // ── Logistics ──
  { id: "supply_delay", tiers: [3, 6], category: "logistics", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s supply convoy is delayed by road congestion and traffic control problems. Resupply for forward units arrives late." },
  { id: "supply_ambush", tiers: [3, 5], category: "logistics", severity: "major",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s supply convoy is ambushed or interdicted en route. A significant portion of this turn's resupply is lost." },
  { id: "fuel_contamination", tiers: [2, 4], category: "logistics", severity: "moderate",
    requiresUnitTypes: ["armor", "mechanized"], requiresWeather: null, positive: false,
    template: "{actor} discovers contaminated fuel in a forward supply point. Affected vehicles must be drained and refueled, causing delays." },
  { id: "captured_supplies", tiers: [2, 5], category: "logistics", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "{actor} discovers an abandoned/captured enemy supply cache containing useful materiel." },
  { id: "medical_overload", tiers: [2, 4], category: "logistics", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s medical evacuation system is strained. Casualty collection is slower than expected, affecting unit morale." },

  // ── Intelligence ──
  { id: "false_intel", tiers: [2, 5], category: "intelligence", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor} receives a false intelligence report suggesting enemy activity where there is none, potentially diverting attention from the real threat." },
  { id: "recon_failure", tiers: [1, 4], category: "intelligence", severity: "minor",
    requiresUnitTypes: ["recon"], requiresWeather: null, positive: false,
    template: "{actor}'s reconnaissance element is detected and forced to withdraw before completing its mission. The intel picture has a gap." },
  { id: "enemy_deception", tiers: [3, 6], category: "intelligence", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "Evidence suggests the enemy is running a deception operation. {actor}'s intelligence assessment of enemy intentions has reduced reliability." },

  // ── Weather / Terrain ──
  { id: "fog_bank", tiers: [1, 4], category: "weather", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "An unexpected fog bank rolls in, reducing visibility across part of the area of operations. Movement and targeting are affected." },
  { id: "terrain_worse", tiers: [1, 4], category: "weather", severity: "minor",
    requiresUnitTypes: null, requiresWeather: ["rain", "storm"], positive: false,
    template: "Heavy precipitation makes ground conditions worse than expected. Movement through low-lying areas is significantly impeded." },
  { id: "terrain_better", tiers: [1, 4], category: "weather", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "Ground conditions in the area of operations are firmer than expected, allowing faster cross-country movement this turn." },
  { id: "river_flooding", tiers: [2, 5], category: "weather", severity: "major",
    requiresUnitTypes: null, requiresWeather: ["rain", "storm"], positive: false,
    template: "Recent rainfall has caused river levels to rise significantly. Fording points are impassable and bridge approaches are muddier than expected." },
  { id: "wind_shift", tiers: [1, 3], category: "weather", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A sudden wind shift affects smoke screens and obscurants, potentially exposing units that were relying on concealment." },

  // ── Political (tier 4+ only) ──
  { id: "political_pressure", tiers: [4, 6], category: "political", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "{actor}'s political leadership imposes additional constraints or urgency on military operations this turn due to domestic political pressure." },
  { id: "media_exposure", tiers: [4, 6], category: "political", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "Media coverage of {actor}'s operations creates public pressure, potentially constraining future actions involving civilian areas." },
  { id: "allied_support", tiers: [4, 6], category: "political", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "An allied nation provides unexpected diplomatic or material support to {actor}, improving the strategic position." },
  { id: "civilian_interference", tiers: [2, 5], category: "political", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "Civilian traffic or refugee movement interferes with {actor}'s military operations, slowing movement along key routes." },

  // ── Miscellaneous ──
  { id: "friendly_fire_risk", tiers: [1, 4], category: "personnel", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A coordination error creates a friendly fire risk for {actor}. Units must pause to deconflict, costing time." },
  { id: "navigation_error", tiers: [1, 3], category: "personnel", severity: "minor",
    requiresUnitTypes: null, requiresWeather: null, positive: false,
    template: "A unit in {actor}'s force makes a navigation error and arrives at the wrong location, requiring correction." },
  { id: "enemy_blunder", tiers: [2, 5], category: "intelligence", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true,
    template: "{actor}'s forces observe what appears to be an enemy coordination failure or blunder, creating a brief window of opportunity." },
];

// ── Selection logic ──

function roll1d6() {
  return Math.floor(Math.random() * 6) + 1;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate 1-3 friction events filtered by game state.
 * @param {Object} gameState - Current game state
 * @param {number} scaleTier - Current scale tier number
 * @returns {{ events: Array }}
 */
export function generateFrictionEvents(gameState, scaleTier) {
  const actors = gameState.scenario?.actors || [];
  const units = gameState.units || [];
  const weather = gameState.environment?.weather || "clear";

  // Collect all unit types present across all actors
  const unitTypesPresent = new Set(units.map(u => u.type));

  // Filter the table to events valid for this game state
  const eligible = FRICTION_TABLE.filter(evt => {
    // Tier range check
    if (scaleTier < evt.tiers[0] || scaleTier > evt.tiers[1]) return false;
    // Unit type requirement
    if (evt.requiresUnitTypes) {
      const hasType = evt.requiresUnitTypes.some(t => unitTypesPresent.has(t));
      if (!hasType) return false;
    }
    // Weather requirement
    if (evt.requiresWeather) {
      if (!evt.requiresWeather.includes(weather)) return false;
    }
    return true;
  });

  if (eligible.length === 0) return { events: [] };

  // Determine count: 1d6 → 1-2=one, 3-5=two, 6=three
  const countRoll = roll1d6();
  const targetCount = countRoll <= 2 ? 1 : countRoll <= 5 ? 2 : 3;
  const count = Math.min(targetCount, eligible.length);

  // Separate positive and negative events
  const negatives = eligible.filter(e => !e.positive);
  const positives = eligible.filter(e => e.positive);

  const selected = [];
  const usedIds = new Set();

  // Ensure at least one negative event
  if (negatives.length > 0) {
    const neg = pickRandom(negatives);
    selected.push(neg);
    usedIds.add(neg.id);
  }

  // Fill remaining slots
  while (selected.length < count) {
    // Allow at most one positive event
    const positiveAlreadyPicked = selected.some(e => e.positive);
    const pool = eligible.filter(e => !usedIds.has(e.id) && (!e.positive || !positiveAlreadyPicked));
    if (pool.length === 0) break;
    const pick = pickRandom(pool);
    selected.push(pick);
    usedIds.add(pick.id);
  }

  // Fill templates and assign affected actors
  const events = selected.map(evt => {
    const affectedActor = actors.length > 0 ? pickRandom(actors).id : null;
    const actorName = actors.find(a => a.id === affectedActor)?.name || affectedActor || "unknown";

    // Pick a relevant unit name for {unit} placeholder if needed
    const actorUnits = units.filter(u => u.actor === affectedActor);
    const unitName = actorUnits.length > 0 ? pickRandom(actorUnits).name : "a forward unit";

    let text = evt.template
      .replace(/\{actor\}/g, actorName)
      .replace(/\{unit\}/g, unitName);

    return {
      id: evt.id,
      text,
      severity: evt.severity,
      category: evt.category,
      positive: evt.positive,
      affectedActor,
    };
  });

  return { events };
}
