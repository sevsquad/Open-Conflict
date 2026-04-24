# RTS AI And Systems Audit

Date: 2026-04-22
Project: Open Conflict RTS alpha
Scope: `src/rts`, RTS-facing setup/content, shared pathing inputs, stock RTS presets, and empirical behavior from the stock `server_ai_duel` scenario.

## Executive Summary

The commander's tendency to blob on the VP is real, repeatable, and primarily structural rather than cosmetic. In the stock AI duel, Blue averaged `2` owner groups and sent `100%` of those owner tasks to the same target in `30/30` sampled commander states; Red averaged `2` owner groups and sent all owner tasks to the same target in `24/30` samples, with a mean top-target share of `0.90`. The RTS hierarchy is currently designed to collapse onto one objective or one visible contact.

Movement was slowed, but most other continuous-time systems were not retuned to the new tempo. Relative to one open-terrain hex of movement, the current simulation still allows:

- `10.39` to `22.86` direct-fire cycles per hex, depending on unit type.
- `9.09` to `14.29` subordinate replans per hex.
- `2.27` to `3.57` commander replans per hex.
- suppression recovery from `1.0` to `0` in `5` to `10` seconds.
- full fatigue accumulation from `0` to `100` in `31.3` seconds of travel.
- full support-based supply refill from `0` to `100` in `50` seconds.
- full support-based readiness recovery from `0` to `100` in `71.4` seconds.
- artillery flight time of only `0.75` seconds.

The result is a battle rhythm where maneuver is slow, but replanning, shooting, suppressing, recovering, and refocusing are still fast. That mismatch amplifies the blobbing problem because groups can repeatedly retarget the same decisive hex or contact long before maneuver has had time to create depth, spacing, or flanking geometry.

## Method

This audit used four evidence layers:

1. Static code review of the RTS runtime and its immediate dependencies:
   - `src/rts/rtsEngine.js`
   - `src/rts/rtsStart.js`
   - `src/rts/RtsGame.jsx`
   - `src/simulation/aiProfiles.js`
   - `src/simulation/aiPathfinding.js`
   - `src/simulation/presets.js`
   - `src/testFixture.js`
   - `src/simulation/schemas.js`
2. Constant-ratio analysis using the actual timing and movement formulas in `rtsEngine.js`.
3. Empirical sampling of the stock `server_ai_duel` preset over `240` ticks (`60` battle-seconds).
4. Repeated self-audit passes over this report to find omissions and fold them back into the main findings.

## Measured Symptoms

### Stock AI duel target concentration

Scenario: `getServerAiDuelPreset()` on the `testFixture` map.

- Blue (`actor_1`)
  - Average owner count: `2.0`
  - Average top-target share across sampled commander states: `1.00`
  - Samples where every owner had the same target: `30 / 30`
- Red (`actor_2`)
  - Average owner count: `2.0`
  - Average top-target share across sampled commander states: `0.90`
  - Samples where every owner had the same target: `24 / 30`

Observed sequence:

- At `250ms`, both directors target `3,4` (`Stonebrook Bridge`).
- At `250ms`, both commanders assign both owner groups to seize that same hex.
- At `250ms`, the decision log already spells out the collapse:
  - Blue: `unit_preset_6 -> Secure objective Stonebrook Bridge.` and `sector-east -> Secure objective Stonebrook Bridge.`
  - Red: `unit_preset_12 -> Secure objective Stonebrook Bridge.` and `sector-west -> Secure objective Stonebrook Bridge.`
- On first contact, both commanders switch both owner groups to the same visible-contact hex.
- Only later does Red occasionally split one owner off, and even then it usually remains a `1:1` split between adjacent contact hexes rather than a genuine broad-front plan.

### Tempo ratio table

Assuming open terrain, full fuel, full readiness, and `cellSizeKm = 1.0` on the test fixture:

| Movement type | Seconds per hex | Default direct-fire cycles per hex | Armor direct-fire cycles per hex | Subordinate replans per hex | Commander replans per hex |
| --- | ---: | ---: | ---: | ---: | ---: |
| `foot` | `28.571` | `16.33` | `22.86` | `14.29` | `3.57` |
| `tracked` | `22.222` | `12.70` | `17.78` | `11.11` | `2.78` |
| `wheeled` | `18.182` | `10.39` | `14.55` | `9.09` | `2.27` |
| `helicopter` | `6.000` | `3.43` | `4.80` | `3.00` | `0.75` |

