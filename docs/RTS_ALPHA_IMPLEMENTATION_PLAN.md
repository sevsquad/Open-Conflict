# RTS Alpha Implementation Plan

Date: 2026-04-22

## Purpose

This document turns the findings in `docs/RTS_LOCAL_AI_RESEARCH_REPORT.md` into a concrete single-developer implementation plan for a local-only playable RTS alpha inside `open-conflict`.

This plan preserves the core research conclusions:

- RTS should be a parallel mode, not a small extension of the current turn and PBEM runtime.
- The AI foundation should be a layered local stack:
  - optional director layer
  - commander brain
  - subordinate brains
  - unit executors
  - shared perception and tactical analysis services
- The existing simulation setup and scenario-building shell should be reused where practical.
- The current turn-adjudication runtime should not be stretched into a real-time engine.

## Locked Alpha Scope

These decisions are now treated as fixed unless a later design review changes them:

- Local-only play
- Cold War presets and content only
- Ground units plus helicopters only
- No off-map fixed wing for alpha
- Player directly controls units against AI hierarchy
- AI vs AI must also work
- Hex map remains the command language
- Time becomes continuous
- Visual motion becomes continuous between hexes
- Orders are still issued in hex terms
- Full fog of war and detection for both sides
- The director layer is exempt from fog of war
- Commander, subordinates, and unit executors are not exempt from fog of war
- Clear functional 2D or overlay presentation is acceptable for alpha
- Morale, suppression, retreat, shatter, and recovery are in-scope for alpha
- One unit per settled hex
- Temporary visual and simulation overlap is allowed while traveling between hexes

## Alpha Success Definition

The RTS alpha is successful when a developer can:

- launch RTS mode from its own tile on the main menu
- load a map into an RTS-oriented setup flow
- configure sides, AI, environment, victory conditions, and unit state
- place Cold War ground and helicopter units with full editable fields
- start a local real-time battle on the hex map
- issue unit commands in hex terms and watch units move between hexes over time
- see unit cards, live status, and readable combat or movement state
- fight under full fog of war
- play against a functioning AI commander hierarchy
- run AI vs AI for observation and tuning
- inspect enough debug information to prove the AI below the director is obeying fog of war

## Initial Checklist

Before implementation begins in earnest, the alpha should be tracked against this checklist:

- New `RTS` menu tile and route exist
- Shared setup flow can start either turn-based simulation or RTS mode
- RTS builder exposes full unit editing and RTS-specific side settings
- RTS runtime has its own scenario-to-match start contract
- Real-time loop exists and is deterministic at fixed tick rate
- Units can move, halt, attack, retreat, shatter, recover, and be destroyed
- Units can spot, be spotted, and fight while in transit
- Hex occupancy, path blocking, and replan rules are implemented
- Helicopters have movement, fuel, readiness, munitions, and AD threat interaction
- Live unit cards and map indicators exist
- Fog of war, last-known positions, and visibility toggle are working
- AI stack exists:
  - director
  - commander
  - subordinates
  - unit execution
- AI vs AI autoplay works
- Debug overlays and reasoning logs are usable
- At least two Cold War presets are RTS-ready and testable

## Explicit Non-Goals For Alpha

These items should be deferred unless they become necessary for the alpha to function:

- Live multiplayer
- Rollback, lockstep, or network authority work
- Off-map fixed wing missions
- Naval RTS play
- Commander mode for the human player
- Full freeform pathfinding divorced from the hex grid
- ML or RL-based commander logic
- High-fidelity 3D animation
- Campaign progression systems
- Save-compatible migration of old turn-based matches into RTS

## Current Repo Audit

## What We Can Reuse

### App and launcher shell

Useful existing assets:

- `src/App.jsx`
- `src/components/AppHeader.jsx`

What is already good:

- menu card pattern already exists
- mode routing is straightforward
- persistent non-menu header already exists

What must change:

- add a new `rts` mode
- add `RTS` tile, keyboard shortcut, and header metadata
- keep RTS separate from the turn-based `simulation` route

### Setup and scenario builder shell

Useful existing assets:

- `src/simulation/SimSetup.jsx`
- `src/simulation/SimSetupConfigure.jsx`
- `src/simulation/SetupLeftSidebar.jsx`
- `src/simulation/SetupRightSidebar.jsx`
- `src/simulation/SimMap.jsx`

What is already good:

- map select to configure flow already exists
- terrain loading and preset loading already exist
- map-centric scenario editing already exists
- unit palette and per-unit editing already exist
- era selection already exists
- command hierarchy fields already exist
- AI doctrine selection already exists

