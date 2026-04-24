# Tactical Awareness System — Design Brainstorm

## Context
10-turn all-AI test game revealed the AI doesn't understand WHERE things are happening on the map. It defaults to 80-88% HOLD because it has no spatial awareness of threats, opportunities, force balance, or objectives. We're designing computational systems to pre-compute tactical situation data and pass it to the AI each turn.

## Core Systems (Decided)
- **Victory Points (VP)**: Per-hex scoring. Actor-specific critical VP. Running score comparison each turn.
- **Operational Clock**: Turn X of Y, VP rate, projected outcome, "at current pace you LOSE/WIN" assessment.

## Threat/Opportunity Board — Options Under Discussion

### Option 1: Influence/Control Map
For every hex, compute which actor "controls" it based on proximity and strength of nearest units. Produces territory percentage, frontline hexes, penetration depth, uncontested zones.

**Ryan's notes:**
- Needs FOW pass — can't reveal info about undetected enemies
- Would need to program frontlines and areas of control per unit
- Would need a visual system to show hex control on the map
- Without FOW filtering, this leaks intelligence

### Option 2: Force Ratio Heatmap
Per-hex combat power projection. Sum friendly/enemy strength within radius, weighted by distance.

**Ryan's notes:**
- Should be ADDITIVE across space — two adjacent units generate more than sum of parts
- Example: each unit generates 3, decays by 1 per hex. Two side-by-side = 5 at center, 4 at 1 hex, 3 at 2 hexes. Three touching = 7/6/5.
- Max for surrounded unit = 15 (6 neighbors all friendly)
- Enemy units SUBTRACT from the heatmap
- Different unit types should have different "heat" values at different strengths
- Needs significant brainstorming to get the math right
- Essentially a "pressure map" showing where force is concentrated

### Option 3: VP Objective Threat Assessment
Per-VP-hex analysis: who's closer, what force each side has nearby, turns to reach.

**Ryan's notes:**
- Good as additive with other options
- FOW problem — can't tell the AI about enemy forces near a VP if those enemies aren't detected
- Data should respect detection tiers (only show what actor can see)
- Useful info the AI has from scenario start (VP locations, values)

### Option 4: Unit Exposure/Vulnerability Analysis
Per-unit assessment: enemies in range, flank coverage, isolation, terrain quality.

**Ryan's notes:**
- "Enemies in range" is super useful
- If the unit chooses to attack, that range info can be passed to the adjudicator for validation
- Direct link to the combat range enforcement fix

### Option 5: Approach Route Scoring
Movement-cost paths from units to VP hexes. Natural corridors, chokepoints, terrain costs.

**Ryan's notes:**
- Likes the weighted nature — finding chokepoints, higher VP totals weighted higher
- CONCERN: VP "attractor vortex" — if two units get close to a high-value VP, they could get stuck orbiting it instead of actually capturing it. Need to prevent units from endlessly maneuvering near a VP without committing.
- Info available from game start (terrain doesn't change much)

### Option 6: Sector-Based Situation Summary
Divide map into 3-4 sectors. Per-sector: force count, combat power, VP value, movement trend, assessment.

**Ryan's notes:**
- Good when based on zones of control / heatmaps
- Lets LLM know generally how much it controls per sector
- FOW pass needed
- CONCERN: just because you can't see enemies doesn't mean you have overwhelming force. Need to distinguish "I control this area" from "I don't see anyone here (but they might be there)"
- Absence of evidence ≠ evidence of absence

### Option 7: Defensive Line / Gap Detection
Find frontline, identify gaps where enemy could break through.

**Ryan's notes:**
- Should NOT be static distance-based
- Should incorporate: unit's current LOS range, movement range over local terrain (within ~5 hexes), weapon range, distance to visible enemies
- Example: on flat plains, if I can see 6 hexes, move 5/turn, shoot 1 hex, and no enemies visible within 6 hexes, then an ally 6 hexes away ISN'T a gap because I can close that distance in one turn
- On a mountain in fog, a 3-hex gap might be critical because I can only see 2 hexes and move 1/turn
- Gap definition is TERRAIN and WEATHER DEPENDENT
- This is essentially a "coverage zone" per unit based on reaction time

### Option 8: Combined Arms Pairing Detection
Identify which friendly units are paired (infantry+armor, ground+artillery) and which are fighting alone.

**No specific notes yet.**

---

## Cross-Cutting Concerns

### FOW (Fog of War) Filtering
Multiple options have the same problem: the analysis could reveal information the actor shouldn't have. Every computation that involves enemy positions must be filtered through the detection engine:
- IDENTIFIED enemies: include in analysis with full details
- CONTACT enemies: include as "unidentified hostile activity"
- UNDETECTED enemies: exclude entirely
- But: absence of detected enemies ≠ area is safe. Need language like "no detected threats" not "area is clear"

### VP Attractor Vortex (Option 5)
Risk that high-VP hexes become "gravity wells" where units orbit endlessly. Mitigation ideas:
- VP scoring only awards points for OCCUPYING the hex, not approaching it
- Operational clock creates urgency — "you need this VP by turn X, stop circling"
- Command critique can flag: "you've had units within 2 hexes of Ashbury for 3 turns without assaulting"

### Absence of Evidence Problem (Option 6)
In FOW games, the AI shouldn't assume an empty sector is safe just because it can't see enemies. Need to:
- Track "last scouted" timestamp per area
- Report confidence: "NORTH sector: no detected threats (last scouted: Turn 3, LOW confidence)"
- Maybe: "fog of war uncertainty" score per sector based on recon coverage

### Dynamic Gap Definition (Option 7)
Gap size threshold should be computed from:
- Visibility (weather × terrain × time of day × unit observer range)
- Reaction speed (movement budget × local terrain costs)
- Weapon range (can the unit engage an enemy crossing the gap?)
- Combined: "effective coverage radius" per unit = vis + move + range
- Gap exists when coverage circles don't overlap

---

## Research: How LLMs Process These Signals

From behavioral game theory research (Nature Scientific Reports, 2024; arxiv 2502.20432):
- LLMs respond strongly to numeric payoffs and competitive comparisons
- Narrative framing ("you are LOSING") is at least as powerful as numbers
- Advanced models use "substantially binary criteria" — complex multi-dimensional scores may get collapsed to good/bad
- Simple, clear signals outperform elaborate multi-factor scoring
- Reward hacking risk: if AI sees the scoring formula, it can game it
- Chain-of-thought prompting sometimes HURTS advanced models

**Implication:** The threat/opportunity board should present CONCLUSIONS not raw data. "ATTACK OPPORTUNITY at Ashbury, 2.4:1 local advantage" not a dump of force ratio numbers per hex.

---

## Status
Currently brainstorming. No implementation decisions made yet.
Need to resolve: FOW filtering approach, heatmap math, dynamic gap algorithm, VP vortex prevention.
