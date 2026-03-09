// ════════════════════════════════════════════════════════════════
// AIR TEST RUNNER — Executes air test scenarios through the
// adjudicator and logs structured results.
//
// Usage: import and call runAirTests(terrainData) from the browser
// console or from a React component. Requires the dev server running.
// ════════════════════════════════════════════════════════════════

import { AIR_TEST_SCENARIOS } from "./airTestScenarios.js";
export { AIR_TEST_SCENARIOS };
import { adjudicate, createGame, getProviders } from "./orchestrator.js";
import { createLogger } from "./logger.js";
import { buildTerrainSummary, positionToLabel } from "./prompts.js";
import { computeDetection } from "./detectionEngine.js";
import { simulateMovement } from "./movementSimulator.js";

// Build the human-readable playerActions text from scenario orders.
// Mirrors buildPlayerActions() in SimGame.jsx.
function buildPlayerActions(actors, orders, units) {
  const playerActions = {};
  for (const actor of actors) {
    const actorOrders = orders[actor.id];
    if (!actorOrders || Object.keys(actorOrders).length === 0) {
      playerActions[actor.id] = "HOLD all positions";
      continue;
    }
    const lines = [];
    const actorUnits = units.filter(u => u.actor === actor.id);
    for (const unit of actorUnits) {
      const uo = actorOrders[unit.id];
      if (!uo || (!uo.movementOrder && !uo.actionOrder)) {
        lines.push(`${unit.name}: HOLD`);
        continue;
      }
      const parts = [];
      if (uo.movementOrder) {
        const tgt = uo.movementOrder.target ? positionToLabel(uo.movementOrder.target) : "";
        parts.push(`${uo.movementOrder.id}${tgt ? " to " + tgt : ""}`);
      }
      if (uo.actionOrder) {
        const tgt = uo.actionOrder.target ? positionToLabel(uo.actionOrder.target) : "";
        const sub = uo.actionOrder.subtype ? ` (${uo.actionOrder.subtype})` : "";
        parts.push(`${uo.actionOrder.id}${tgt ? " at " + tgt : ""}${sub}`);
      }
      lines.push(`${unit.name}: ${parts.join(" then ")}`);
      if (uo.intent) lines.push(`  Intent: ${uo.intent}`);
    }
    playerActions[actor.id] = lines.join("\n");
  }
  return playerActions;
}


/**
 * Run all air test scenarios sequentially.
 * @param {object} terrainData — full terrain grid (from test fixture or loaded map)
 * @param {object} [opts] — options
 * @param {function} [opts.onProgress] — callback(scenarioIndex, scenarioCount, meta)
 * @param {number[]} [opts.only] — if set, only run scenarios at these indices (0-based)
 * @returns {Promise<object[]>} — array of result objects
 */