What must change:

- keep the shell, but branch the start contract for RTS
- remove or hide LLM-only configuration in RTS setup
- add RTS-specific settings and validation
- add one-unit-per-settled-hex validation for RTS
- add RTS scenario metadata, debug, and visibility options

### Rendering and map interaction shell

Useful existing assets:

- `src/mapRenderer/MapView.jsx`
- `src/mapRenderer/overlays/UnitOverlay.js`
- `src/mapRenderer/overlays/OrderOverlay.js`
- `src/simulation/SimMap.jsx`

What is already good:

- hex rendering already exists
- unit overlay already exists
- fog overlay already exists
- route previews and map interactions already exist

What must change:

- unit rendering currently snaps to settled hex positions
- no animation clock or interpolation layer exists
- combat and transit indicators are too turn-centric
- RTS needs live selection, command preview, state icons, and interpolation

### Simulation logic and analysis services

Useful existing assets:

- `src/simulation/movementSimulator.js`
- `src/simulation/detectionEngine.js`
- `src/simulation/orderComputer.js`
- `src/simulation/aiPathfinding.js`
- `src/simulation/tacticalAnalysis.js`
- `src/simulation/algorithmicAi.js`
- `src/simulation/aiProfiles.js`

What is already good:

- movement stepping through hexes already exists as a skeleton
- detection and last-known logic already exist
- weighted pathfinding and threat maps already exist
- doctrine profiles already exist
- hypothesis-based commander planning already exists

What must change:

- current movement simulator is still sealed-order and turn-based
- current detection uses random rolls and needs deterministic RTS policy
- current commander outputs turn bundles, not live intent packages
- subordinate controllers do not exist yet
- director layer does not exist yet

### Content and unit data

Useful existing assets:

- `src/simulation/eraTemplates.js`
- `src/simulation/presets.js`
- `src/simulation/schemas.js`
- `src/simulation/components/UnitOrderCard.jsx`

What is already good:

- Cold War content is already deep enough for alpha
- helicopters already exist in presets and templates
- command hierarchy metadata already exists
- many unit-card stats already exist in current UI

What must change:

- `MOVEMENT_TYPES` in `schemas.js` does not currently include `"helicopter"` even though templates and presets use it
- RTS-specific live state must be added
- current unit card is tied to order authoring, not live play

## What Must Stay Separate

These turn-based assets should inform the design, but should not become the RTS runtime:

- `src/simulation/Simulation.jsx`
- `src/simulation/SimGame.jsx`
- `src/simulation/orchestrator.js`
- `src/simulation/turnPhases.js`

Reason:

- they are built around planning phases, turn transitions, adjudication, and sealed orders
- the turn runtime still relies on LLM-oriented assumptions and batch state updates
- RTS needs an always-running authoritative local loop

## Core Architecture Decisions

## 1. Entry And Routing

Implement RTS as a sibling mode, not a branch inside the existing turn mode.

Recommended structure:

- `src/App.jsx`
  - add `rts` to valid modes
  - add menu tile and shortcut
- `src/components/AppHeader.jsx`
  - add RTS mode label and accent
- new `src/rts/RtsSimulation.jsx`
  - mode router for RTS setup vs live RTS game
- new `src/rts/RtsGame.jsx`
  - live play surface

Do not:

- bolt RTS onto `Simulation.jsx`
- route RTS through `SimGame.jsx`
- reuse `createGameFolder/createGame` as the RTS start path

## 2. Shared Builder, Separate Runtime

The best alpha path is:

- shared setup shell
- separate RTS runtime

Implementation guidance:

- keep `SimSetup.jsx` and `SimSetupConfigure.jsx` as the visual and interaction base
- parameterize them with a mode variant such as `turn` or `rts`
- add a dedicated RTS start builder function
- keep turn-based `createGameFolder` and `createGame` only for the old mode

RTS setup should expose:

- scenario title and notes
- map and preset selection
- side control mode
- AI doctrine profile
- director enabled or disabled
- environment settings
- victory conditions
- unit placement
- unit state overrides
- HQ relationships
- debugging options
- visibility mode defaults
- start paused option
- AI vs AI or player vs AI mode

## 2A. RTS Builder Requirements

The RTS setup flow must be strong enough to support nuanced testing, not just happy-path scenario launch.

### Scenario-level fields

The RTS builder should expose:

- title
- description
- initial conditions
- special rules
- map
- preset import
- start paused
- starting speed
- environment:
  - weather
  - visibility
  - ground condition
  - time of day
  - climate