Shared system constants:

- Artillery flight time: `0.75s`
- Under-fire window: `1.5s`
- Last-known decay: `120s`
- Director stale-front trigger: `12s`
- Support supply refill from `0` to `100`: `50s`
- Support readiness refill from `0` to `100`: `71.4s`
- Travel fatigue from `0` to `100`: `31.3s`
- Suppression decay from `1.0` to `0`:
  - without support: `10s`
  - with support: `5s`

## Findings

### 1. The AI hierarchy structurally produces concentration

Severity: High

Evidence:

- `src/rts/rtsEngine.js::buildSubordinateAssignments`
- `src/rts/rtsEngine.js::buildSubordinateOwners`
- `src/rts/rtsEngine.js::selectDirectorTarget`
- `src/rts/rtsEngine.js::findAssignedObjective`
- `src/rts/rtsEngine.js::selectCommanderTask`
- `src/rts/rtsEngine.js::buildSubordinateUnitOrder`

What is happening:

- The force is divided into very few owners.
  - Units with `parentHQ` all collapse under that HQ owner.
  - Unassigned units collapse into only three coarse sectors: west, center, east.
  - In the stock AI duel, each side effectively ends up with only `2` owners.
- The director picks a single `targetHex`.
- If a director target exists, `findAssignedObjective()` hands that same objective to every owner.
- If visible contact exists, `selectCommanderTask()` gives each owner the nearest visible enemy, which is often the same contact because the owners are already geographically concentrated.
- Each owner only gets one active task queue head at a time.
- `buildSubordinateUnitOrder()` then propagates that task almost unchanged to every eligible maneuver unit in that owner group.

Why it blobs:

- Concentration is not emerging from pathfinding alone. It is authored by the hierarchy before routing starts.
- The AI has almost no concept of frontage, support-by-fire, fixing vs flanking roles, screening distance, lane assignment, or approach diversity.
- Once contact forms, the hierarchy tends to re-collapse around the same seen enemy hex.
- Profile and doctrine settings only weakly counteract this because they mostly alter aggression, reserve ratio, and cadence. They do not alter owner decomposition, frontage, lane assignment, or target diversification.

Bottom line:

- The VP rush is not a single bad target choice. It is the natural output of a force decomposition that is too coarse and a tasking model that is too singular.

### 2. Movement was slowed, but most other gameplay clocks were not

Severity: High

Evidence:

- `src/rts/rtsEngine.js::computeSegmentMs`
- `src/rts/rtsEngine.js::TYPE_COOLDOWN_MS`
- `src/rts/rtsEngine.js::queueArtilleryImpact`
- `src/rts/rtsEngine.js::runAiCadence`
- `src/rts/rtsEngine.js::updateMoraleAndResources`
- `src/rts/rtsEngine.js::isUnderFire`

What is happening:

- `RTS_MOVEMENT_TIME_SCALE = 10` only affects movement timing.
- Fire cooldowns, artillery travel, suppression decay, fatigue change, readiness/supply recovery, and AI cadences were mostly left on their original second-scale timing.

Why it matters:

- The relative battle rhythm is now skewed.
- Units spend much longer moving between hexes, but can still shoot, recover, replan, and reclassify the fight very quickly.
- That makes maneuver feel sluggish while contact handling feels twitchy.

Practical effect:

- A foot unit can be subject to roughly `16` default direct-fire opportunities while crossing one open hex.
- A subordinate controller can reconsider the fight around `14` times during that same foot-hex movement.
- The commander can reframe the plan more than `3` times before a foot unit finishes the hex.

Bottom line:

- This is the clearest "10x faster than it should" family outside raw movement.

### 3. Command and control is effectively instant at RTS scale

Severity: High

Evidence:

- `src/rts/rtsEngine.js::reduceRtsCommand`
- `src/rts/rtsEngine.js::assignImmediateCommand`
- `src/rts/rtsEngine.js::runCommanderPass`
- `src/rts/rtsEngine.js::runSubordinatePass`
- `src/rts/rtsEngine.js::runExecutorPass`

What is happening:

- Orders are assigned immediately once a cadence window opens.
- Units accept them without any modeled relay delay, acknowledgment delay, formation time, or commitment window.
- Blocked advances can resume the moment capacity opens via `maybeResumeBlockedAdvance()`, which runs in the executor loop every tick.