export async function runAirTests(terrainData, opts = {}) {
  const { onProgress, only } = opts;

  // Detect LLM provider — getProviders() returns { providers: [...] }
  const providerData = await getProviders();
  const providerList = providerData.providers || providerData;
  const firstProvider = Array.isArray(providerList) ? providerList[0] : null;
  if (!firstProvider) throw new Error("No LLM providers configured on server");
  // models is an array of { id, temperature } objects
  const firstModel = firstProvider.models?.[0];
  const modelId = typeof firstModel === "string" ? firstModel : firstModel?.id;
  if (!modelId) throw new Error(`No models available for provider ${firstProvider.id}`);
  const llmConfig = {
    provider: firstProvider.id,
    model: modelId,
    temperature: 0.4,
  };

  console.log(`\n${"═".repeat(70)}`);
  console.log(`AIR SYSTEM TEST SUITE`);
  console.log(`Provider: ${llmConfig.provider} / ${llmConfig.model}`);
  console.log(`Scenarios: ${AIR_TEST_SCENARIOS.length}`);
  console.log(`${"═".repeat(70)}\n`);

  const results = [];
  const scenarios = AIR_TEST_SCENARIOS.map((fn, i) => ({ fn, idx: i }))
    .filter(({ idx }) => !only || only.includes(idx));

  for (const { fn, idx } of scenarios) {
    const scenario = fn(); // invoke the factory
    const { meta, preset, orders } = scenario;

    if (onProgress) onProgress(idx, AIR_TEST_SCENARIOS.length, meta);
    console.log(`\n${"─".repeat(70)}`);
    console.log(`SCENARIO ${idx + 1}/${AIR_TEST_SCENARIOS.length}: ${meta.name}`);
    console.log(`Testing: ${meta.testing}`);
    console.log(`Expected: ${meta.expectedOutcome}`);
    console.log(`${"─".repeat(70)}`);

    try {
      // 1. Create game state from preset
      const gameState = createGame({
        scenario: preset,
        terrainRef: "air-test",
        terrainData,
        llmConfig,
      });

      // 2. Build detection context (FOW)
      const visibility = computeDetection(gameState, terrainData, null, null);

      // 3. Build sealed orders in the format SimGame uses
      const sealedOrders = {};
      for (const actor of preset.actors) {
        sealedOrders[actor.id] = {
          unitOrders: orders[actor.id] || {},
          actorIntent: "",
        };
      }

      // 4. Run movement simulation
      const simResult = simulateMovement(gameState, terrainData, sealedOrders, visibility);

      // 5. Build playerActions text
      const playerActions = buildPlayerActions(preset.actors, orders, preset.units);

      // 6. Build structured orders
      const allUnitOrders = {};
      const allActorIntents = {};
      for (const actor of preset.actors) {
        allUnitOrders[actor.id] = orders[actor.id] || {};
        allActorIntents[actor.id] = "";
      }
      const structuredOrders = { unitOrders: allUnitOrders, actorIntents: allActorIntents };

      // 7. Build detection context for prompt
      const detectionContext = visibility ? {
        actorVisibility: Object.fromEntries(
          Object.entries(visibility.actorVisibility || {}).map(([actorId, av]) => [
            actorId, {
              visibleCells: [...(av.visibleCells instanceof Set ? av.visibleCells : new Set(av.visibleCells || []))],
              detectedUnits: [...(av.detectedUnits instanceof Set ? av.detectedUnits : new Set(av.detectedUnits || []))],
              contactUnits: [...(av.contactUnits instanceof Set ? av.contactUnits : new Set(av.contactUnits || []))],
              detectionDetails: av.detectionDetails || {},
              lastKnown: av.lastKnown || {},
              movePaths: simResult?.actorMovePaths?.[actorId] ? [...simResult.actorMovePaths[actorId]] : [],
            },
          ])
        ),
        contactEvents: simResult?.contactEvents || [],
      } : null;

      // 8. Create logger
      const logger = createLogger(gameState.game.id);

      // 9. Call adjudicator
      console.log(`  → Calling adjudicator...`);
      const startTime = Date.now();
      const result = await adjudicate(gameState, playerActions, terrainData, logger, structuredOrders, detectionContext, null);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.error && !result.adjudication) {
        console.error(`  ✗ ADJUDICATION FAILED: ${result.error}`);
        results.push({
          meta,
          status: "error",
          error: result.error,
          elapsed,
        });
        continue;
      }

      // 10. Extract key results
      // adjudicate() returns { adjudication: parsedLLMResponse }.
      // The parsedLLMResponse has { adjudication: { situation_assessment, outcome_determination, state_updates } }
      // So the path is: result.adjudication.adjudication.X
      const parsed = result.adjudication;
      const adj = parsed?.adjudication || parsed;
      const narrative = adj?.outcome_determination?.narrative || "(no narrative)";
      const stateUpdates = adj?.state_updates || [];

      // Group state_updates by entity to build per-unit outcome summaries
      const updatesByUnit = {};
      for (const su of stateUpdates) {
        if (!su.entity) continue;
        if (!updatesByUnit[su.entity]) updatesByUnit[su.entity] = {};
        updatesByUnit[su.entity][su.attribute] = {
          old: su.old_value, new: su.new_value, why: su.justification,
        };
      }

      // Build outcomes from grouped updates
      const outcomes = Object.entries(updatesByUnit).map(([unitId, changes]) => {
        const unit = preset.units.find(pu => pu.id === unitId) || {};
        const newStr = changes.strength?.new;
        const oldStr = changes.strength?.old ?? unit.strength;
        const delta = newStr != null && oldStr != null ? newStr - oldStr : null;
        return {
          name: unit.name || unitId,
          actor: unit.actor,
          strengthBefore: oldStr,
          strengthAfter: newStr,
          delta,
          position: changes.position?.new,
          posture: changes.posture?.new,
          status: changes.status?.new,
          readiness: changes.readiness?.new,
          munitions: changes.munitions?.new,
        };
      });

      console.log(`  ✓ Adjudicated in ${elapsed}s`);
      console.log(`\n  NARRATIVE (excerpt):`);
      // Print first 500 chars of narrative
      const excerpt = narrative.length > 500 ? narrative.slice(0, 500) + "..." : narrative;
      console.log(`  ${excerpt.replace(/\n/g, "\n  ")}`);

      console.log(`\n  UNIT OUTCOMES:`);
      for (const o of outcomes) {
        const deltaStr = o.delta != null ? ` (${o.delta >= 0 ? "+" : ""}${o.delta})` : "";
        const airStr = o.readiness != null ? ` R:${o.readiness}% M:${o.munitions}%` : "";
        console.log(`    ${o.name}: ${o.strengthBefore}→${o.strengthAfter}${deltaStr}${airStr} [${o.status || "?"}] pos:${o.position || "?"}`);
      }

      results.push({
        meta,
        status: "ok",
        elapsed,
        narrative,
        outcomes,
        escalation: adj?.escalation,
        raw: adj,
      });

    } catch (err) {
      console.error(`  ✗ RUNTIME ERROR: ${err.message}`);
      results.push({
        meta,
        status: "error",
        error: err.message,
        stack: err.stack,
      });
    }
  }

  // Final summary
  console.log(`\n${"═".repeat(70)}`);
  console.log(`TEST SUITE COMPLETE — ${results.length} scenarios`);
  console.log(`${"═".repeat(70)}\n`);

  printResultsTable(results);

  // Auto-save results to file via server API
  try {
    const saveData = {
      results: results.map(r => {
        // r.raw is the parsed LLM response { adjudication: { ... } }
        const inner = r.raw?.adjudication || r.raw || {};
        // Group state_updates by entity for readable per-unit changes
        const unitChanges = {};
        for (const su of (inner.state_updates || [])) {
          if (!su.entity) continue;
          if (!unitChanges[su.entity]) unitChanges[su.entity] = {};
          unitChanges[su.entity][su.attribute] = {
            old: su.old_value, new: su.new_value, why: su.justification,
          };
        }
        return {
          scenario: r.meta.name,
          testing: r.meta.testing,
          expected: r.meta.expectedOutcome,
          elapsed: r.elapsed ? `${r.elapsed}s` : null,
          narrative: inner.outcome_determination?.narrative || null,
          unitChanges,
          situation: JSON.stringify(inner.situation_assessment)?.substring(0, 500),
          feasibility: JSON.stringify(inner.feasibility_analysis)?.substring(0, 500),
        };
      }),
      timestamp: new Date().toISOString(),
    };
    const filename = results.length === 1
      ? `air-test-${results[0].meta.id}.json`
      : "air-test-results.json";
    await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, data: saveData }),
    });
    console.log(`  → Results saved to saves/${filename}`);
  } catch (saveErr) {
    console.warn(`  → Could not auto-save results: ${saveErr.message}`);
  }

  return results;
}


