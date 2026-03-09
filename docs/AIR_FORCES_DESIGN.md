# Air Forces System Design

> Design document for the Open Conflict air power system.
> Status: **DRAFT — Refining**

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Altitude System](#altitude-system)
3. [Air Superiority Model](#air-superiority-model)
4. [Air Mission Orders](#air-mission-orders)
5. [Air Defense Interaction](#air-defense-interaction)
6. [Air-to-Air Interception System](#air-to-air-interception-system)
7. [Air Unit Persistence & Basing](#air-unit-persistence--basing)
8. [Fuel & Bingo System](#fuel--bingo-system)
9. [Air Unit State Tracking](#air-unit-state-tracking)
10. [Waypoint & Flight Planning](#waypoint--flight-planning)
11. [CAS Sector Model](#cas-sector-model)
12. [Escort System](#escort-system)
13. [Interdiction & Supply Effects](#interdiction--supply-effects)
14. [Scale-Specific Rules](#scale-specific-rules)
15. [Era-Specific Considerations](#era-specific-considerations)
16. [Friction Events](#friction-events)
17. [LLM Prompt Doctrine](#llm-prompt-doctrine)
18. [New Unit Templates & Attributes](#new-unit-templates--attributes)
19. [Resolved Design Decisions](#resolved-design-decisions)
20. [Execution Phases](#execution-phases)

---

## Design Philosophy

### Core Principles

1. **Air superiority is a prerequisite, not a bonus.** Controlling the sky enables effective air operations — it does not directly multiply ground unit combat power. A lone fighter achieving air supremacy does not make infantry 3x as effective. The ground combat benefit comes from CAS/strike aircraft operating under the umbrella of air superiority.

2. **Altitude creates the central strategic tension.** The inverse relationship between aircraft survivability and exposure to ground fire is the deepest layer of air-ground interaction. Low altitude maximizes CAS effectiveness but exposes aircraft to gun-based AD. High altitude avoids guns but exposes aircraft to radar-guided SAMs. This rock-paper-scissors must be a player decision.

3. **LLM handles judgment, mechanics handle math.** The orderComputer pre-computes AD threat envelopes, air superiority ratios, air-to-air interception results, and flight path risk assessments. The LLM receives computed results and adjudicates narrative outcomes within mechanically-enforced bounds.

4. **Realistic to the era.** WW2 air power operates under different constraints than modern air power. Precision weapons, radar, electronic warfare, and IADS all evolve across eras and fundamentally change how air operations work.

5. **Joint command, separable roles.** The system assumes a joint commander but supports splitting ground and air command between different players. Air orders are issued separately from ground orders and resolved in a distinct phase.

---

## Altitude System

### The Core Tension

Altitude creates an inverse survivability relationship:

- **For the aircraft**: Lower = more exposed to ground fire, higher = safer from guns
- **For air defense**: Lower targets are easier for guns/MANPADS, higher targets are easier for radar SAMs
- **For mission effectiveness**: Lower = better CAS target identification, higher = worse accuracy (era-dependent)

This creates a genuine rock-paper-scissors dynamic that is the heart of air-ground strategy.

### Three Altitude Bands

Every air mission order includes an **altitude profile** selection:

| Band | Altitude (AGL) | Description |
|------|----------------|-------------|
| **NOE/Low** | <500m | Nap-of-earth / terrain following |
| **Medium** | 500m - 5,000m | Standard tactical altitude |
| **High** | >5,000m | Above most gun AD ceilings |

**Aircraft type altitude restrictions:**

| Aircraft Type | Low | Medium | High |
|--------------|-----|--------|------|
| Helicopters | Default ✓ | Allowed ✓ | Locked ✗ |
| Fixed-wing (all) | Allowed ✓ | Default ✓ | Allowed ✓ |
| Tactical drones (TB2) | Allowed ✓ | Default ✓ | Locked ✗ |
| High-altitude ISR (Global Hawk) | Locked ✗ | Locked ✗ | Default ✓ |
| Loitering munitions | Default ✓ | Locked ✗ | Locked ✗ |
| Observation balloons | Default ✓ (tethered) | Locked ✗ | Locked ✗ |

Helicopters CAN fly at medium altitude (~10,000-15,000ft is within most helicopter ceilings). At medium they lose terrain-masking advantage and become easy targets for fighters and medium-range SAMs, but they are above most gun AD. This is a real tradeoff — constant decisions.

### Altitude vs. AD Effectiveness Matrix

Gun AD effectiveness against low-altitude aircraft varies by aircraft **speed**:

| AD Type | vs. Low (slow/hover) | vs. Low (fast jet) | vs. Medium | vs. High |
|---------|---------------------|-------------------|------------|----------|
| **AAA / Gun AD** | Very High | Low | Moderate | Ineffective |
| **MANPADS** | High | Moderate | Low | Ineffective |
| **Short-Range SAM** | High | Moderate | High | Low |
| **Medium-Range SAM** | Moderate | Moderate | Very High | High |
| **Long-Range SAM** | Low* | Low* | High | Very High |
| **Small Arms** (infantry organic) | Moderate (helo) / Low (fast) | Very Low | Ineffective | Ineffective |

*Long-range SAMs have minimum engagement altitudes/ranges — very low aircraft can fly underneath their engagement envelope.

Key insight: a Mach 1+ jet at 100m gives a ZSU-23-4 maybe 3-5 seconds of engagement window. Hit probability is very low. Gun AD is devastating against slow/hovering targets (helicopters, A-10 in a gun run, Stuka pulling up from a dive) but marginal against fast movers at treetop level.

### Altitude vs. Mission Effectiveness

| Mission Type | Low | Medium | High |
|-------------|-----|--------|------|
| **CAS (unguided)** | Excellent | Good | Poor |
| **CAS (guided/precision)** | Excellent | Good | Good* |
| **Air Superiority** | Poor (energy disadvantage) | Good | Excellent |
| **Interdiction** | Good | Good | Good* |
| **Strategic Strike** | N/A | Poor | Good |
| **Recon (visual)** | Excellent | Good | Poor |
| **Recon (sensor/ELINT)** | Good | Good | Excellent |
| **SEAD** | High risk, high reward | Standard | Standoff (modern only) |

*Precision weapons (Paveway, JDAM, SDB) partially negate high-altitude accuracy penalty. This is era-dependent — WW2 has no precision weapons, so high-altitude CAS is area bombing only.

### Altitude and Detection

| Altitude | Radar Detection Range | Visual Detection Range |
|----------|----------------------|----------------------|
| **Low** | ~20km (ground clutter, terrain masking) | ~5-10km |
| **Medium** | ~80-150km | ~15-20km |
| **High** | ~200-400km (clear radar return) | ~30km+ (contrails visible) |

Stealth aircraft get massive radar detection reductions. WW2 aircraft have no radar detection (no radar until late war, and then crude).

Detection uses the existing three-tier model: radar gives CONTACT at long range, visual/IFF gives IDENTIFIED at closer range.

### Altitude Changes at Waypoints

Players can change altitude at each waypoint along a flight path (see [Waypoint & Flight Planning](#waypoint--flight-planning)). This means players can:
- Fly high for transit (avoid AAA), drop low for the attack run
- Route low through a mountain valley to avoid radar, then climb for the engagement
- Descend to terrain-following to egress through a SAM belt

---

## Air Superiority Model

### Problem with Blanket Multipliers

The naive approach — "air supremacy = 2x ground combat" — produces unrealistic results:

- A lone P-51 with no enemies in the sky gives air supremacy, making a rifle platoon twice as effective. Absurd — the P-51 isn't doing anything to help the infantry.
- All AA is suppressed, both air forces are destroyed, but one side has a single dive bomber left — that side's entire ground force does 3x damage. Also absurd.

### The Correct Model: Enablement, Not Multiplication

Air superiority is a **prerequisite** that enables air operations, not a direct ground combat multiplier. The actual ground effect comes from what aircraft DO with that superiority.

**Two-layer model:**

**Layer 1: Air Superiority Level (ASL)** — computed mechanically, determines what air operations are possible.

| ASL | Ratio (friendly air : enemy air+AD) | Effect |
|-----|--------------------------------------|--------|
| **Air Supremacy** | >3:1 | Friendly air operates freely. Enemy air ops impossible. |
| **Air Superiority** | 1.5:1 to 3:1 | Friendly air operates with low attrition. Enemy air ops heavily constrained. |
| **Contested** | 0.67:1 to 1.5:1 | Both sides can operate but both take attrition. CAS effectiveness reduced. |
| **Air Denial** | 0.33:1 to 0.67:1 | Friendly air ops heavily constrained and costly. Enemy operates with moderate freedom. |
| **Enemy Supremacy** | <0.33:1 | Friendly air ops near-impossible. Enemy air operates freely. |

ASL is computed per sector (group of hexes around the action) by the orderComputer, considering:
- Air superiority-capable aircraft assigned to AIR_SUPERIORITY or CAP missions in the sector
- Air defense units providing denial coverage
- Strength, capabilities, and era-appropriate factors

**Layer 2: Air-Ground Effect** — the actual ground combat modifier, determined by CAS/strike aircraft actively supporting the engagement.

The ground combat modifier depends on:
1. **Number/strength of CAS aircraft** actively attacking in the sector
2. **ASL in the area** (CAS under contested skies is riskier and less effective)
3. **Altitude profile** selected for the CAS mission
4. **Era** (precision weapons increase per-sortie effectiveness)
5. **Weather** (cloud cover degrades unguided weapons, less effect on guided)
6. **Target type** (armor in open is ideal for CAS; infantry in forest/urban much harder)
7. **AD threat in the area** (CAS aircraft dodging SAMs are less effective at supporting ground troops)

### Era-Specific Air Superiority Effects

Even without CAS aircraft actively bombing, air superiority itself provides some passive benefits:

| Effect | WW1 | WW2 | Cold War | Modern |
|--------|-----|-----|----------|--------|
| **Passive ground modifier** (no CAS) | ~1.0x (no ground attack capability) | ~1.05x (psychological) | ~1.05-1.1x | ~1.1x (ISR integration) |
| **Primary value without CAS** | Observation dominance → artillery accuracy | Freedom from enemy strafing | Freedom from enemy interdiction | Full-spectrum ISR advantage |
| **CAS modifier ceiling** (with full CAS commitment) | ~1.05-1.1x (late war strafing only) | ~1.3-1.5x | ~1.3-1.7x | ~1.5-2.0x |

**Key insight:** The 1.5-2.0x multiplier is the ceiling when you have BOTH air supremacy AND substantial CAS commitment. It is not free — it requires dedicating aircraft to CAS missions. A side with air supremacy but all fighters and no CAS aircraft gets maybe 1.05-1.1x.

The CAS effect only applies in the specific sector where CAS aircraft are operating, not as a blanket bonus across the entire front.

### WW1: Air Superiority as Intelligence Dominance

WW1 air power is fundamentally about **intelligence, not firepower**. Air superiority determines WHO CAN OBSERVE, which determines whose artillery is accurate, which is the actual ground combat modifier. The effect is once-removed from direct air-ground combat.

- Side with air superiority: observation aircraft operate freely → accurate artillery → ground combat advantage
- Side without air superiority: blind artillery → wasted shells → ground combat disadvantage
- The detection system already supports this — observation aircraft with huge detection ranges and air superiority enabling them to operate freely

---

## Air Mission Orders

### New Order Types

Added to `orderTypes.js` alongside existing naval orders:

| Order | Slot | Target | Tiers | Valid For | Altitude |
|-------|------|--------|-------|-----------|----------|
| `CAS` | Action | sector (3-5 hex area) | 3-6 | air with `close_air_support` | Player selects |
| `AIR_SUPERIORITY` | Action | hex (sector center) | 3-6 | air with `air_superiority` | Medium/High (auto) |
| `INTERDICTION` | Action | hex | 4-6 | air with `close_air_support` or `precision_strike` | Player selects |
| `SEAD` | Action | unit (AD unit target) | 4-6 | air with `precision_strike` or `sead_capable` | Player selects |
| `STRATEGIC_STRIKE` | Action | hex | 5-6 | air with `strategic_bombing` or `precision_strike` | High (auto) |
| `AIRLIFT` | Action | unit (cargo) | 4-6 | air with `airlift` or `air_transport` | Medium (auto) |
| `AIR_RECON` | Action | hex | 3-6 | air (any) | Player selects |
| `CAP` | Action | null (patrol current sector) | 3-6 | air with `air_superiority` | Medium/High (auto) |
| `ESCORT` | Sortie type | unit (air unit to escort) | 3-6 | air with `air_superiority` | Matches escorted unit |

### CAS Order Subtypes

- **DIRECT**: Gun runs, rockets, low-level strafing. Requires LOW altitude.
- **BOMBING**: Bomb delivery (unguided or guided). Any altitude, effectiveness varies.
- **STANDOFF**: Guided munitions from outside AD envelope. Modern era only. Medium/High altitude.

### Helicopter-Specific Orders

Helicopters use a subset: CAS, AIR_RECON, AIRLIFT (transport only), MOVE, WITHDRAW, ESCORT (attack helicopters only in some modern configurations).

Helicopters do NOT get: AIR_SUPERIORITY, INTERDICTION, SEAD, STRATEGIC_STRIKE, CAP.

### Sortie Planning System

At tier 4+, air units can fly multiple sorties per turn. The UI works as follows:

1. Open the air unit's card
2. Click **"Add Sortie"** button — shows `(X sorties remaining this turn)`
3. Configure the sortie: mission type, target/sector, waypoints, altitude
4. Click **Accept** — sortie appears below the button as a **"Planned Sortie"**
5. Click any planned sortie to modify or cancel
6. Unused sorties are automatically assigned as **rest periods** (contributing to readiness recovery)
7. Player can explicitly plan a **"Rest"** sortie to prioritize maintenance

Sortie count per turn is based on readiness, turn duration, and airfield capacity (see [Air Unit State Tracking](#air-unit-state-tracking)).

### Compatibility with Movement

| Air Order | + MOVE | + WITHDRAW | No Movement |
|-----------|--------|------------|-------------|
| CAS | true | false | true |
| AIR_SUPERIORITY | true | false | true |
| INTERDICTION | true | false | true |
| SEAD | true | false | true |
| STRATEGIC_STRIKE | false | false | true |
| AIRLIFT | true | false | true |
| AIR_RECON | true | false | true |
| CAP | true | false | true |

For transient aircraft, MOVE represents transit to the mission area. For persistent helicopters, MOVE is repositioning.

---

## Air Defense Interaction

### AD Classification

Three mechanical categories based on engagement method:

| Category | Capability Tag | Examples | Key Characteristics |
|----------|---------------|----------|---------------------|
| **Gun-based AD** | `gun_ad` | ZSU-23-4, Gepard, Bofors 40mm, M163 VADS, WW2 flak | High rate of fire, effective vs. slow/low targets, NOT suppressible by anti-radiation missiles, requires visual/optical tracking |
| **IR Missile AD** | `ir_missile_ad` | Stinger, Igla, Mistral (MANPADS); Avenger, Strela-10 | Heat-seeking, effective at low-medium altitude, resistant to radar SEAD, limited range |
| **Radar Missile AD** | `radar_missile_ad` | Hawk, Buk, SA-6, Patriot, S-400 | Radar-guided, effective at medium-high altitude, VULNERABLE to SEAD/anti-radiation missiles, longest range |

Many real-world systems combine categories: Tunguska = `gun_ad` + `ir_missile_ad`, Pantsir = `gun_ad` + `radar_missile_ad`.

### SEAD Effectiveness by AD Type

| SEAD Method | vs. Gun AD | vs. IR Missile AD | vs. Radar Missile AD |
|-------------|-----------|-------------------|---------------------|
| **Anti-radiation missile** (HARM, ALARM) | Ineffective (no radar) | Ineffective (no radar) | Very effective |
| **Standoff precision strike** (JDAM, SDB) | Effective (if located) | Effective (if located) | Effective |
| **Suppressive jamming** | Ineffective | Partially effective | Effective (degrades radar) |
| **Direct attack** (gun run, rockets) | Risky but effective | Risky but effective | Very risky |

### Infantry Organic Air Defense

All infantry units inherently have some ability to engage LOW-altitude aircraft with organic weapons (machine guns, rifles). This is not a `specialCapability` — it's inherent. Effect: minor attrition risk to helicopters and slow low-flying CAS aircraft, negligible against fast jets. Modeled in the AD threat assessment as a background threat at LOW altitude wherever infantry is present.

### AD Engagement Computation (orderComputer)

For each air mission, the orderComputer computes along the full waypoint path:

```
AD Threat Assessment:
- Segment 1 (Base → WP-A) at MEDIUM altitude: CLEAR
- Segment 2 (WP-A → WP-B) at LOW altitude: [ZSU-23-4] in range, aircraft speed FAST → threat LOW
- Segment 3 (WP-B → Target) at LOW altitude: [SA-6] coverage overhead (below envelope) → threat CLEAR;
  [infantry small arms] → threat NEGLIGIBLE
- Target area: [SHORAD] 2 hexes east, engagement range MARGINAL
- Aggregate mission threat: LOW
```

---

## Air-to-Air Interception System

### Two-Phase Mechanical Resolution

When enemy air superiority/CAP aircraft could intercept a CAS, interdiction, or strike mission, the system resolves it in two mechanical phases before the LLM sees the result.

### Phase 1: Catch / No-Catch (Binary)

Determines whether the interceptor even detects and reaches the incoming mission.

**Factors:**

| Factor | Weight | Description |
|--------|--------|-------------|
| **Detection** | High | Can the interceptor detect the CAS? Radar = high detect chance. Visual only (WW1/WW2) = low. GCI/AWACS direction = very high. Stealth = massive reduction. |
| **Relative speed** | High | Speed differential is dominant. A significantly slower interceptor essentially never catches a faster target (physics trumps luck). Similar speeds = contested. |
| **Distance to CAS AO** | Medium | How far is the interceptor's patrol position from where CAS is operating? Closer = higher catch. If CAS only clips the edge of the patrol sector, catch is unlikely. |
| **Remaining fuel** | Low-Medium | Does the interceptor have fuel to pursue? Low fuel = must disengage. |
| **Fortune roll** | Low | Only matters in the "could go either way" band. When speed differential is large, fortune has negligible weight — physics dominates. |

**Catch probability examples:**

| Scenario | Catch Probability |
|----------|------------------|
| Modern fighter with radar + AWACS, CAS deep in patrol sector | ~95-100% |
| Cold War fighter, CAS at edge of patrol sector, similar speeds | ~40-60% |
| WW2 fighter, visual detection only, CAS clips sector edge | ~15-25% |
| WW1 biplane trying to catch a significantly faster aircraft | ~0-5% |
| Any interceptor significantly slower than target | ~5-10% (lucky bounce only) |

**If catch fails:** CAS operates unopposed in the sector. Interceptor consumes fuel/readiness but achieves nothing.

**If catch succeeds:** Proceed to Phase 2.

**Escort modifier on catch:** An escort fighter doesn't prevent detection of the strike package. But when the interceptor catches the package, the escort engages first. This can produce three sub-outcomes:
- Escort drives off interceptor → CAS continues unimpeded
- Escort and interceptor both engaged → CAS continues with reduced escort for subsequent sorties
- Interceptor breaks through escort → proceed to Phase 2 interdiction score against CAS

### Phase 2: Interdiction Score (1-100)

Computed server-side using aircraft attributes from both sides.

**Inputs:**
- Interceptor: speed, maneuverability, weapons package, readiness, fuel, altitude advantage
- Target: speed, maneuverability, defensive armament (rear gunners), ECM capability, escort presence
- Era-specific engagement parameters (guns-only vs BVR missiles)
- Fortune roll

**Interdiction Score Bands:**

| Score | Result | CAS Effect |
|-------|--------|------------|
| **1-25** | Harassing pass | CAS continues, ~-10% effectiveness |
| **26-50** | Contested engagement | CAS continues, ~-30% effectiveness, minor CAS losses |
| **51-74** | Serious interception | CAS partially disrupted, ~-50% effectiveness, notable CAS losses |
| **75-89** | Driven off | CAS mission cancelled, moderate CAS losses |
| **90-100** | Devastating interception | CAS mission cancelled, severe CAS losses |

**What the LLM receives:**
```
CAS mission by [Blue Strike Pkg] was intercepted by [Red Fighter Sqn].
Catch result: CAUGHT (interceptor radar detection at 80km, speed advantage +200km/h)
Interdiction score: 67 (serious interception)
Result: CAS effectiveness halved, [Blue Strike Pkg] lost ~8% strength.
[Red Fighter Sqn] lost ~3% strength in the engagement.
```

The LLM narrates this result — it does not recompute it.

### Required Aircraft Attributes for Interception Math

New `airProfile` object on air unit templates:

```js
airProfile: {
  speed: "slow" | "medium" | "fast" | "supersonic",
  maneuverability: 1-10,        // dogfight capability score
  weaponsPackage: ["guns", "ir_missiles", "radar_missiles", "bvr_missiles"],
  defensiveArmament: false,     // rear gunner, tail warning radar
  ecm: false,                   // electronic countermeasures
  radarEquipped: false,         // onboard detection radar
}
```

Speed tiers (approximate):
- **Slow**: <400 km/h (WW1 biplanes, helicopters, some drones, observation aircraft)
- **Medium**: 400-800 km/h (WW2 fighters, turboprop attack aircraft, A-10)
- **Fast**: 800-1,500 km/h (early jets, subsonic/transonic modern aircraft)
- **Supersonic**: >1,500 km/h (modern fighters, interceptors)

---

## Air Unit Persistence & Basing

### Tier 3 (Grand Tactical): Mixed Model

**Helicopters — Persistent:**
- Remain on the map between turns as physical counters
- Must return to a base/FARP for fuel and rearming (see [Fuel & Bingo System](#fuel--bingo-system))
- Movement budget: 8 hexes, terrain-independent but affected by weather

**Fixed-Wing — Transient:**
- Do not occupy hexes between turns
- Based at an airfield hex (on-map) or off-map airbase
- When given a mission order, they fly from base → waypoints → mission area → return to base, all within the turn
- Appear in unit roster with a `baseHex` field (their airfield location)
- Range radius from base determines which hexes they can reach. Missions beyond radius: MARGINAL or IMPOSSIBLE.
- On the map, transient units appear at their AO during the turn (when detected by at least one enemy unit). Clicking shows hexes operated over + flight path in transparent red.

### Tiers 4-6 (Operational through Theater): All Transient

All air units (including helicopters) are transient at these scales. At operational scale (12-48hr turns), even helicopters complete multiple sortie cycles per turn. Sortie generation rate is the key constraint.

### Airfield Mechanics

| Airfield Type | Capacity | Fixed-Wing? | Helicopter? | Notes |
|---------------|----------|-------------|-------------|-------|
| **Grass strip / FARP** | 1-2 units | Light aircraft only | Yes | Can be set up by engineers |
| **Regional airfield** | 3-4 units | Yes (tactical) | Yes | Common on maps |
| **Major airbase** | 6-8 units | Yes (all types) | Yes | Strategic target |
| **International airport** | 8-12 units | Yes (all types) | Yes | Highest capacity |
| **Aircraft carrier** | Per carrier template | Yes (carrier-qualified) | Yes | Mobile airfield — see below |

Airfields can be:
- **Damaged** by enemy strikes (reducing capacity and increasing sortie turnaround time)
- **Captured** by ground forces (denied until repaired)
- **Built/improved** by engineer units (ENGINEER order at airfield hex)
- **Destroyed** by sustained bombardment (requires rebuild)

### Off-Screen Airport (Tier 1-3)

**Checkbox in SimSetup** for tier 1-3 scenarios: "Off-Screen Airbase Available"

When enabled:
- Fixed-wing aircraft can base at an off-map airfield with unlimited capacity
- Configurable transit distance: Near (~25km), Medium (~100km), Far (~250km)
- Transit distance consumes fuel/time — reducing available on-station time and sorties
- Off-map aircraft arrive with fuel already partially depleted proportional to transit distance
- Translates to: reduced CAS sector coverage, fewer targets engaged, or fewer available sorties
- Off-map base cannot be attacked or captured (it's off the map)

### Rebasing

Moving an air unit from one airfield to another (including to/from off-map) requires **one full sortie** dedicated to the rebase. No combat missions during the rebase sortie. The flight path is computed for AD exposure (rebasing aircraft are vulnerable in transit).

### Carrier-Based Aviation

Aircraft carriers function as mobile airfields using the existing **transport/cargo system**:

- Carrier air squadrons are stored in the carrier's Cargo/inventory
- Their `baseHex` = carrier's current position (updates when carrier moves)
- Squadrons fly missions from the carrier's hex and return — they do NOT use DISEMBARK
- Carrier capacity limits how many squadrons can base there (from carrier template)
- **If the carrier is destroyed, all embarked squadrons are destroyed** (existing transport fate-sharing rule)
- Carrier must be modeled as individual squadrons (fighter, strike, ASW) in the carrier's inventory — not a single composite unit. This allows the player to assign different missions to different squadron types.

---

## Fuel & Bingo System

### Persistent Aircraft (Tier 3 Helicopters)

Fuel tracked as a 0-100 resource, decreasing with time in the air and distance flown.

**Fuel consumption:**
- Each turn in the air: fuel decreases by a fixed amount based on aircraft type (helicopter ~25-35 per turn at tier 3 with 4hr default turns)
- This gives ~2-3 turns of operations before RTB, realistic for most helicopters (4-8 hours endurance)
- Combat maneuvers (CAS, evasion) consume additional fuel

**Bingo fuel:**
- `bingo` = minimum fuel required to return to the nearest friendly airfield/FARP via most direct path
- Computed each turn by the orderComputer based on current position and airfield locations
- When `fuel ≤ bingo + one turn's consumption`: **unit card displays warning** — "Returning to base at end of next turn"

**Forced RTB sequence:**
1. Turn before bingo: unit card warns, player can only input MOVE and altitude orders (no combat missions)
2. Just before adjudication: the unit executes any final movement/altitude orders
3. Then the unit automatically flies the most direct path back to base
4. The orderComputer traces this entire sequence (final moves + RTB path) through AD coverage
5. The complete flight is sent to the LLM as context — "Helicopter RTB via [path], passing through [AD threat]"
6. If the helicopter is shot down during RTB, the LLM narrates it

**If fuel reaches 0 before reaching base:** Emergency landing at current hex. Unit is combat ineffective, grounded until resupplied by a logistics unit or captured by the enemy.

### Transient Aircraft Fuel

Transient fixed-wing aircraft don't track fuel as a persistent field (they RTB to base each sortie). Instead, fuel affects them through:

- **Range radius:** missions beyond fuel range are IMPOSSIBLE
- **Off-map transit penalty:** off-screen based aircraft arrive with reduced fuel → fewer sorties, reduced on-station time
- **On-station time:** computed by orderComputer as `(total fuel - transit fuel) / consumption rate`. Shorter on-station time = smaller effective CAS sector or fewer targets engaged.

---

## Air Unit State Tracking

### New Unit Fields for Air Units

| Field | Tiers | Range | Description |
|-------|-------|-------|-------------|
| `readiness` | 3-6 | 0-100 | Overall operational readiness. Degrades with missions and combat damage. Recovers during rest. |
| `fuel` | 3 (persistent only) | 0-100 | Fuel state for persistent helicopter units. 0 = grounded. |
| `munitions` | 3-4 | 0-100 | Weapons/ordnance available. Depleted by CAS, strike, and air combat. Replenished at airfield. |
| `sorties` | 4-6 | integer | Sortie count available this turn. Based on readiness, airfield capacity, and turn duration. |

### Readiness Mechanics

- Starts at 100 (fully operational)
- Each mission costs readiness: CAS -10, AIR_SUPERIORITY -5, SEAD -15, STRATEGIC_STRIKE -10, ESCORT -5
- Combat damage reduces readiness further (proportional to strength loss)
- Below **50 readiness**: mission effectiveness degraded (LLM anchor — fewer aircraft mission-capable, tired pilots)
- Below **25 readiness**: unit effectively grounded for maintenance (emergency missions only)
- Recovery: +15 per turn at functional airfield, +5 at damaged airfield, +0 without airfield
- Unused sorties count as rest periods and contribute +5 readiness bonus each

### Sortie Computation (Tier 4+)

```
sorties = floor(readiness / 20) × turnDurationMultiplier
```

Turn duration multipliers:
- 12hr = 1×
- 24hr = 2×
- 48hr = 3×
- 1 week = 7×

Airfield damage applies a multiplier reduction (damaged airfield = 0.5× sorties).

---

## Waypoint & Flight Planning

### System Overview

For every air sortie, the player defines a flight plan using waypoints. Each waypoint is a hex on the map with an altitude selection.

**Sortie flight plan structure:**
```
{
  waypoints: [
    { hex: "A1", altitude: "medium" },   // takeoff / climb
    { hex: "C3", altitude: "low" },      // descend to avoid SAM radar
    { hex: "E5", altitude: "low" },      // CAS run (target sector)
    { hex: "C3", altitude: "medium" },   // egress / climb
  ],
  mission: "CAS",
  targetSector: ["E4", "E5", "F4", "F5"],
  altitudeProfile: "low"  // altitude in the AO
}
```

**Default behavior:** If no waypoints are set, the aircraft flies directly from base to the AO at the selected altitude, then directly back to base. This is the simplest path but may fly through AD coverage that waypoints could avoid.

### orderComputer Processing

For each waypoint segment, the orderComputer:
1. Traces the hex-by-hex path between waypoints
2. Checks AD coverage at the selected altitude for each hex along the path
3. Computes detection probability for the aircraft at that altitude (can enemy AD/radar see it?)
4. Produces a segment-by-segment threat assessment
5. Computes total fuel consumption for the full route
6. Validates that the route is within fuel range (round trip)

### Strategic Depth

Waypoints allow players to:
- Route around known SAM positions (fly through gaps in AD coverage)
- Use terrain masking (low altitude through valleys/mountains)
- Choose ingress corridors with minimal AD exposure
- Plan egress routes that avoid the same threats used for ingress (enemy may reposition)
- Vary altitude along the route to exploit weaknesses in the AD layering

---

## CAS Sector Model

### How CAS Targeting Works

1. Player selects a **3-5 hex sector** for the CAS mission
2. CAS aircraft operate over that sector during the turn
3. The aircraft **attack 2-3 enemy units** within the sector (at tier 3; scales with strength/sorties at higher tiers)
4. Target priority (computed by orderComputer, adjudicated by LLM):
   - **First priority:** Enemy units with ATTACK orders (blunting the enemy offensive)
   - **Second priority:** Enemy units defending against friendly attacks (softening defenders)
   - **Third priority:** Other enemy units in the sector (targets of opportunity)
5. At **modern era with precision weapons + good comms**, the player may get more direct control over targeting (select specific units rather than sector-random)
6. The randomness within the sector is realistic, especially for WW2 — pilots can't always find the specific target they want

### CAS Effect Per Target

The CAS modifier applies **only to engagements where CAS aircraft are actively attacking**, not as a blanket bonus across the front.

For each targeted enemy unit, the LLM receives:
```
CAS attack on [Enemy Unit] in sector [hexes]:
- Aircraft: [unit name], strength [X]%, altitude [LOW]
- Target type: [armor in open / infantry in forest / etc.]
- AD threat in sector: [computed threat level]
- ASL in sector: [CONTESTED]
- Weather: [CLEAR]
- Era: [WW2 / unguided weapons]
- Suggested effectiveness: ~1.2x modifier to supported friendly engagement
```

---

## Escort System

### Escort as a Sortie Type

ESCORT is a dedicated sortie assignment for fighter or multirole aircraft.

**How it works:**
1. Player opens a fighter/multirole unit's card
2. Clicks **"Add Sortie"** → selects **ESCORT** mission type
3. System displays a list of **all friendly air units in range** for that actor
4. Player selects the unit to escort
5. The escort fighter flies with the escorted unit on **all of its sorties that turn**
6. The escort fighter's sortie is consumed for the turn (one escort assignment = one sortie spent)

**Range validation:** The escort fighter must be able to reach the escorted unit's AO from its own base. The orderComputer validates this — if the escort's range doesn't cover the escorted unit's mission area, the assignment is flagged as IMPOSSIBLE.

**Units at separate airbases can escort each other** — this is common historically (fighter escorts from one airfield supporting bombers from another). The escort joins the strike package in flight.

### Escort Effects on Interception

When an escorted package is intercepted:

1. **Catch phase:** Escort does not reduce catch probability (the package is still detectable). But escort presence means the interceptor must engage the escort first.
2. **Escort engagement:** A sub-computation determines the escort vs. interceptor result:
   - Escort wins decisively → interceptor driven off, CAS continues unimpeded
   - Escort engaged → both escort and interceptor take losses, CAS continues (escort may be weakened for subsequent sorties)
   - Interceptor breaks through → proceed to interdiction score against CAS, but at reduced interceptor effectiveness
3. **Net effect:** Escort dramatically reduces the chance of CAS being disrupted. This is why fighter escort was historically the critical enabler for bomber/CAS operations.

---

## Interdiction & Supply Effects

### Hybrid Model (Mechanical Suggestion + LLM Final Say)

**Step 1:** Player assigns air units to INTERDICTION missions targeting specific hexes (road/rail junctions, bridges, supply routes).

**Step 2:** orderComputer traces supply routes (existing supply network, tier 3+) and computes:
```
Interdiction Assessment:
- Hex E4 interdicted by [unit] at [altitude]
- Supply routes affected: Route A (HQ-Alpha to Bn-1), Route B (HQ-Alpha to Bn-3)
- Computed supply reduction: ~30% throughput for affected routes
- AD threat to interdicting aircraft: MODERATE (1× SHORAD in adjacent hex)
```

**Step 3:** LLM adjudicates final effect — did the interdiction aircraft survive AD? How effective was the interdiction? Narrative consequences (bridge destroyed? road cratered?).

### Interdiction Effectiveness by Target

| Target | Effect | Duration |
|--------|--------|----------|
| **Road junction** | Delays movement, reduces supply flow | 1 turn (repairable) |
| **Bridge** | Blocks river crossing, major supply disruption | 2-3 turns (engineering required) |
| **Rail line** | Disrupts strategic supply | 1-2 turns at operational+ |
| **Supply dump** | Destroys supply points directly | Permanent loss |
| **Troop concentration** | Direct attrition + morale damage | Immediate |

---

## Scale-Specific Rules

### Tier 1-2 (Sub-Tactical / Tactical): Air as External Support

Air units do not appear as player-controlled units. Air effects appear as:
- **Friction events**: "CAS flight arrives on station" (positive event granting fire support)
- **Scenario-defined support**: Pre-planned air strikes as timed events
- **Forward observer requests**: Narrative element via LLM

### Tier 3 (Grand Tactical, 2-5km hex, 2-8hr turns)

- **Helicopters**: Persistent, fuel-tracked, RTB every 2-3 turns
- **Fixed-wing**: Transient, 1 sortie per turn typical
- **Air orders**: CAS, AIR_SUPERIORITY, AIR_RECON, CAP, ESCORT
- **AD interaction**: Tactical, per-engagement
- **ASL**: Per hex or small group of hexes
- **Key constraint**: Turn duration limits fixed-wing to 1-2 sorties max
- **Anchor**: "A 4-ship flight delivers ~4-8 PGMs or ~2 gun runs per sortie."

### Tier 4 (Operational, 5-10km hex, 12-48hr turns)

- **All air units transient**
- **All air orders available** (CAS, AIR_SUPERIORITY, INTERDICTION, SEAD, AIRLIFT, AIR_RECON, CAP, ESCORT)
- **Sortie tracking**: 2-6 sorties per 24hr for fighters
- **ASL**: Per sector (3-5 hex radius)
- **Interdiction**: Mechanically affects supply network
- **SEAD**: Distinct operation, prerequisite for other missions in high-AD environments
- **Anchor**: "Fighter squadron generates ~20-40 sorties/day. Attrition 1-3% per contested mission."

### Tier 5 (Strategic, 10-20km hex, 2-7 day turns)

- **Air units represent wings**
- **All orders plus STRATEGIC_STRIKE**
- **ASL**: Theater-wide or front-wide
- **Strategic bombing**: Cumulative multi-turn effects on enemy capacity
- **Anchor**: "Air wing sustains ~100-200 sorties/day. Strategic bombing degrades output 1-3%/week/wing."

### Tier 6 (Theater, 20km+ hex, 1wk-1mo turns)

- **Air forces as national assets**
- **ASL**: Theater-level, determined at start of turn
- **Air campaigns fully abstracted**: Player allocates air effort as percentages (40% air superiority, 30% interdiction, 20% CAS, 10% strategic)
- **Anchor**: "Theater air campaign vs peer: 2-4 turns to achieve air superiority."

---

## Era-Specific Considerations

### WW1

**Aircraft:**
- No precision weapons, very limited bomb loads, guns only for air combat
- Visual identification only — all detection is visual-range
- Very short range (~50-100km combat radius), very fragile (fabric + wood)
- Pilot quality is THE dominant factor — experienced aces vs. green pilots shifts outcomes dramatically
- Weather almost totally grounds operations (open cockpits, no instruments)
- Air superiority is about enabling/denying OBSERVATION, not ground attack

**Air defense:**
- Gun-based only (adapted field guns, dedicated AA mounts late war)
- No radar, no guided missiles
- Volume of fire from concentrated positions creates kill zones

**Observation balloons:**
- `movementType: "static"` — tethered, cannot move
- Massive detection bonus (~15-20km observation range — like a stationary recon platform)
- Zero offensive capability
- Extremely vulnerable to fighter attack (fabric + hydrogen = one incendiary round)
- Can be "lowered" (DEFEND order = winched down, safe but no observation)
- Protected by nearby gun AD and fighter CAP
- Relevant at tiers 2-4

**Templates needed:** Observation Aircraft, Fighter, Bomber (late war only), Observation Balloon

### WW2

**Aircraft:**
- No precision weapons (all unguided bombs, rockets, guns)
- Visual identification required — CAS needs LOW altitude for target ID
- High-altitude bombing = area/carpet bombing (effective against cities/industry, poor against tactical targets)
- Pilot quality matters enormously
- Fighter-bomber dual-role is common (P-47, Fw-190)
- Strategic bombing doctrine: daylight precision (USAAF) vs. night area (RAF)

**Air defense:**
- Gun-based dominant (Bofors, Flak 88, Oerlikon)
- Radar-directed flak appears mid-war (significant effectiveness increase)
- No guided missiles, no SEAD doctrine
- AA suppression only by direct attack or artillery

**Templates to add:** Fighter-Bomber (P-47/Fw-190 dual-role), Night Fighter (Bf-110G, Mosquito NF)
**Template modifications:** `ww2_anti_aircraft` → add `gun_ad`

### Cold War

**Aircraft:**
- Early precision weapons appear (Paveway LGB, Maverick)
- BVR missiles exist but unreliable early (AIM-7 Sparrow ~10-30% Pk in Vietnam)
- Guns still critical for air combat (early missiles unreliable)
- CAS doctrine formalizes (FAC, kill boxes, FSCLs)
- Attack helicopters become primary anti-armor system
- Nuclear delivery capability complicates air operations
- Late Cold War: missiles become reliable, BVR becomes primary engagement mode

**Air defense:**
- SAM revolution: SA-2, SA-3, SA-6, Hawk, Patriot
- Integrated Air Defense Systems (IADS) link radars and launchers
- MANPADS appear (SA-7, Stinger)
- Gun + missile integrated (ZSU-23-4 + SA-6 in divisional AD)
- SEAD doctrine developed (Wild Weasel, Iron Hand, HARM)

**Templates to add:** SEAD / Wild Weasel (F-4G, Tornado ECR), EW / ECM Aircraft (EA-6B, EF-111), Fighter-Bomber / Multirole
**Template modifications:** `cw_shorad` → add `gun_ad`, `ir_missile_ad`; `cw_medium_ad` → add `radar_missile_ad`

### Modern

**Aircraft:**
- Precision weapons dominant (JDAM, SDB, Paveway IV, Brimstone)
- Stealth significantly shifts air superiority dynamics
- BVR is primary air combat modality
- UAS provide persistent ISR and strike
- Loitering munitions blur the line between missile and drone
- Standoff weapons allow attacks from outside AD envelopes (JASSM, Storm Shadow)
- High-altitude CAS viable with precision weapons

**Air defense:**
- Multi-layered IADS (S-400 + Buk + Tor + Pantsir + MANPADS)
- Counter-UAS as a distinct mission (EW jamming, gun AD, directed energy)
- Mobile SAMs use shoot-and-scoot doctrine (harder to find and target)
- Ballistic missile defense overlaps with AD (Patriot PAC-3, S-400)

**Templates to add:** EW Aircraft (EA-18G Growler), Loitering Munition (Switchblade, Lancet, Shahed — expended as ammo, see below), Counter-UAS System, Standoff Strike (B-1B, Tu-160), ISR Platform (Global Hawk, JSTARS)
**Template modifications:** `mod_shorad` → add `gun_ad`, `ir_missile_ad`, `counter_uas`; `mod_medium_ad` → add `radar_missile_ad`; `mod_long_range_ad` → add `radar_missile_ad`

### Loitering Munitions (Modern Era)

Modeled as **ammunition expended by specialist drone units**, not as standalone air units.

- **Heavy loitering munitions** (Shahed-136, Lancet-3): larger warhead, longer range, one-way attack drones. Consumed from unit's `munitions` pool.
- **Light loitering munitions** (FPV drones, Switchblade 300): small warhead, short range, expendable. Consumed from unit's `munitions` pool.
- Drone units track `munitions` (0-100) representing their loitering munition inventory
- Each strike mission depletes munitions; when munitions reach 0, the unit must resupply
- The unit itself (operators, control systems, launch platforms) persists — only the munitions are expended

---

## Friction Events

### New Air-Specific Events

| Event ID | Name | Tiers | Positive? | Requirements | Description |
|----------|------|-------|-----------|--------------|-------------|
| `cas_fratricide_risk` | Fratricide Risk | 3-5 | No | CAS + friendlies adjacent to target | CAS risks hitting friendly troops |
| `aircraft_mechanical_abort` | Mechanical Abort | 3-6 | No | Air unit on mission | Mission aborted, readiness -10 |
| `pilot_exceptional_skill` | Exceptional Airmanship | 3-5 | Yes | Air unit in combat | Enhanced mission outcome |
| `ad_radar_malfunction` | AD Radar Failure | 3-5 | Yes (for attacker) | Enemy `radar_missile_ad` unit | Gap in AD coverage |
| `weather_window` | Weather Window | 3-6 | Yes | Weather overcast/storm | Brief clearing improves air ops |
| `airfield_attack` | Airfield Under Attack | 4-6 | No | Airfield in enemy strike range | Airfield damaged, reduced capacity/sorties |
| `drone_feed_intelligence` | Drone Intelligence | 3-6 | Yes | `drone_equipped` unit | UAS reveals enemy detection |
| `sam_ambush` | SAM Ambush | 3-5 | No | Air unit near concealed AD | Concealed SAM fires without warning |
| `mid_air_refueling` | Aerial Refueling | 4-6 | Yes | Modern era, extreme range | Extends mission to otherwise-unreachable target |
| `electronic_interference` | Electronic Interference | 4-6 | No | Modern/Cold War | CAS effectiveness reduced by jamming |
| `ordnance_malfunction` | Ordnance Malfunction | 3-5 | No | Air unit on strike mission | Weapons hang/guidance fail, reduced strike |
| `balloon_shoot_down` | Balloon Destroyed | 2-4 | No (for owner) | Observation balloon present | Enemy fighter destroys observation balloon |

---

## LLM Prompt Doctrine

### Air Operations Doctrine Section

New section added to `buildSystemPrompt()` at tier 3+, structured identically to the Naval & Amphibious Doctrine section. Covers:

1. **Altitude and survivability** — LOW/MEDIUM/HIGH tradeoffs, speed vs gun AD effectiveness
2. **Air superiority** — ASL enables operations, not a direct multiplier; CAS provides ground effect
3. **Close air support** — sector-based targeting, fratricide risk, target type effectiveness, era-dependent accuracy
4. **Air defense interaction** — gun/IR/radar AD types, altitude effectiveness, SEAD prerequisites
5. **Helicopter doctrine** — terrain following, ATGM engagement, fuel limitations, MANPADS vulnerability
6. **Interception results** — LLM receives computed catch/interdiction results, narrates them
7. **Sortie sustainability** — readiness degradation, airfield dependency, force management
8. **Weather effects** — clear/overcast/storm/fog impact on operations
9. **Drone/UAS doctrine** (modern) — persistent ISR, loitering munitions as ammo, counter-UAS
10. **WW1 air doctrine** (when applicable) — observation dominance, air-as-intelligence

### Scale-Specific Resolution Guidance Additions

Added to existing `RESOLUTION_GUIDANCE` per tier:

- **Tier 3:** "CAS from a 4-ship flight provides ~1.2-1.3x modifier. Attack helicopter pair can destroy 4-8 armored targets per sortie."
- **Tier 4:** "Squadron interdiction reduces supply throughput ~20-40%. Air superiority campaign takes 2-4 turns vs peer AD. Full squadron CAS provides ~1.3-1.5x."
- **Tier 5:** "Strategic air campaign degrades enemy output 1-3%/week/wing. Theater air superiority vs peer: 1-3 turns. Airlift moves ~1 brigade/week."

---

## New Unit Templates & Attributes

### airProfile Addition to All Air Templates

Every air template gets an `airProfile` object:

```js
airProfile: {
  speed: "slow" | "medium" | "fast" | "supersonic",
  maneuverability: 1-10,
  weaponsPackage: ["guns"],                    // WW1 fighter
  // or: ["guns", "ir_missiles", "radar_missiles"], // Cold War fighter
  // or: ["guns", "ir_missiles", "bvr_missiles"],   // Modern fighter
  defensiveArmament: false,
  ecm: false,
  radarEquipped: false,
}
```

### New Templates by Era

| Template | Era | baseType | airProfile Speed | Key Capabilities |
|----------|-----|----------|-----------------|-----------------|
| Observation Balloon | WW1 | air | static | observation, tethered |
| Observation Aircraft | WW1 | air | slow | deep_reconnaissance, defensiveArmament |
| WW1 Fighter | WW1 | air | slow | air_superiority, guns only |
| WW1 Bomber | WW1 | air | slow | strategic_bombing (very limited) |
| Fighter-Bomber | WW2 | air | medium | air_superiority, close_air_support |
| Night Fighter | WW2 | air | medium | air_superiority, radarEquipped |
| Wild Weasel / SEAD | Cold War | air | fast | sead_capable, precision_strike |
| EW / ECM Aircraft | Cold War | air | fast | jamming, sigint, ecm |
| EW Aircraft | Modern | air | fast | jamming, sigint, sead_capable, ecm |
| Loitering Munition Unit | Modern | air | slow | drone_equipped, precision_strike |
| Counter-UAS System | Modern | air_defense | N/A | gun_ad, counter_uas |
| ISR Platform | Modern | air | slow/medium | drone_equipped, deep_reconnaissance |
| Standoff Strike | Modern | air | fast | precision_strike, strategic_bombing, standoff_strike |

### AD Template Capability Updates

| Template | Add Capabilities |
|----------|-----------------|
| `ww2_anti_aircraft` | `gun_ad` |
| `cw_shorad` | `gun_ad`, `ir_missile_ad` |
| `cw_medium_ad` | `radar_missile_ad` |
| `mod_shorad` | `gun_ad`, `ir_missile_ad`, `counter_uas` |
| `mod_medium_ad` | `radar_missile_ad` |
| `mod_long_range_ad` | `radar_missile_ad` |

### New specialCapabilities

| Capability | Description |
|-----------|-------------|
| `gun_ad` | Gun-based air defense. Effective vs low/slow. Not suppressible by HARM. |
| `ir_missile_ad` | IR-guided missile AD. Effective vs low-medium. Resistant to radar SEAD. |
| `radar_missile_ad` | Radar-guided missile AD. Effective vs medium-high. Vulnerable to SEAD. |
| `sead_capable` | Can perform SEAD missions (anti-radiation missiles or EW). |
| `counter_uas` | Effective against drones and loitering munitions. |
| `standoff_strike` | Can launch weapons from outside AD engagement envelope. |
| `all_weather` | Reduced weather penalties (radar bombing, all-weather sensors). |
| `stealth` | Significantly reduced radar detection. BVR and SEAD survivability advantage. |
| `bvr_capable` | Beyond-visual-range air combat (radar + medium/long-range missiles). |
| `tethered` | Cannot move. Static observation platform (balloons). |
| `observation` | Provides detection bonus over large area. Primary role is intelligence. |

---

## Resolved Design Decisions

| Decision | Resolution |
|----------|-----------|
| Air unit persistence | Tier 3: helos persistent, fixed-wing transient. Tier 4-6: all transient. |
| Airfield/basing | Hard constraint — capacity, sortie generation, attackable/destroyable. |
| Air-to-air resolution | Mechanical two-phase (catch → interdiction score). LLM narrates results. |
| Interdiction supply effects | Mechanical suggestion, LLM final say. |
| State tracking | Readiness + fuel (persistent only) + munitions + sorties (tier-scaled). |
| CAS targeting | 3-5 hex sector, 2-3 enemy targets, priority: units with attack orders. |
| Escort | Sortie type. Select friendly air unit to escort. Fighter escorts on all sorties that turn. |
| FAC requirement | Not required for now. May add later as optional rule. |
| Loitering munitions | Ammo expended by drone units. Heavy (Shahed) and light (FPV) types. |
| Embarkation timing | Tier 4-6: costs one sortie. Tier 2-3: can embark + move same turn with reduced range. |
| Off-screen airport | SimSetup checkbox (tier 1-3). Configurable transit distance. Unlimited capacity. |
| Rebasing | Costs one full sortie. No combat during rebase. Flight path computed for AD exposure. |
| Carrier air | Individual squadrons in carrier's cargo/inventory. Carrier = mobile airfield. |
| Air detection | Altitude-based detection ranges. Transient units appear on map at AO when detected. |
| Multi-sortie ordering | "Add Sortie" button with remaining count. Each sortie configured independently. Unused = rest. |
| Altitude for helicopters | Default LOW, can select MEDIUM, locked out of HIGH. |
| Gun AD vs fast jets at low | Low effectiveness. Speed attribute on templates determines gun AD interaction. |
| Waypoint planning | Players plan waypoints with altitude at each. Default = direct path. AD computed per segment. |

---

## Execution Phases

### Phase 1: Data Foundation

**Goal:** Establish the data model so all subsequent phases have the right schema to build on.

**Deliverables:**
- Add `airProfile` object to all air templates in `eraTemplates.js` (speed, maneuverability, weaponsPackage, defensiveArmament, ecm, radarEquipped)
- Add AD categorization capabilities (`gun_ad`, `ir_missile_ad`, `radar_missile_ad`) to all AD templates
- Add new `specialCapabilities` values to schema
- Add air-specific unit fields to `getUnitFieldsForScale()` in `schemas.js` (readiness, fuel, munitions, sorties — tier-conditional)
- Add new air order types to `orderTypes.js` (CAS, AIR_SUPERIORITY, INTERDICTION, SEAD, STRATEGIC_STRIKE, AIRLIFT, AIR_RECON, CAP, ESCORT)
- Add order validity matrix entries for air units
- Add order compatibility matrix entries for new air orders
- Add `altitudeProfile` field to order schema
- Add `baseHex` field to air unit schema
- Add WW1 era templates (Observation Balloon, Observation Aircraft, Fighter, Bomber)
- Add missing templates for other eras (Fighter-Bomber, Night Fighter, Wild Weasel, EW Aircraft, etc.)

**No UI or computation changes.** This is pure schema/data work.

### Phase 2: LLM Air Doctrine

**Goal:** Immediately improve how the LLM handles air units by adding dedicated doctrine to the system prompt. This phase delivers value even before mechanical systems are built — the LLM will adjudicate air operations far better with doctrine guidance.

**Deliverables:**
- Add Air Operations Doctrine section to `buildSystemPrompt()` in `prompts.js` (parallel to Naval & Amphibious Doctrine)
- Add scale-specific air resolution guidance to `RESOLUTION_GUIDANCE` per tier
- Add era-specific air anchors (WW1 observation dominance, WW2 unguided, Cold War transition, modern precision)
- Add new air friction events to `frictionEvents.js`
- Update scale declarations to reference air operations appropriately per tier
- Add altitude/AD interaction guidance to prompts
- Add CAS sector model guidance to prompts
- Add air superiority two-layer model explanation to prompts

**No mechanical computation.** The LLM uses the doctrine qualitatively until Phase 3 adds hard numbers.

### Phase 3: orderComputer — AD Threat & Air Superiority

**Goal:** Mechanical backbone. The orderComputer can now compute air-specific quantitative data and feed it to the LLM alongside existing ground combat computations.

**Deliverables:**
- AD engagement envelope computation: for each AD unit, compute coverage zone by type and altitude effectiveness
- Flight path AD threat assessment: given a path (direct or waypoint-based) and altitude per segment, compute per-segment threat level
- Aircraft speed vs gun AD cross-reference: fast jets at low = reduced gun threat
- Air Superiority Level computation per sector: sum air-capable units per side in sector, compute ratio, output ASL
- CAS sector target identification: identify enemy units in CAS sector, compute priority order
- CAS effectiveness modifier computation: based on aircraft strength, ASL, altitude, AD threat, weather, era
- Pre-compute air-specific data in the order bundle sent to LLM

### Phase 4: Air-to-Air Interception Mechanics

**Goal:** Server-side computation of interception outcomes so the LLM receives clean results, not raw factors.

**Deliverables:**
- Implement catch/no-catch binary computation using detection, relative speed, distance, fuel, fortune roll
- Implement interdiction score computation (1-100) using airProfile attributes from both sides
- Implement escort sub-computation (escort engagement before CAS is threatened)
- Format interception results for LLM consumption ("Caught, interdiction score 67, CAS effectiveness halved")
- Implement loss computation for both interceptor and target (within bounds from Phase 3)
- Integrate with order bundle — interception results attached to affected CAS/strike orders

### Phase 5: Basing, Fuel & Readiness

**Goal:** Air logistics layer — airfields, fuel, readiness, sortie generation.

**Deliverables:**
- Airfield capacity system: map airfield features to capacity values, track current usage
- Fuel tracking for persistent helicopter units (tier 3): consumption per turn, bingo computation, forced RTB sequence
- Readiness system: degradation per mission type, recovery per turn (airfield-dependent), effectiveness thresholds
- Munitions tracking (tier 3-4): depletion per strike mission, replenishment at airfield
- Sortie generation computation (tier 4+): readiness × turn duration × airfield modifier
- Off-screen airport: SimSetup checkbox, transit distance config, fuel/sortie penalty computation
- Rebase sortie: validate route, compute AD exposure, consume one sortie
- Carrier integration: carrier inventory holds squadrons, baseHex tracks carrier position, capacity enforcement

### Phase 6: Waypoint System & Flight Planning

**Goal:** The advanced planning layer that gives players tactical control over flight routing.

**Deliverables:**
- Waypoint data structure on sortie orders (array of hex + altitude pairs)
- orderComputer integration: trace waypoints segment by segment through AD coverage
- Fuel consumption computation along full waypoint route (validate round-trip feasibility)
- Default path generation (direct to AO and back) when no waypoints set
- On-station time computation based on fuel remaining after transit
- Off-map transit segment computation for off-screen based aircraft

### Phase 7: UI — Air Unit Cards & Sortie Planning

**Goal:** Player-facing interface for air operations.

**Deliverables:**
- Air unit card redesign: show readiness, fuel, munitions, sorties remaining, baseHex
- "Add Sortie" button with remaining sortie count, planned sorties list below
- Click planned sortie to modify/cancel
- Mission type selector with altitude profile dropdown
- CAS sector selection mode on map (click to define 3-5 hex area)
- Escort assignment: mission type → shows list of friendly air units in range
- Fuel/bingo warning display on unit card ("Returning to base next turn")
- Rest sortie option
- Embarkation controls for air transport

### Phase 8: UI — Map Visualization

**Goal:** Visual layer for air operations on the map.

**Deliverables:**
- Waypoint editor on map: click to add waypoints, altitude selector at each point
- Flight path visualization: transparent red overlay showing planned ingress/egress route
- Transient unit display: air unit token at AO hex during turn (when detected)
- Click transient unit → overlay showing hexes operated over + flight path
- AD coverage overlay (optional toggle): show gun/SAM engagement envelopes as shaded zones
- CAS sector highlight on map
- Air superiority level indicator per sector (optional toggle)

---

## Engineering Scope Note

This is a large system — essentially a second game layer on top of the ground system. The phases are ordered so that each delivers standalone value:

- **After Phase 1-2**: Air units work much better with the LLM (doctrine guidance), even without mechanics
- **After Phase 3-4**: Air operations are mechanically computed and produce realistic results
- **After Phase 5**: Air logistics create real strategic constraints (fuel, readiness, basing)
- **After Phase 6-8**: Full player control with waypoint planning and rich visualization

Phases 1-2 can be built relatively quickly (schema + prompt changes, no complex computation). Phases 3-4 are the heaviest engineering (orderComputer extensions, interception math). Phases 5-6 are moderate (state tracking, waypoint pathing). Phases 7-8 are UI work that depends on all prior phases.

Estimated rough scope: Phase 1-2 is days of work. Phases 3-4 are weeks. Phases 5-8 are additional weeks. Total system is a substantial multi-month effort if done end-to-end.
