# RTS Blobbing Research

Date: 2026-04-22
Project: Open Conflict RTS alpha
Purpose: explain what is causing the current blob behavior, what mechanics tend to create blobbing in RTS/wargames, and what other games or doctrine use to reduce it.

## Executive Summary

Open Conflict's current blob behavior is being driven by three overlapping design patterns:

1. The AI is allowed to think in terms of a single decisive target, then issue nearly the same task to almost every owner.
2. The scoring model rewards exact objective occupancy more than local area control, so massing directly on or beside the VP is rational.
3. The combat and command systems are currently too fast relative to maneuver, which makes rapid refocusing and local dogpiling more attractive than deliberate echeloned movement.

Games that reduce blobbing usually do not solve it with one mechanic. They combine several:

- strong suppression and movement penalties in the open
- meaningful cover and flanking value
- area control rather than exact-point sitting
- command friction or order delay
- explicit staging roles such as assault, reserve, and fire support
- route congestion or frontage pressure
- stronger punishment for over-concentration from artillery, MGs, surrender, or zone denial

The most relevant external pattern for Open Conflict is not "make the AI smarter" in isolation. It is "make the battle grammar less favorable to one giant mass."

## What Is Causing The Blob In Open Conflict

This section is based on the internal audit, code inspection, and stock AI duel sampling.

### Single-target hierarchy

- The director typically selects one `targetHex`.
- The commander then hands that same objective or same visible contact to nearly every owner.
- Owner decomposition is too coarse to create true breadth.

Effect:

- The AI does not just prefer one decisive point. It lacks enough internal structure to do much else.

### Exact-hex victory logic

- Objectives are controlled by settled occupancy on the exact VP hex.
- There is no frontage, influence, or area-control model around the objective.

Effect:

- The shortest route to success is to pile force directly onto the point or the immediate blocking contact.

### Fast combat and recovery relative to slow maneuver

- Fire, suppression, replanning, and recovery happen far more often than movement segments complete.

Effect:

- The simulation rewards local concentration and rapid retargeting instead of patient shaping moves.

### No congestion, lane assignment, or frontage cost

- Pathfinding discounts roads and bridges but does not penalize friendly crowding.
- The commander does not assign lanes or supporting axes.

Effect:

- A blob gets the best route and pays almost no operational price until it physically collides with hex occupancy.

### No meaningful command delay

- Orders apply immediately once generated.
- The force can pivot fast.

Effect:

- The AI behaves like a very responsive deathball commander even in a slower maneuver model.

## What Other Games And Doctrine Do Differently

## 1. Company of Heroes: punish exposed concentration and reward flanking

Source:

