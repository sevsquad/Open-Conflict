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
    requiresUnitTypes: null, requiresWeather: null, positive: true, revealsDetection: true,
    template: "{actor}'s signals intelligence unit intercepts enemy radio traffic, providing intelligence on enemy forces in their area of observation." },

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
    requiresUnitTypes: null, requiresWeather: null, positive: true, revealsDetection: true,
    template: "Enemy deserters/prisoners provide {actor} with intelligence about nearby opposing forces they are aware of." },

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
    template: "{actor}'s forces observe what appears to be an enemy coordination failure or blunder among detected enemy units, creating a brief window of opportunity." },

  // ── Detection-Granting Events (FOW mechanic) ──
  { id: "civilian_tip", tiers: [1, 4], category: "intelligence", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true, revealsDetection: true,
    template: "Local civilians report enemy military activity to {actor}'s forces, revealing the location of a previously unknown enemy unit." },
  { id: "signals_intercept", tiers: [3, 6], category: "intelligence", severity: "moderate",
    requiresUnitTypes: null, requiresWeather: null, positive: true, revealsDetection: true,
    template: "{actor}'s electronic warfare assets intercept enemy communications, pinpointing the location and identity of an enemy formation." },
  { id: "aerial_observation", tiers: [2, 5], category: "intelligence", severity: "moderate",
    requiresUnitTypes: ["air", "recon"], requiresWeather: ["clear", "overcast"], positive: true, revealsDetection: true,
    template: "{actor}'s aerial reconnaissance spots enemy forces that were previously concealed, upgrading detection to full identification." },

  // ── Air Operations ──
  { id: "cas_fratricide_risk", tiers: [3, 5], category: "air_operations", severity: "major",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "{actor}'s close air support mission has a near-miss with friendly ground forces. CAS effectiveness is degraded this turn as pilots widen safety margins." },
  { id: "aircraft_mechanical_abort", tiers: [3, 6], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "An aircraft in {actor}'s formation suffers a mechanical failure and must abort the mission. Sortie readiness takes a hit." },
  { id: "pilot_exceptional_skill", tiers: [3, 5], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: true,
    template: "A pilot in {actor}'s air element demonstrates exceptional airmanship, significantly improving the mission outcome beyond what was expected." },
  { id: "ad_radar_malfunction", tiers: [3, 5], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air_defense"], requiresWeather: null, positive: true,
    template: "An enemy radar-guided AD system suffers a critical malfunction, creating a temporary gap in air defense coverage that {actor}'s air assets can exploit." },
  { id: "weather_window", tiers: [3, 6], category: "air_operations", severity: "minor",
    requiresUnitTypes: ["air"], requiresWeather: ["overcast", "storm"], positive: true,
    template: "A brief clearing in the weather gives {actor}'s air assets an unexpected window for operations this turn." },
  { id: "airfield_attack", tiers: [4, 6], category: "air_operations", severity: "major",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "Enemy strike aircraft or missiles hit {actor}'s airfield. Runway damage and destroyed ground equipment reduce sortie capacity this turn." },
  { id: "drone_feed_intelligence", tiers: [3, 6], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air"], requiresWeather: ["clear", "overcast"], positive: true, revealsDetection: true,
    template: "{actor}'s drone/UAS feed reveals previously undetected enemy positions, providing real-time intelligence on enemy dispositions." },
  { id: "sam_ambush", tiers: [3, 5], category: "air_operations", severity: "major",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "A concealed enemy SAM site fires on {actor}'s aircraft without warning. The air element must take evasive action, disrupting the planned mission." },
  { id: "mid_air_refueling", tiers: [4, 6], category: "air_operations", severity: "minor",
    requiresUnitTypes: ["air"], requiresWeather: ["clear", "overcast"], positive: true,
    template: "{actor}'s tanker support enables aerial refueling, extending mission range and allowing strikes against otherwise-unreachable targets this turn." },
  { id: "electronic_interference", tiers: [4, 6], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "Enemy electronic warfare degrades {actor}'s precision-guided munition accuracy and disrupts air-ground communications, reducing CAS effectiveness." },
  { id: "ordnance_malfunction", tiers: [3, 5], category: "air_operations", severity: "moderate",
    requiresUnitTypes: ["air"], requiresWeather: null, positive: false,
    template: "Weapons aboard {actor}'s strike aircraft fail to release or guide properly. The strike mission achieves reduced effect." },
  { id: "balloon_shoot_down", tiers: [3, 4], category: "air_operations", severity: "major",
    requiresUnitTypes: ["air"], requiresWeather: ["clear", "overcast"], positive: false,
    template: "An enemy fighter attacks {actor}'s observation balloon. The balloon is destroyed and the observer's intelligence contribution is lost." },
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

  // Determine count: 1d6 → 1-3=one, 4-5=two, 6=three
  // Reduced from original (1-2=one, 3-5=two, 6=three) because fortune rolls
  // already inject ~30% negative outcomes per unit — stacking friction on top
  // created too many "things going wrong" per turn.
  const countRoll = roll1d6();
  const targetCount = countRoll <= 3 ? 1 : countRoll <= 5 ? 2 : 3;
  const count = Math.min(targetCount, eligible.length);

  // Separate positive and negative events
  const negatives = eligible.filter(e => !e.positive);
  const positives = eligible.filter(e => e.positive);

  const selected = [];
  const usedIds = new Set();

  // Pick first event randomly (no longer guaranteeing negative — let the dice decide)
  if (eligible.length > 0) {
    const first = pickRandom(eligible);
    selected.push(first);
    usedIds.add(first.id);
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
      revealsDetection: evt.revealsDetection || false,
    };
  });

  return { events };
}