Why it matters:

- Even if movement is slow, the AI can still retask and retarget with near-instant responsiveness.
- That encourages dogpiling the newest decisive point because there is almost no cost to collective pivoting.

Bottom line:

- The current command model behaves like a very responsive arcade RTS layered over slower movement speeds. That mismatch strongly favors blobs and reactive swarms.

### 4. The objective model over-rewards exact-hex concentration

Severity: High

Evidence:

- `src/rts/rtsEngine.js::updateObjectives`
- `src/rts/rtsEngine.js::updateVictory`
- `src/simulation/presets.js::getQuickstartPreset`
- `src/simulation/presets.js::getServerAiDuelPreset`

What is happening:

- Objectives are controlled only by settled units physically occupying the exact VP hex.
- There is no control radius, frontage influence, adjacent support, denial zone, or approach-lane logic.
- In the stock AI duel, the largest VP (`Stonebrook Bridge`, `30 VP`) sits only `3` hexes from both secondary VPs on a `1 km` hex map.

Why it matters:

- The cleanest way to win is to pile enough force onto the exact VP hex or the exact contact immediately adjacent to it.
- Because scoring ignores broader local control, screening the flanks, holding nearby overwatch, and shaping the approaches are undervalued.

Bottom line:

- The scoring grammar is "sit on the point," not "control the area." That mechanically encourages local mass.

### 5. Route selection encourages same-axis movement and does not model traffic

Severity: Medium-High

Evidence:

- `src/simulation/aiPathfinding.js::computeStepCost`
- `src/rts/rtsEngine.js::planRoute`

What is happening:

- Roads get strong discounts.
- Bridges get a bonus.
- Rivers without bridges get punished.
- There is no cost for friendly route crowding, same-lane overuse, bridge congestion, or approach saturation.
- There is no planner-level assignment of distinct lanes or supporting axes.

Why it matters:

- Even if the AI had slightly different targets, cost-based routing still pulls many units toward the same cheapest crossing and same best road.
- On river maps this naturally creates bridge funnels and road columns without any operational penalty until an actual occupancy block happens.
- The recent increase to `RTS_MAX_UNITS_PER_HEX = 2`, plus air/helicopter/non-occupancy exemptions, further lowers one of the few remaining anti-blob frictions at the point of contact.

Bottom line:

- The pathfinder is tactically sensible in isolation, but operationally it has no "too many friendlies are already using this way" logic.

### 6. Recovery, sustainment, and fatigue are compressed into unrealistically short windows

Severity: Medium-High

Evidence:

- `src/rts/rtsEngine.js::updateMoraleAndResources`
- `src/rts/rtsEngine.js::findNearbySupport`

What is happening:

- A unit within `2` hexes of HQ/logistics can refill supply from empty to full in `50s`.
- It can refill readiness from empty to full in `71.4s`.
- Suppression can fully decay in `5s` to `10s`.
- Travel fatigue can max from `0` to `100` in `31.3s`.

Why it matters:

- Sustainment effects happen at a skirmish-game tempo, not a battalion/brigade tempo.
- Nearby support acts more like a healing aura than an operational sustainment system.
- Since recovery is fast and local, the AI has little incentive to preserve operational pauses, echeloned support, or deliberate regroup windows.
- Because support only needs to be close and not formally tasked, it also encourages HQ/logistics clusters to ride just behind the main mass instead of sustaining a broader frontage.

Bottom line:

- The sustainment model is currently too fast and too binary to reinforce realistic pacing or discourage repetitive local swarming.

### 7. The director's "stale front" and memory logic are too fast for the slowed battle

Severity: Medium-High

Evidence:

- `src/rts/rtsEngine.js::computeDirectorEvidence`
- `src/rts/rtsEngine.js::LAST_KNOWN_DECAY_MS`
- `src/rts/rtsEngine.js::findNearestLastKnown`

What is happening:

- The director adds probe pressure after `12,000ms` of unchanged state.
- Last-known contacts decay after `120,000ms`.

Why it matters:

- At current movement speeds, `12s` is less than half a foot-hex and only about half a tracked-hex.
- The AI can decide the front is stale before slower maneuver has had time to unfold.
- Last-known contact memory also ages out relatively quickly for a slowed, larger-feeling battle.

Bottom line:

- The higher-level AI is still reasoning on a shorter battle clock than the movement model implies.