- objective and victory settings
- debug visibility defaults
- AI vs AI or player vs AI mode

### Side-level fields

Each side should be configurable for:

- name
- controller type
- doctrine profile
- think budget
- director enabled or disabled
- reserve behavior defaults
- side notes or constraints
- objectives
- command hierarchy settings

### Unit-level fields

Every placed RTS unit should be editable for:

- name
- side
- type
- branch
- echelon
- parent HQ
- position
- posture
- status
- strength
- supply
- ammo
- morale
- fatigue
- cohesion
- entrenchment
- fuel
- readiness
- munitions
- movement type
- special capabilities
- notes

### RTS-specific testing fields

For nuanced testing, the builder should also support:

- initial reserve state
- delayed activation or release timer
- objective ownership at start
- pre-damaged or low-readiness units
- helicopter-loaded or unloaded start state if transport is in scope
- debug spawn markers or labels

## 3. Continuous Time, Hex-Based Command

The command language remains hex-based.

That means:

- the player orders units to hexes, not arbitrary world coordinates
- pathfinding still reasons over hex adjacency
- control, visibility, objective ownership, and scenario authoring stay hex-first

But:

- units visually move between hex centers over time
- simulation time is continuous
- spotting and combat can occur while units are between settled hexes

This preserves the identity of `open-conflict` while delivering an RTS experience.

## 4. Fixed-Step Deterministic Simulation Loop

Alpha should use a fixed-step simulation loop plus interpolated rendering.

Recommended first pass:

- simulation tick: `250 ms`
- render frame: `requestAnimationFrame`
- speed controls: `pause`, `1x`, `2x`, `4x`
- deterministic RNG stream stored in match state

Why this is the right alpha choice:

- easier to debug than free-running per-frame simulation
- easier to replay than variable delta time
- fast enough for visible real-time motion on a hex map
- simple enough for a single developer to tune

The live runtime should be split conceptually into:

1. `Simulation state`
2. `Simulation tick`
3. `Render interpolation`
4. `Input and command queue`
5. `AI update scheduling`

## 5. Settled-Hex And Transit Model

This is the most important gameplay rule to lock clearly.

Recommended alpha model:

- every unit has one `settled` hex position
- units moving to a neighboring hex enter a `travelState`
- render position is interpolated between `fromHex` and `toHex`
- occupancy is enforced on settled hexes only
- temporary overlap is allowed while traveling
- destination blocking is resolved before the unit settles

Suggested data shape:

```js
{
  id: "unit_12",
  position: "10,14",
  status: "ready",
  posture: "moving",
  travelState: {
    active: true,
    fromHex: "10,14",
    toHex: "11,14",
    path: ["11,14", "12,15", "13,15"],
    segmentIndex: 0,
    progress01: 0.42,
    moveMode: "ground",
    startedAtMs: 182500,
    etaMs: 184000
  }
}
```

Rules for alpha:

- units can detect and be detected while in transit
- units can take fire while in transit
- suppression or retreat can interrupt transit
- if destination becomes illegal, unit halts at last legal settled hex
- moving through danger is not a dodge exploit because transit units remain targetable

## 6. Fog Of War And Visibility Policy

Fog of war must be real for all gameplay brains except the director.

Policy:

- player perception uses fog of war by default
- commander, subordinates, and unit executors only see detected, contact, and last-known state
- director may see full ground truth when enabled
- spectator or debug visibility toggle must never contaminate commander or subordinate inputs

Recommended runtime visibility layers:

- `truthState`
- `actorPerceptionState`
- `playerRenderVisibilityMode`
- `debugVisibilityMode`

The visibility toggle requested for watching AI movement should be implemented as a render/debug switch only.

## 7. AI Stack

The alpha AI stack should be:

- `Director`
- `Commander`
- `Subordinates`
- `Unit executors`

### Director

Purpose:

- meta-AI
- exempt from fog of war
- influences but does not command

Should do:

- maintain pressure metrics
- detect stale states
- request replans
- emit coarse hints
- activate and relax adaptive behavior packages
- learn and forget repeated player habits using evidence, decay, and hysteresis

Should not do:

- issue unit orders
- pick exact targets
- choose exact routes
- reveal exact hidden positions to the commander
- manipulate combat outcomes
- quietly become the real commander

### Commander

Purpose:

- battle intent
- operational pivots
- reserve policy
- main effort and supporting effort

Seed implementation:

- promote `src/simulation/algorithmicAi.js` into a recurring commander runtime

### Subordinates