// ── Per-Unit Friction Assignment ──────────────────────────────

/**
 * Generate per-unit friction events. Each active unit has a 1-in-6 chance
 * of getting a friction event. Events are filtered to be relevant to
 * that specific unit's type.
 *
 * Some events remain actor-global (weather, political). These are returned
 * separately.
 *
 * @param {Object} gameState - Current game state
 * @param {number} scaleTier - Current scale tier number
 * @param {Object} allOrders - { actorId: { unitId: { movementOrder, actionOrder } } }
 * @param {Set} recentEventIds - event IDs used in last 2-3 turns (for dedup)
 * @returns {{ unitEvents: Object, globalEvents: Array }}
 *   unitEvents: { unitId: { id, text, severity, category, positive } }
 *   globalEvents: [{ id, text, severity, category, positive, affectedActor }]
 */
export function generateUnitFrictionEvents(gameState, scaleTier, allOrders = {}, recentEventIds = new Set()) {
  const actors = gameState.scenario?.actors || [];
  const units = gameState.units || [];
  const weather = gameState.environment?.weather || "clear";

  // Global event categories — these affect entire actors, not specific units
  const GLOBAL_CATEGORIES = new Set(["weather", "political"]);

  // Filter eligible events for this game state
  const allEligible = FRICTION_TABLE.filter(evt => {
    if (scaleTier < evt.tiers[0] || scaleTier > evt.tiers[1]) return false;
    if (evt.requiresWeather && !evt.requiresWeather.includes(weather)) return false;
    // Exclude events used in recent turns to prevent repetition
    if (recentEventIds.has(evt.id)) return false;
    return true;
  });

  const globalEligible = allEligible.filter(e => GLOBAL_CATEGORIES.has(e.category));
  const unitEligible = allEligible.filter(e => !GLOBAL_CATEGORIES.has(e.category));

  const unitEvents = {};
  const usedIds = new Set();

  // Per-unit friction: 1-in-6 chance for each active unit
  for (const unit of units) {
    const actorOrders = allOrders[unit.actor];
    const unitOrders = actorOrders?.[unit.id];
    const hasOrders = unitOrders?.movementOrder || unitOrders?.actionOrder;
    if (!hasOrders) continue; // HOLD units don't get friction

    // 1-in-10 chance per active unit (reduced from 1-in-6 to avoid
    // stacking with fortune rolls which already inject negative outcomes)
    if (Math.floor(Math.random() * 10) !== 0) continue;

    // Filter to events relevant to this unit's type
    const relevantEvents = unitEligible.filter(evt => {
      if (usedIds.has(evt.id)) return false;
      if (evt.requiresUnitTypes && !evt.requiresUnitTypes.includes(unit.type)) return false;
      return true;
    });

    if (relevantEvents.length === 0) continue;

    const evt = pickRandom(relevantEvents);
    usedIds.add(evt.id);

    const actorName = actors.find(a => a.id === unit.actor)?.name || unit.actor;
    const text = evt.template
      .replace(/\{actor\}/g, actorName)
      .replace(/\{unit\}/g, unit.name);

    unitEvents[unit.id] = {
      id: evt.id,
      text,
      severity: evt.severity,
      category: evt.category,
      positive: evt.positive,
    };
  }

  // Global friction: one roll for the whole turn, 1-in-6 chance
  // (reduced from 1-in-3 to reduce friction-fortune overlap)
  const globalEvents = [];
  if (globalEligible.length > 0 && roll1d6() === 1) {
    const pool = globalEligible.filter(e => !usedIds.has(e.id));
    if (pool.length > 0) {
      const evt = pickRandom(pool);
      const affectedActor = actors.length > 0 ? pickRandom(actors).id : null;
      const actorName = actors.find(a => a.id === affectedActor)?.name || "unknown";
      const text = evt.template
        .replace(/\{actor\}/g, actorName)
        .replace(/\{unit\}/g, "a forward unit");

      globalEvents.push({
        id: evt.id,
        text,
        severity: evt.severity,
        category: evt.category,
        positive: evt.positive,
        affectedActor,
      });
    }
  }

  return { unitEvents, globalEvents };
}