- [Company of Heroes 2 manual](https://www.feralinteractive.com/en/manuals/companyofheroes2/latest/steam/)

Relevant mechanics:

- Cover materially changes vulnerability.
- Negative cover makes exposed troops more vulnerable.
- Suppression and pinning slow or stop infantry under sustained fire.
- Flanking nullifies directional cover and arcs.
- Combined arms is explicitly required rather than optional.

Why it matters:

- A blob moving in the open is easier to suppress, flank, and hit with grenades, mortars, and MGs.
- Strong cover plus strong suppression creates a large difference between "properly staged attack" and "everyone right-click forward."

Useful takeaway for Open Conflict:

- If moving in the open and bunching together are not dangerous enough, players and AI will accept massing because there is not enough downside.

## 2. Steel Division: capture by influence, not just by standing on a point

Sources:

- [Steel Division 2 manual](https://eugensystems.com/steel-division-2-game-manual/)
- [Steel Division: Normandy 44 - Realistic combat behavior](https://eugensystems.com/steel-division-normandy-44-gameplay-realistic-combat-behavior/)

Relevant mechanics:

- Capture points are owned when the frontline covers them.
- The frontline moves with unit influence rather than exact single-hex occupation.
- Suppression reduces effectiveness.
- Fully suppressed units can be forced to surrender when cut off in enemy influence.
- Units on the move are more vulnerable to suppression.
- Recon does not move the frontline, which prevents stealth scouting from functioning like free capture mass.

Why it matters:

- The game separates "local presence and control" from "literally stack on the exact objective marker."
- Concentration in motion is risky because moving units are easier to stress and stop.
- The surrender logic means overextended forward lumps can collapse hard if they lose support.

Useful takeaway for Open Conflict:

- If Open Conflict keeps exact-hex control but wants less blobbing, it needs some other very strong anti-mass mechanic.
- A more natural fix is to move toward area influence around objectives and stronger punishment for stressed or isolated units.

### Concentration is not punished hard enough once it forms

- Most combat pressure is still either single-target direct fire or modest artillery splash.
- The game has some suppression and artillery behavior, but not enough nonlinear downside for putting a lot of combat power into the same small local space.

Effect:

- Once a blob forms, it does not automatically become a high-risk posture.
- That means the AI can rationally keep using concentration as a default answer even when it should be doctrinally sloppy.

## 3. Command Ops 2: decomposed attacks, reorganization, reserve groups, and order delay

Sources:

- [Command Ops 2 Steam page](https://store.steampowered.com/app/521800/Command_Ops_2/)
- [Mirrored Command Ops 2 manual](https://device.report/m/20b0e6b1e1bb7fade2bda52c7268da00a4df83dee075b25bce88257068bdd55d)

Relevant mechanics:

- The game markets realistic command structure and orders delay as core features.
- Attacks are decomposed into assault, reserve, and fire-support groups.
- Forces move to a forming-up point, reorganize, then assault.
- The reserve stays near but out of the attack until needed.
- Orders delay means changing plans has a real timing cost.
- Frontage, depth, and facing are part of order shaping.

Why it matters:

- Command delay and attack staging make it hard to instant-pivot the whole force onto the newest shiny target.
- The game gives the player and AI an operational grammar richer than "everyone move to the point."

Useful takeaway for Open Conflict:

- Even a simplified command-delay layer plus owner-role decomposition would go a long way.
- You do not need full Command Ops complexity to get value from FUP-style staging, reserve identity, or delayed retasking.

## 4. Army doctrine: attacks are controlled by lanes, phase lines, support-by-fire, and mutual support

Sources:

- [FM 3-90 (2023)](https://rdl.train.army.mil/catalog-ws/view/100.ATSC/17614720-DF1D-40BE-9123-F80680BF3974-1274406509298/fm3_90.pdf)
- [Infantry Mission Command reference](https://www.benning.army.mil/Infantry/DoctrineSupplement/ATP3-21.8/chapter_04/section_06/page_0040/index.html)
- [FM 3-90-1 (2013) mutual support excerpt](https://www.benning.army.mil/infantry/DoctrineSupplement/ATP3-21.8/PDFs/fm3_90_1.pdf)

Relevant ideas:

- Leaders use attack positions, phase lines, PLDs, assault positions, support-by-fire positions, and attack-by-fire positions to control the final stage of the attack.
- Mutual support exists so one position cannot be attacked without fire from adjacent positions.
- Maintaining routes and alternate routes matters because key routes attract enemy fire and become critical movement problems.

Why it matters:

- Real-world maneuver doctrine does not treat an attack as one homogenous mass flowing at the objective.
- It deliberately creates roles, timing points, support relationships, and lateral spacing.

Useful takeaway for Open Conflict:

- The current AI is missing almost all of the control measures that keep real attacks from collapsing into blobs.

## 5. RTS movement work also shows that one shared destination naturally becomes one messy lane

Source:

- [Group Pathfinding & Movement in RTS Style Games](https://www.gamedeveloper.com/programming/group-pathfinding-movement-in-rts-style-games)

Relevant idea:

- When every unit receives the same destination and independently takes its own "best" route, units jockey into the same lane and movement looks messy or overly collapsed.
- A practical mitigation is to assign bespoke offset destinations rather than a single common endpoint for the whole group.

Why it matters:

- Open Conflict's current commander and subordinate logic behaves similarly at a higher layer:
  - many units receive the same task
  - that task usually carries the same `targetHex`
  - routing then independently finds the same efficient corridor

Useful takeaway for Open Conflict:

- Even before introducing full doctrine-style maneuver planning, simple owner-level lane offsets or per-group offset destinations would reduce same-axis collapse.

## Mechanics That Encourage Blobbing

Across the sources and the internal audit, the common blob drivers are:

- objectives defined as exact-point occupancy rather than area control
- low or missing cost for route crowding
- low punishment for moving in the open
- weak suppression or suppression that clears too quickly
- weak nonlinear punishment for concentrated targets
- no reserve identity or no cost to committing reserves immediately
- no command delay or no plan-commitment friction
- no need for support-by-fire, recon screen, or flank security
- pathfinding that happily packs units into one best corridor
- low artillery/AOE punishment for concentration
- detection or target selection that makes the nearest visible contact dominate all decision layers

## Mechanics That Reduce Blobbing

The most common anti-blob patterns are:

- cover that is meaningfully better than open movement
- negative cover or explicit open-ground penalties
- suppression and pinning that stop forward rushes
- artillery, MG, and AOE lethality that scales well against clustered targets
- area-control objectives rather than exact-stack objectives
- surrender, isolation, or cut-off penalties
- command delay or delayed replan cost
- explicit force decomposition into assault, reserve, and support groups
- frontage or spacing constraints
- offset destinations or lane assignments instead of one common endpoint
- traffic, bridge, or corridor congestion penalties
- flanking rewards that make a wide attack better than a dense one

## Strongest Fits For Open Conflict

These are the research-backed changes that best fit the current Open Conflict architecture.

### 1. Convert VP ownership from exact occupancy to local control

Why:

- This is the cleanest way to stop "sit the deathball exactly on the hex" behavior.

How:

- Score objectives based on uncontested friendly influence within a local radius.
- Require nearby support and local dominance, not exact stack placement.

Research fit:

- Closest to Steel Division's frontline-and-capture model.

### 2. Add strong open-ground and moving-under-fire penalties

Why:

- If movement in the open remains relatively safe, blobbing remains efficient.

How:

- Raise suppression while moving.
- Lower fire effectiveness when moving.
- Increase incoming damage or suppression in open/no-cover terrain.
- Make recovery slower while exposed.

Research fit:

- Closest to Company of Heroes cover/suppression logic and Steel Division moving-unit stress.

### 3. Introduce owner roles and attack staging

Why:

- Right now each owner mostly does the same thing.

How:

- Give owners roles like:
  - assault
  - support-by-fire
  - flank screen
  - reserve
  - exploitation
- Let support assets set up before the assault group closes.

Research fit:

- Closest to Command Ops 2 attack decomposition and doctrine support-by-fire / assault-position logic.

### 4. Add command friction instead of just smarter heuristics

Why:

- Smarter target choice alone will not fix mass retasking if instantaneous replans remain cheap.

How:

- Delay owner-task replacement.
- Require reorganization time before major attack changes.
- Add HQ effectiveness or range modifiers if you want more depth later.

Research fit:

- Closest to Command Ops 2 orders-delay model.

### 5. Make congestion and lane duplication expensive

Why:

- Roads and bridges currently concentrate movement without enough downside.

How:

- Add friendly congestion costs to route planning.
- Add bridge throughput penalties.
- Add per-owner lane reservations or "main/supporting axis" assignment.

Research fit:

- This is less explicit in the cited manuals but strongly implied by doctrine's emphasis on route control, support relationships, and attack control measures.

### 6. Keep reserves distinct after release

Why:

- Reserves should add depth, not just more density on the main axis.

How:

- Release reserves with explicit roles and constraints.
- Prefer counterattack, flank seal, or exploitation tasks before feeding them into the same owner lane.

Research fit:

- Closest to both Command Ops 2 reserve grouping and doctrine reserve employment.

## Recommended Design Direction

If the goal is to reduce blobbing without losing the accessible RTS feel, the best sequence is:

1. Rescale non-movement combat, recovery, and AI clocks.
2. Shift objective scoring from exact-hex occupation toward local influence.
3. Split force tasking into more owners and more roles.
4. Add command-friction or commitment timers.
5. Add congestion and frontage penalties.
6. Strengthen open-ground movement penalties and concentrated-target punishment.

That combination addresses both halves of the problem:

- why the AI wants one big blob
- why the simulation lets that blob work too well

## Sources

- Open Conflict codebase internal audit:
  - `src/rts/rtsEngine.js`
  - `src/rts/rtsStart.js`
  - `src/rts/RtsGame.jsx`
  - `src/simulation/aiProfiles.js`
  - `src/simulation/aiPathfinding.js`
  - `src/simulation/presets.js`
  - `src/testFixture.js`
  - `src/simulation/schemas.js`
- External references:
  - [Company of Heroes 2 manual](https://www.feralinteractive.com/en/manuals/companyofheroes2/latest/steam/)
  - [Steel Division 2 manual](https://eugensystems.com/steel-division-2-game-manual/)
  - [Steel Division: Normandy 44 - Realistic combat behavior](https://eugensystems.com/steel-division-normandy-44-gameplay-realistic-combat-behavior/)
- [Command Ops 2 Steam page](https://store.steampowered.com/app/521800/Command_Ops_2/)
- [Mirrored Command Ops 2 manual](https://device.report/m/20b0e6b1e1bb7fade2bda52c7268da00a4df83dee075b25bce88257068bdd55d)
- [Group Pathfinding & Movement in RTS Style Games](https://www.gamedeveloper.com/programming/group-pathfinding-movement-in-rts-style-games)
- [FM 3-90 (2023)](https://rdl.train.army.mil/catalog-ws/view/100.ATSC/17614720-DF1D-40BE-9123-F80680BF3974-1274406509298/fm3_90.pdf)
- [Infantry Mission Command reference](https://www.benning.army.mil/Infantry/DoctrineSupplement/ATP3-21.8/chapter_04/section_06/page_0040/index.html)
- [FM 3-90-1 (2013)](https://www.benning.army.mil/infantry/DoctrineSupplement/ATP3-21.8/PDFs/fm3_90_1.pdf)