Purpose:

- translate commander intent into HQ or sector tasks
- own local plan execution
- report status back upward

Alpha grouping choice:

- start with `parentHQ`
- fall back to sector grouping if HQ data is missing

### Unit executors

Purpose:

- direct behavior under active task
- movement, firing, halting, retreating, regrouping

## 8. Shared Spatial Services

These services should stay mostly shared between the AI layers:

- detection and last-known memory
- threat maps
- route risk summaries
- terrain affordances
- chokepoints and crossings
- control and influence estimates
- likely enemy avenues of approach

Alpha note:

- start by reusing `detectionEngine.js`, `aiPathfinding.js`, `tacticalAnalysis.js`, and `orderComputer.js`
- move any RTS-only wrappers into `src/rts/`

## Proposed New RTS Module Layout

Recommended first-pass module layout:

- `src/rts/RtsSimulation.jsx`
- `src/rts/RtsGame.jsx`
- `src/rts/rtsStart.js`
- `src/rts/rtsMatchReducer.js`
- `src/rts/rtsLoop.js`
- `src/rts/rtsClock.js`
- `src/rts/rtsCommands.js`
- `src/rts/rtsMovement.js`
- `src/rts/rtsCombat.js`
- `src/rts/rtsMorale.js`
- `src/rts/rtsVisibility.js`
- `src/rts/rtsOccupancy.js`
- `src/rts/rtsHelicopters.js`
- `src/rts/rtsAiRuntime.js`
- `src/rts/rtsCommander.js`
- `src/rts/rtsSubordinateAi.js`
- `src/rts/rtsDirectorAi.js`
- `src/rts/rtsTelemetry.js`
- `src/rts/rtsReplay.js`
- `src/rts/components/RtsHud.jsx`
- `src/rts/components/RtsUnitCard.jsx`
- `src/rts/components/RtsSelectionBar.jsx`
- `src/rts/components/RtsCommandBar.jsx`
- `src/rts/components/RtsAiDebugPanel.jsx`

Suggested shared-builder support:

- keep existing `src/simulation/SimSetup.jsx`
- keep existing `src/simulation/SimSetupConfigure.jsx`
- add mode branching and shared start contract adapters

## Phase-To-File Touch Map

This is the recommended first-pass file ownership map for a single developer.

### Phase 1 and 2

- `src/App.jsx`
- `src/components/AppHeader.jsx`
- `src/simulation/SimSetup.jsx`
- `src/simulation/SimSetupConfigure.jsx`
- `src/simulation/SetupLeftSidebar.jsx`
- `src/simulation/SetupRightSidebar.jsx`
- `src/rts/RtsSimulation.jsx`
- `src/rts/rtsStart.js`

### Phase 3 and 4

- `src/rts/RtsGame.jsx`
- `src/rts/rtsMatchReducer.js`
- `src/rts/rtsLoop.js`
- `src/rts/rtsClock.js`
- `src/rts/rtsCommands.js`
- `src/rts/rtsMovement.js`
- `src/rts/rtsOccupancy.js`
- `src/mapRenderer/MapView.jsx`
- `src/mapRenderer/overlays/UnitOverlay.js`
- `src/simulation/SimMap.jsx`

### Phase 5 and 6

- `src/rts/rtsVisibility.js`
- `src/rts/rtsCombat.js`
- `src/rts/rtsMorale.js`
- `src/rts/rtsHelicopters.js`
- `src/rts/components/RtsHud.jsx`
- `src/rts/components/RtsUnitCard.jsx`
- `src/rts/components/RtsSelectionBar.jsx`
- `src/rts/components/RtsCommandBar.jsx`

### Phase 7 to 9

- `src/simulation/algorithmicAi.js`
- `src/simulation/aiProfiles.js`
- `src/simulation/tacticalAnalysis.js`
- `src/simulation/aiPathfinding.js`
- `src/rts/rtsAiRuntime.js`
- `src/rts/rtsCommander.js`
- `src/rts/rtsSubordinateAi.js`
- `src/rts/rtsDirectorAi.js`
- `src/rts/rtsTelemetry.js`

### Phase 10 and 11

- `src/rts/rtsReplay.js`
- `src/rts/components/RtsAiDebugPanel.jsx`
- `src/simulation/presets.js`
- `src/simulation/eraTemplates.js`
- `src/simulation/schemas.js`

## Detailed System Plan

## Menu And Mode Entry

Implementation:

- add `rts` mode to `src/App.jsx`
- add a new RTS tile beside `Simulation`
- add header metadata in `src/components/AppHeader.jsx`
- add menu shortcut
- support URL launching like `?mode=rts`