// ── Detection-Granting Mechanic ──────────────────────────────

/**
 * When a friction event with revealsDetection:true fires, pick an
 * undetected enemy unit to reveal at Identified tier.
 *
 * Priority: Contact-tier enemies first (upgrade to Identified),
 * then fully undetected enemies. Prefers enemies closer to the
 * affected actor's units.
 *
 * @param {string} actorId - the actor gaining intel
 * @param {Object} gameState - current game state
 * @param {Object|null} visibilityState - from computeDetection()
 * @returns {{ revealedUnitId: string|null, revealedUnit: Object|null }}
 */
export function pickUnitToReveal(actorId, gameState, visibilityState) {
  const actorVis = visibilityState?.actorVisibility?.[actorId];
  const allUnits = gameState.units || [];

  // Enemies not owned by this actor
  const enemies = allUnits.filter(u =>
    u.actor !== actorId &&
    u.status !== "destroyed" &&
    u.status !== "eliminated"
  );

  if (enemies.length === 0) return { revealedUnitId: null, revealedUnit: null };

  const detectedSet = actorVis?.detectedUnits || new Set();
  const contactSet = actorVis?.contactUnits || new Set();

  // Contact-tier enemies (upgrade to Identified)
  const contacts = enemies.filter(u => contactSet.has(u.id) && !detectedSet.has(u.id));
  // Fully undetected enemies
  const undetected = enemies.filter(u => !detectedSet.has(u.id) && !contactSet.has(u.id));

  // Prefer contacts first (they already have partial info), then undetected
  const pool = contacts.length > 0 ? contacts : undetected;
  if (pool.length === 0) return { revealedUnitId: null, revealedUnit: null };

  // Pick randomly from the pool
  const revealed = pool[Math.floor(Math.random() * pool.length)];
  return { revealedUnitId: revealed.id, revealedUnit: revealed };
}


/**
 * Apply detection reveals from friction events to the visibility state.
 * Call this after generating friction events, before adjudication.
 *
 * @param {Array} frictionEvents - generated friction events (with revealsDetection flag)
 * @param {Object} gameState
 * @param {Object} visibilityState - mutable — will be modified in place
 * @returns {Array<{actorId, unitId, unitName, eventId}>} list of reveals for prompt injection
 */
export function applyDetectionReveals(frictionEvents, gameState, visibilityState) {
  const reveals = [];

  for (const evt of frictionEvents) {
    if (!evt.revealsDetection || !evt.affectedActor) continue;

    const { revealedUnitId, revealedUnit } = pickUnitToReveal(
      evt.affectedActor, gameState, visibilityState
    );

    if (!revealedUnitId) continue;

    // Upgrade to Identified tier in visibility state
    const actorVis = visibilityState?.actorVisibility?.[evt.affectedActor];
    if (actorVis) {
      if (!actorVis.detectedUnits) actorVis.detectedUnits = new Set();
      actorVis.detectedUnits.add(revealedUnitId);
      // Remove from contact tier if present (now fully identified)
      if (actorVis.contactUnits) actorVis.contactUnits.delete(revealedUnitId);
    }

    reveals.push({
      actorId: evt.affectedActor,
      unitId: revealedUnitId,
      unitName: revealedUnit.name,
      eventId: evt.id,
      eventText: evt.text,
    });
  }

  return reveals;
}