### 8. Reserve logic is too binary and too eager

Severity: Medium

Evidence:

- `src/rts/rtsEngine.js::buildAiDirectives`
- `src/rts/rtsEngine.js::buildReserveSet`
- `src/rts/rtsEngine.js::shouldReleaseReserves`

What is happening:

- Reserve assignment is a static top-slice of strong maneuver units.
- Release is triggered by simple visible-pressure or objective-pressure thresholds, or by director recovery state.
- Reserve release does not preserve a secondary echelon, alternate axis, or counterattack package once commitment starts.

Why it matters:

- Once the release condition hits, reserve strength often feeds the same main effort instead of forming a distinct counterattack or exploitation role.

Bottom line:

- The reserve system adds tempo to the blob instead of depth behind it.

### 9. Support units do not stage the maneuver; they mostly trail it

Severity: Medium

Evidence:

- `src/rts/rtsEngine.js::buildSubordinateUnitOrder`
- `src/rts/rtsEngine.js::findNearestFriendlyAnchor`
- `src/rts/rtsEngine.js::queueArtilleryImpact`

What is happening:

- Artillery, logistics, and HQs generally move to or hold near a nearby anchor.
- There is no explicit fire-support plan, support-by-fire position, assault position, or overwatch phase.
- Artillery effects are fast enough to feel like responsive local fires, but not organized enough to shape maneuver lanes deliberately.

Why it matters:

- Support elements are not generating maneuver geometry.
- They follow the maneuver mass more than they create conditions for distinct maneuver groups.

Bottom line:

- The current system has support assets, but not a real staging logic for them.

### 10. The stock RTS duel is also a scale-contract stress case

Severity: Medium

Evidence:

- `src/simulation/presets.js::getServerAiDuelPreset`
- `src/testFixture.js`
- `src/simulation/schemas.js::SCALE_TIERS`

What is happening:

- `server_ai_duel` is marked `grand_tactical`.
- `grand_tactical` advertises `2-5km` hexes in `SCALE_TIERS`.
- The test fixture uses `cellSizeKm: 1.0`.

Why it matters:

- The duel scenario that most clearly exhibits the blob is also being run on a map scale smaller than the label implies.
- That shrinks approach distances and compresses all three objectives into a very small maneuver space.
- It also makes it harder for the stock profile difference (`aggressive_breakthrough` vs `cautious_defender`) to express itself through maneuver depth and frontage.

Bottom line:

- Some of the observed urgency is scenario-scale compression, not only AI logic.

### 11. Scenario narrative intent is richer than the runtime actually uses

Severity: Medium

Evidence:

- `src/simulation/presets.js::getServerAiDuelPreset`
- `src/rts/rtsEngine.js::runCommanderPass`
- `src/rts/rtsEngine.js::selectCommanderTask`
- `src/rts/rtsEngine.js::buildAiDirectives`

What is happening:

- Presets carry rich natural-language objectives and constraints such as:
  - exploit across the river
  - use armor as the main effort
  - preserve the reserve for a deliberate counterattack
  - do not strand the reserve without support
- The runtime AI does not operationalize most of that text directly.
- The practical decision inputs are mostly:
  - VP state
  - visible contacts
  - last-known contacts
  - profile numeric weights
  - reserve and release settings

Why it matters:

- Scenario prose can imply deliberate doctrinal behavior that the runtime is not actually modeling.
- This makes it easy to overestimate how much scenario-authored doctrine is already constraining blobbing.

Bottom line:

- Scenario prose currently promises more operational nuance than the RTS commander can execute.

## Root Cause Synthesis

The blob forms because multiple systems all lean in the same direction:

1. The director selects one decisive point.
2. The commander gives the same task to almost every owner.
3. Owner count is too low to create genuine breadth.
4. The objective model rewards exact-hex occupation more than local area control.
5. The pathfinder prefers the same efficient route and does not price congestion.
6. Orders retarget quickly and with no meaningful delay.
7. Contact-driven replans happen much faster than maneuver unfolds.
8. Recovery and support are so fast that the cost of repeated local concentration stays low.
9. Profile and narrative doctrine differences are currently too shallow to overcome the structural pull toward concentration.

The result is not just "aggressive AI." It is a system where concentration is cheap, operational spread is under-modeled, and decisive-point fixation is over-rewarded.

## Recommended Fixes

### Priority 1: Fix the tempo mismatch