/**
 * Print a formatted results table in the requested format:
 * Scenario / What it's testing / Adjudication / Assessment
 */
function printResultsTable(results) {
  for (const r of results) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`SCENARIO: ${r.meta.name}`);
    console.log(`TESTING: ${r.meta.testing}`);

    if (r.status === "error") {
      console.log(`ADJUDICATION: ERROR — ${r.error}`);
      console.log(`ASSESSMENT: Could not evaluate — adjudication failed.`);
      continue;
    }

    // Adjudication summary: unit damage/movement results
    const adjLines = [];
    for (const o of r.outcomes) {
      const deltaStr = o.delta != null ? ` (${o.delta >= 0 ? "+" : ""}${o.delta})` : "";
      const airStr = o.readiness != null ? ` readiness:${o.readiness}% munitions:${o.munitions}%` : "";
      adjLines.push(`  ${o.name}: strength ${o.strengthBefore}→${o.strengthAfter}${deltaStr}${airStr} [${o.status}]`);
    }
    console.log(`ADJUDICATION:\n${adjLines.join("\n")}`);

    // Assessment: compare against expected outcome
    const assessment = assessResult(r);
    console.log(`ASSESSMENT: ${assessment}`);
  }
}


/**
 * Automated assessment: compare actual outcomes against scenario expectations.
 * Returns a human-readable verdict string.
 */