Acceptance criteria:

- RTS is visible and launchable from the main menu
- header shows RTS correctly
- existing modes are unaffected

## Builder And Setup Flow

Implementation:

- add `modeVariant="rts"` to setup shell
- reuse map select and configure flow
- hide turn-only and LLM-only setup sections when in RTS mode
- add RTS-only section:
  - start paused
  - player vs AI / AI vs AI
  - director enabled
  - debug visibility options
  - autoplay settings

Builder validation additions:

- one settled unit per hex
- legal HQ references
- valid helicopter movement types
- required objectives present
- at least two actors
- RTS-only units excluded if unsupported

Decision on duplication:

- do not fork the whole builder immediately
- parameterize and refactor only where turn-based assumptions leak into RTS start

Acceptance criteria:

- the same map setup shell can launch either turn-based or RTS play
- RTS start no longer calls turn-based game creation
- unit placement and editing support Cold War ground and helicopter units

## RTS Match State

Add an RTS-specific authoritative match state instead of reusing turn state in place.

Suggested top-level shape:

```js
{
  meta: {
    mode: "rts",
    tickMs: 250,
    speed: 1,
    paused: true,
    elapsedMs: 0,
    rngSeed: 12345
  },
  scenario: { ... },
  terrain: { ... },
  sides: [ ... ],
  units: [ ... ],
  visibility: { ... },
  occupancy: { ... },
  combat: { ... },
  ai: {
    director: { ... },
    commanders: { ... },
    subordinates: { ... }
  },
  telemetry: { ... },
  replay: { ... }
}
```

Unit additions for RTS alpha:

- `travelState`
- `currentCommand`
- `commandQueue`
- `suppression`
- `fatigue`
- `retreatState`
- `shatterState`
- `recoveryState`
- `lastCombatEvent`
- `selected`
- `visibleTo`
- `lastKnownBy`

Acceptance criteria:

- all required RTS state survives pause, resume, reload, and replay snapshot
- live runtime never depends on turn counters or sealed order bundles

## Command Model

The current turn order model should not be reused as-is.

Alpha command set:

- `move`
- `attack_move`
- `hold`
- `halt`
- `withdraw`
- `assault`
- `screen`
- `embark_helo`
- `disembark_helo`

Player control requirements:

- left click select
- shift or drag multi-select
- right click move
- attack command
- halt command
- withdraw command
- camera pan and zoom
- center-on-selection
- selection groups if inexpensive to add
- pause and speed controls

Queueing policy:

- implement single queued follow-up command if full queueing is too expensive at first
- do not block alpha on StarCraft-style shift-queue depth

Acceptance criteria:

- player can reliably command units in real time without opening a modal
- commands are cancellable and visible
- queued or active command state is inspectable

## Movement And Path Execution

Ground movement plan:

- reuse pathfinding and route-risk services
- convert target hex into path array
- execute path over time
- enforce settled occupancy at segment completion
- reroute or halt when blocked

Transit rules:

- direct fire and detection use current interpolated transit position
- artillery can target transit corridors using segment anchors
- suppression slows or interrupts travel
- retreat state overrides normal movement command

Recommended implementation approach:

1. Use hex-center interpolation for render
2. Advance simulation using segment ETA and speed modifiers
3. Sample combat and detection every tick using current transit position
4. Only commit `position` when the next segment settles

Acceptance criteria:

- units no longer snap between hexes during RTS play
- move speed visibly differs by terrain, unit class, and state
- no travel exploit makes units untargetable

## Detection, Contact, And Last-Known State

Implementation:

- reuse `detectionEngine.js` logic as the base
- create RTS-friendly wrapper in `src/rts/rtsVisibility.js`
- update visibility every tick or every second tick
- store:
  - visible cells
  - detected units
  - contact units
  - last-known markers
  - stale intel age

Determinism requirement:

- replace unmanaged `Math.random()` usage in RTS path with seeded deterministic RNG

Acceptance criteria:

- fog behaves consistently during movement and combat
- last-known markers update and decay correctly
- AI perception below director can be audited

## Combat Model

Alpha combat must be local and deterministic.

Include:

- direct fire
- indirect fire
- suppression
- morale loss
- retreat triggers
- shatter triggers
- recovery rules
- destruction

Suggested first-pass combat state machine:

- `ready`
- `engaged`
- `suppressed`
- `retreating`
- `shattered`
- `recovering`
- `destroyed`

Combat resolution guidance:

- direct-fire cycles should be time-based, not turn-based
- artillery should use windup, shell travel delay, area effect, and suppression
- close assaults should require adjacency or an assault entry condition
- suppression should affect:
  - accuracy
  - movement
  - willingness to continue attack
- morale should affect:
  - retreat chance
  - recovery speed
  - shatter threshold

Acceptance criteria:

- combat outcomes are understandable from live status and logs
- damaged units change behavior before they are destroyed
- retreat and shatter produce visible battlefield flow changes

## Resource And Readiness State

These existing fields should matter in real-time play, not just appear on cards:

- `supply`
- `ammo`
- `fuel`
- `readiness`
- `munitions`

First-pass alpha rules:

- movement and combat spend ammo or munitions
- helicopters spend fuel while moving and fighting
- low supply penalizes combat power and recovery
- low readiness penalizes helicopter launch or combat effectiveness
- AI should treat low-resource units differently from fresh units

Acceptance criteria:

- resource state changes over the course of battle
- resource exhaustion changes behavior and outcomes in readable ways

## Objectives And Victory State

RTS alpha needs explicit win-state logic, not just freeform sandbox play.

Recommended first-pass rules:

- VP hexes continue to be the main scenario objective language
- objective ownership updates continuously or on short intervals
- contested objectives do not score
- a side can win by:
  - reaching VP threshold
  - holding enough objectives until scenario timer ends
  - forcing catastrophic enemy collapse if that scenario enables it

Builder support should include:

- VP location
- VP value
- initial controller
- capture delay or hold time if needed
- scenario time cap

Acceptance criteria:

- a match can end cleanly with a readable winner and rationale
- AI commander logic can reason about live objective state

## Helicopter Model

Alpha helo rules:

- helicopters are persistent on-map units
- they use continuous travel between hexes like ground units
- they are more terrain-agnostic than ground movement
- they remain vulnerable to detection and air-defense fires
- they use `fuel`, `readiness`, and `munitions`

Helicopter-specific gameplay for alpha:

- attack helicopter fires
- transport helicopter lift and drop
- emergency withdraw
- AD threat avoidance

Do not add for alpha:

- full fixed-wing sortie layer
- deep off-map air tasking system

Acceptance criteria:

- attack and transport helos can be placed, commanded, and fought
- AD coverage changes helo behavior and survivability
- fuel and readiness matter during a real-time battle

## Unit Cards And Live HUD

The current `UnitOrderCard.jsx` is a useful source of unit stats, but RTS needs a live battlefield card.

Build:

- `RtsUnitCard.jsx`
- `RtsSelectionBar.jsx`
- `RtsCommandBar.jsx`
- `RtsHud.jsx`

Each live unit card should show:

- unit name
- actor
- type and echelon
- HQ or subordinate owner
- current command
- current task source
- strength
- supply
- ammo
- morale
- suppression
- fatigue
- fuel
- readiness
- munitions
- posture
- status
- range
- vision
- movement state
- detection state

Map-scale indicators should show:

- moving
- attacking
- retreating
- shattered
- recovering
- suppressed
- helicopter
- selected
- under-fire

Acceptance criteria:

- a player can understand why a unit is winning, losing, halting, or retreating without opening a debug panel

## Animation And Readability

Animation target for alpha:

- clear, not cinematic

Needed:

- interpolation between hex centers
- state icon or color cues
- movement trail or arrow
- engagement markers
- retreat and shatter markers
- helicopter rotor or flight icon cue
- attack windup or artillery impact cue

Important readability rule:

- every animation choice must improve tactical clarity first

Acceptance criteria:

- observer can tell at a glance whether a unit is moving, firing, retreating, or shattered
- unit motion speed reads plausibly over terrain

## AI Commander Hierarchy

This is a mandatory alpha feature.

Alpha chain of control:

- director per side, optional
- commander per side
- one subordinate per HQ group or sector
- units assigned to subordinates

Recommended update cadence:

- director: every `5 s` or major event
- commander: every `8-12 s` or major event
- subordinate: every `1-2 s` or major event
- unit executor: every tick

Major replan triggers:

- objective captured or lost
- reserve committed
- major casualty spike
- flank collapse
- breakthrough opportunity
- direct player pressure detected by director packages
- path or occupancy deadlock

Acceptance criteria:

- AI can execute coherent attacks and defenses
- subordinates visibly own parts of the battle
- unit behavior is not just random local utility spam

## Director Layer And Adaptation

Implement the director exactly as framed in the research report.

Director responsibilities:

- pressure management
- stale-state detection
- coarse hinting
- adaptive package gating
- evidence accumulation
- slow forgetting
- telemetry

Adaptive package examples for alpha:

- `shell_forest_corridors`
- `counterbattery_harass`
- `screen_road_junctions`
- `flank_screen`
- `reserve_commit_fast`

Adaptive design rule:

- use evidence plus decay plus hysteresis
- do not use hair-trigger binary toggles

Suggested package state:

```js
{
  id: "shell_forest_corridors",
  evidence: 0.74,
  active: true,
  activatedAtMs: 245000,
  lastObservedAtMs: 302000,
  deactivateBelow: 0.40,
  activateAbove: 0.70
}
```

Acceptance criteria:

- director can make the AI less cheesable without visibly cheating
- director effects are inspectable and bounded

## AI Debug And Anti-Cheat Telemetry

This is not optional.

Add:

- commander hypothesis panel
- subordinate task ownership panel
- director pressure and package panel
- reserve state panel
- route choice provenance
- visibility provenance
- replan reason log
- AI perception snapshots

Every AI decision that matters should be traceable to one of:

- visible contact
- detected unit
- last-known intel
- doctrine preference
- active director hint or package
- local combat reaction

Never allow a fog-sensitive decision to appear untagged.

Acceptance criteria:

- developer can inspect a replay and prove whether a commander decision used legal information

## AI Vs AI And Benchmarking

Reuse the idea behind the current AI-opponent test content, but build RTS-native tooling.

Needed:

- start match in AI vs AI mode
- autoplay with pause and step controls
- deterministic replay
- benchmark presets
- soak-test harness

At least these RTS presets should be ready for alpha:

- a compact duel test map
- a larger Cold War line battle
- one helicopter-relevant test scenario

Acceptance criteria:

- AI vs AI can run without player input
- the same scenario is repeatable under deterministic seed

## Phased Single-Developer Build Order

## Phase 0: Freeze Scope And Data Contracts

Goal:

- stop churn before coding core runtime

Tasks:

- finalize scope listed in this document
- add `helicopter` to shared movement-type support
- define RTS match state and command schema
- define AI-side runtime state shape
- define builder mode branching contract

Deliverables:

- state schema notes
- command schema notes
- builder contract notes

Exit criteria:

- no unresolved ambiguity about movement, fog, AI stack, or helicopter scope

## Phase 1: Add RTS Mode Shell

Goal:

- make RTS launchable without gameplay yet

Tasks:

- add RTS tile in `App.jsx`
- add header metadata
- add `src/rts/RtsSimulation.jsx`
- add placeholder `src/rts/RtsGame.jsx`
- wire menu and route flow

Exit criteria:

- RTS mode launches from menu and returns safely

## Phase 2: Share Setup And Add RTS Start Contract

Goal:

- launch a real RTS match state from the existing setup shell

Tasks:

- parameterize `SimSetup` and `SimSetupConfigure`
- add RTS-only setup fields
- hide LLM-only fields in RTS mode
- validate unit placement and hierarchy for RTS
- create `rtsStart.js`

Exit criteria:

- setup can launch an RTS match object without touching turn-based orchestrator paths

## Phase 3: Build Core RTS Loop And Match State

Goal:

- establish authoritative local simulation

Tasks:

- implement fixed-step loop
- add pause and speed controls
- create RTS reducer
- add deterministic RNG
- support replay snapshots

Exit criteria:

- a loaded RTS match can tick deterministically even before combat is complete

## Phase 4: Implement Movement, Occupancy, And Interpolation

Goal:

- make units move credibly in real time on the hex map

Tasks:

- add `travelState`
- add path execution
- enforce settled occupancy
- add blocking and halt behavior
- animate unit motion in `MapView` and `UnitOverlay`

Exit criteria:

- units travel visibly between hexes
- blocked destinations resolve sanely
- movement remains targetable

## Phase 5: Implement Visibility And Combat Core

Goal:

- make battles playable under fog of war

Tasks:

- wrap detection engine for RTS cadence
- add seeded detection randomness
- add direct-fire timing
- add artillery timing
- add suppression, morale, retreat, shatter, recovery
- add combat logs and indicators

Exit criteria:

- two sides can move and fight in real time under fog of war

## Phase 6: Build Live HUD And Unit Cards

Goal:

- make battlefield state readable

Tasks:

- create live unit card
- add selection bar
- add command bar
- add movement and combat indicators
- add real-time visibility toggle for observation

Exit criteria:

- player can command and understand the battle without using dev tools