- Introduce a single RTS tempo scaling policy and apply it to:
  - fire cooldowns
  - artillery flight times
  - suppression decay
  - fatigue change
  - readiness/supply/fuel recovery
  - under-fire windows
  - director stale thresholds
  - commander/subordinate cadences
  - reserve release hysteresis
- Prefer one central ratio derived from movement scale instead of one-off retunes.

### Priority 2: Break the single-main-effort tasking pattern

- Increase owner decomposition beyond one HQ bucket plus coarse sectors.
- Add explicit task roles:
  - main effort
  - support-by-fire
  - screen/recon
  - reserve
  - flank/supporting effort
- Let the commander allocate different objectives or approach lanes to different owners even when the director has one decisive point.

### Priority 3: Change objectives from exact-hex occupation toward local control

- Add control radius or influence radius around VPs.
- Award control for area dominance, not only exact settled-hex occupancy.
- Consider adjacent overwatch, uncontested local influence, or linked-hex control.
- Keep capture delay, but tie it to local control rather than exact stacking.

### Priority 4: Penalize route crowding

- Add congestion cost to the threat/path map based on friendly planned routes.
- Increase bridge and choke penalties when multiple owners share the same avenue.
- Reserve alternate lanes for non-main-effort owners.

### Priority 5: Add real command friction

- Add order relay delay or owner-level commitment timers.
- Prevent rapid full-force retargets every few seconds.
- Require a minimum task dwell or reorg window before another large plan pivot.

### Priority 6: Add frontage and mutual-support logic

- Give each owner a frontage width and preferred depth.
- Penalize owners whose unit centroids collapse below a minimum dispersion.
- Reward positions that mutually support adjacent owners instead of co-locating them.

### Priority 7: Slow and deepen recovery/sustainment

- Replace aura-like recovery with slower rate-based replenishment.
- Make logistics proximity necessary but not sufficient.
- Require relative stability, time, or explicit resupply posture for major recovery.

### Priority 8: Preserve reserve identity after release

- Release reserves by role:
  - reinforce main effort
  - counterattack
  - secure flank
  - exploit breach
- Do not let reserve release automatically merge into the same owner lane unless the commander explicitly chooses it.

## Audit Rounds On This Report

### Round 1: Initial draft audit

Checked for:

- obvious RTS loop timing mismatches
- commander/director target logic
- route concentration
- objective incentives

Added after round 1:

- the quantified cadence-to-movement table
- empirical target-concentration statistics from the stock AI duel

### Round 2: Coverage audit for hidden fast clocks

Checked for:

- non-movement time constants that were easy to miss
- support/recovery loops
- stale-front and last-known decay behavior
- reserve-release timing
- whether profile/doctrine knobs could already offset the blob structurally

Added after round 2:

- the stale-front probe finding
- the memory-decay finding
- the reserve eagerness finding
- the explicit command-friction finding
- the note that current profile/doctrine settings do not meaningfully solve owner or target collapse

### Round 3: Coverage audit for scenario/content distortion

Checked for:

- whether the observed blob was partially scenario-authored
- whether setup/preset scale labeling distorted the audit
- whether shared map scale and VP spacing changed interpretation
- whether recent stack-limit changes altered congestion incentives

Added after round 3:

- the stock-duel scale-contract mismatch finding
- the explicit note that VP spacing on the duel map is only `3`, `3`, and `5` hexes between objectives on a `1km` grid
- the note that `2`-unit stack capacity plus non-occupancy air exemptions further lowers concentration friction

### Round 4: Boundary audit

Checked for:

- save/load/autosave timing
- replay/thought/debug timing
- UI-only timers
- non-gameplay wall-clock intervals

Conclusion:

- These systems matter for UX and debugging, but they are not primary causes of gameplay tempo distortion or AI blobbing under the current audit scope.

## Confidence

Confidence is high that this report captures the dominant causes of the current VP-rush/blob behavior and the main remaining "old-speed" clocks that still distort the slowed RTS battle rhythm.

What could still be missing:

- map-specific effects on the large built-in RTS-ready maps that do not appear in the `testFixture`
- future interactions introduced by later refactors
- player-side UX issues that amplify perceived blobbing without changing underlying behavior

What is unlikely to be missing:

- the main structural cause of the current blob
- the major timing mismatches still operating at the old tempo
- the strongest system-level incentives pushing the AI toward concentration