function assessResult(r) {
  const { meta, outcomes } = r;
  if (!outcomes || outcomes.length === 0) return "No unit outcomes to assess.";

  const id = meta.id;

  // Find air units (by name pattern or actor)
  const blueAir = outcomes.filter(o => o.actor === "actor_1" && (o.readiness != null || o.name.match(/F-16|F-15|A-10|Spitfire|P-51|Apache|Falcon|Hawk|Viper|Eagle|C-130/i)));
  const redAir = outcomes.filter(o => o.actor === "actor_2" && (o.readiness != null || o.name.match(/Su-27|Bf-109|MiG|Flanker/i)));
  const blueGround = outcomes.filter(o => o.actor === "actor_1" && o.readiness == null);
  const redGround = outcomes.filter(o => o.actor === "actor_2" && o.readiness == null);

  switch (id) {
    case "hidden_ad": {
      const blueLosses = blueAir.filter(o => o.delta != null && o.delta < -20);
      if (blueLosses.length >= 1) return "PASS — Blue aircraft took significant losses from hidden AD. The ambush worked.";
      const aborted = blueAir.every(o => o.delta === 0 || o.delta == null);
      if (aborted) return "PARTIAL — Blue aircraft took no damage. Adjudicator may have aborted the mission (knows about AD from full state) or AD was ineffective. Check narrative.";
      return "UNCLEAR — Some damage but not clearly an ambush result. Check narrative.";
    }

    case "trucks_vs_cas": {
      const convoyDamage = redGround.filter(o => o.delta != null && o.delta < -30);
      if (convoyDamage.length >= 1) return "PASS — WW2 convoy devastated by modern CAS as expected.";
      if (redGround.some(o => o.delta != null && o.delta < -10)) return "PARTIAL — Some damage to convoy but not the devastation expected against defenseless targets.";
      return "FAIL — Convoy barely damaged. Modern precision CAS should destroy undefended WW2 logistics.";
    }

    case "contested_airspace": {
      const anyLosses = [...blueAir, ...redAir, ...redGround].some(o => o.delta != null && o.delta < 0);
      if (anyLosses) return "PASS — Multiple units took losses in contested airspace. Complex engagement resolved.";
      return "UNCLEAR — No clear losses. May need narrative review.";
    }

    case "ww2_furball": {
      const anyAirLosses = [...blueAir, ...redAir].some(o => o.delta != null && o.delta < 0);
      if (anyAirLosses) return "PASS — WW2 dogfight produced air losses. Period-appropriate engagement.";
      return "PARTIAL — No air losses in a head-on WW2 dogfight. Unusual but possible if both sides broke off.";
    }

    case "urban_dug_in": {
      const redLosses = redGround.filter(o => o.delta != null && o.delta < 0);
      const maxRedLoss = Math.min(...redLosses.map(o => o.delta).filter(d => d != null), 0);
      if (maxRedLoss > -15) return "PASS — Dug-in urban defenders highly resistant to CAS. Minimal casualties as expected.";
      if (maxRedLoss > -30) return "PARTIAL — Moderate damage to dug-in urban defenders. CAS somewhat effective but limited.";
      return "FAIL — Heavy damage to dug-in urban defenders. 60% entrenched troops in urban terrain should be very resistant to CAS.";
    }

    case "high_vs_shorad": {
      const blueDamage = blueAir.filter(o => o.delta != null && o.delta < -10);
      if (blueDamage.length === 0) return "PASS — HIGH altitude aircraft safe from SHORAD. Altitude sanctuary works.";
      return "FAIL — HIGH altitude aircraft took significant damage from SHORAD-only AD. Gun/IR systems shouldn't reach HIGH altitude effectively.";
    }

    case "retreating_column": {
      const colDamage = redGround.filter(o => o.delta != null && o.delta < -20);
      if (colDamage.length >= 1) return "PASS — Retreating column devastated by air interdiction. Highway targets are vulnerable.";
      if (redGround.some(o => o.delta != null && o.delta < -10)) return "PARTIAL — Some damage to retreating column. Expected more from interdiction of road-bound targets.";
      return "FAIL — Retreating column barely damaged. Road-bound retreating units should be very vulnerable to CAS.";
    }

    case "bvr_approach": {
      const anyLosses = [...blueAir, ...redAir].some(o => o.delta != null && o.delta < 0);
      if (anyLosses) return "PASS — BVR engagement produced losses. System handles beyond-visual-range combat.";
      return "PARTIAL — No losses in BVR head-on. Both sides may have broken off.";
    }

    case "helo_vs_sam": {
      const heloLow = outcomes.find(o => o.name?.includes("LOW"));
      const heloMed = outcomes.find(o => o.name?.includes("MEDIUM"));
      // Apache at LOW should fare better against radar SAM than MEDIUM
      if (heloLow && heloMed && (heloLow.delta || 0) > (heloMed.delta || 0)) {
        return "PASS — LOW altitude helo took less damage than MEDIUM against radar SAM. Terrain masking works.";
      }
      if (heloLow && heloMed) return "PARTIAL — Both helos took similar damage. Expected LOW to be safer against radar SAM.";
      return "UNCLEAR — Could not compare helo altitude outcomes.";
    }

    case "danger_close": {
      const friendlyDamage = blueGround.filter(o => o.delta != null && o.delta < -5);
      const enemyDamage = redGround.filter(o => o.delta != null && o.delta < 0);
      if (enemyDamage.length > 0 && friendlyDamage.length === 0) return "PASS — CAS hit enemy without friendly casualties. Clean danger-close execution.";
      if (enemyDamage.length > 0 && friendlyDamage.length > 0) return "PARTIAL (REALISTIC) — CAS hit enemy but also caused friendly casualties. Danger close is inherently risky.";
      if (enemyDamage.length === 0) return "PARTIAL — Adjudicator may have refused danger close CAS to protect friendlies. Conservative but understandable.";
      return "UNCLEAR — Need narrative review.";
    }

    case "airlift_ambush": {
      const transport = blueAir.find(o => o.name?.includes("C-130") || o.name?.includes("Globemaster"));
      if (transport && transport.delta != null && transport.delta < -40) return "PASS — Unarmed transport destroyed by fighters. Expected outcome.";
      if (transport && transport.delta != null && transport.delta < -10) return "PARTIAL — Transport damaged but survived. Unarmed transport vs fighters should be near-certain kill.";
      return "FAIL — Transport barely damaged. Unarmed C-130 vs Su-27 pair should be a guaranteed kill.";
    }

    case "sead_then_cas": {
      const adUnit = outcomes.find(o => o.name?.includes("SA-11") || o.name?.includes("Buk"));
      const redInf = redGround.find(o => o.name?.includes("Infantry") || o.name?.includes("Red"));
      const adSuppressed = adUnit && (adUnit.delta != null && adUnit.delta < -10);
      const infHit = redInf && (redInf.delta != null && redInf.delta < -10);
      if (adSuppressed && infHit) return "PASS — SEAD suppressed AD and CAS followed through on ground target. Coordinated strike worked.";
      if (adSuppressed) return "PARTIAL — SEAD suppressed AD but CAS didn't inflict much ground damage.";
      if (infHit) return "PARTIAL — CAS hit ground target but SEAD didn't suppress AD much.";
      return "UNCLEAR — Neither AD suppression nor ground damage clearly visible. Check narrative.";
    }

    default:
      return "No automated assessment defined for this scenario.";
  }
}