## Phase 7: Promote Commander Into RTS Runtime

Goal:

- turn the current algorithmic planner into a recurring commander

Tasks:

- extract reusable pieces from `algorithmicAi.js`
- build commander replan cadence
- emit intent packages instead of sealed turn orders
- add commander memory and hypothesis persistence

Exit criteria:

- commander can generate ongoing battle intent in RTS time

## Phase 8: Add Subordinates And HQ Tasking

Goal:

- create real command hierarchy behavior

Tasks:

- group units by `parentHQ`
- create subordinate task queues
- add upward status reporting
- add reserve release logic
- add fallback and regroup behavior

Exit criteria:

- AI no longer looks like one giant centralized per-unit scorer

## Phase 9: Add Director And Adaptive Packages

Goal:

- layer adaptation without replacing fair commander behavior

Tasks:

- add director state
- add pressure metrics
- add pattern detectors
- add package activation with decay and hysteresis
- log every director influence packet

Exit criteria:

- director can nudge commander behavior while remaining visibly bounded

## Phase 10: Add AI Vs AI, Debug, And Benchmark Tooling

Goal:

- make AI tuning practical

Tasks:

- add autoplay
- add AI vs AI scenario start
- add debug panels and overlays
- add replay review
- add benchmark preset list

Exit criteria:

- developer can run AI vs AI repeatedly and inspect why outcomes differ

## Phase 11: Alpha Hardening

Goal:

- turn a promising prototype into a stable alpha

Tasks:

- tune movement timings
- tune morale breakpoints
- tune AI update cadence
- prune unsupported setup combinations
- write alpha playtest checklist
- fix crashers and deadlocks

Exit criteria:

- a fresh user can boot RTS mode, set up a battle, and finish a playable local match

## Recommended Testing Strategy

## Core automated checks

- deterministic replay test
- same-seed AI vs AI repeatability test
- movement blockage test
- transit detection test
- fog provenance test
- helicopter AD exposure test
- retreat and shatter transition test

## Manual scenario checks

- small duel on open terrain
- forest corridor test
- urban assault test
- bridge or river crossing test
- helicopter insertion test
- artillery suppression test
- AI vs AI soak on medium map

## Regression watchlist

- turn-based simulation mode still launches and works
- shared setup edits do not break PBEM or turn-based setup
- unit overlay performance remains acceptable on larger maps

## Risks And Mitigations

## Risk: RTS leaks too much into the old turn-based code

Mitigation:

- keep new runtime in `src/rts/`
- only share setup and generic renderer pieces

## Risk: AI below director cheats accidentally

Mitigation:

- hard separation between truth state and perception state
- provenance tagging for AI decisions
- replay-visible perception snapshots

## Risk: movement-between-hexes becomes too complex

Mitigation:

- keep settled occupancy simple
- use transit overlap exceptions only
- postpone advanced congestion or formation spacing

## Risk: helicopters explode scope

Mitigation:

- treat helicopters as persistent on-map units only
- defer fixed wing and deep air-tasking systems

## Risk: performance drops on large maps

Mitigation:

- fixed-step loop
- coarse AI cadence
- cache spatial analysis
- add benchmark scenarios early

## Risk: builder becomes an unmaintainable branch mess

Mitigation:

- centralize mode branching in setup contract and specific sections
- do not duplicate the whole setup stack unless reuse fails badly

## Alpha Exit Checklist

The alpha is ready when all of the following are true:

- RTS tile is live on main menu
- RTS setup can load maps and configure realistic Cold War battles
- player can place and edit ground and helicopter units with meaningful state
- real-time map supports move, hold, attack, halt, and withdraw flow
- units animate between hexes and remain targetable in transit
- fog of war is functional and auditable
- unit cards and overlays expose key live stats
- morale, suppression, retreat, shatter, and recovery are present and matter
- commander and subordinate AI can fight a coherent battle
- director layer can be enabled and observed without replacing legal commander behavior
- AI vs AI can run for testing
- battle logs, debug panels, and replay tooling are good enough to tune behavior

## Final Recommendation

The correct path is not to retrofit the existing turn engine into something it is not.

The correct path is:

- reuse the setup shell
- create a clean RTS runtime beside the current simulation
- promote the existing algorithmic planner into the commander layer
- add subordinate controllers
- add the director only as an optional meta-layer
- prove correctness with debug and AI-vs-AI tools as early as possible

If this plan is followed in order, the result should be a credible local RTS alpha that still feels like `open-conflict`, rather than a disconnected prototype wearing the same map renderer.
