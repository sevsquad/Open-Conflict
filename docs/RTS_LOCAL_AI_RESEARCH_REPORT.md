# Local Non-LLM RTS AI Research Report

Date: 2026-04-22

## Purpose

This report answers four questions for a possible real-time version of `open-conflict` that uses no LLM at runtime for command or adjudication:

1. What is the best-known architecture for commander decision-making?
2. Does the current project already describe or implement a "dual-brained" commander/subordinate runtime?
3. What other famous AI examples are worth borrowing from outside classic RTS games?
4. What else has to be added to ship a credible RTS mode?

The short answer is:

- There is no single gold-standard "RTS brain."
- The strongest production pattern is a layered hybrid:
  - optional director or meta-AI layer for pacing, hinting, and adaptive package gating
  - commander planner
  - subordinate or squad planner
  - unit executor
  - shared spatial reasoning and perception services
- `open-conflict` already has serious pieces of this in its algorithmic AI opponent work.
- It does not yet have a true commander/subordinate runtime or a continuous RTS simulation core.
- RTS mode should be built as a parallel simulation mode, not as a small extension of the current turn and PBEM pipeline.

## Executive Summary

If we want strong local AI without an LLM, the best fit is:

- `Optional director layer`: omniscient meta-AI for pressure, replan nudges, coarse hints, and adaptive behavior-package gating
- `Commander layer`: HTN-style or hypothesis-based planner for battle intent
- `Subordinate layer`: utility scoring or lightweight task planners for formations, HQs, or sectors
- `Execution layer`: behavior tree, state tree, or other reactive controller for unit-level behavior
- `Shared services`: blackboard/world state, influence maps, tactical graphs, threat maps, pathfinding, and terrain affordances

For `open-conflict`, the most practical recommendation is:

- keep the current algorithmic AI direction
- turn it into an explicit commander brain
- add subordinate controllers below it
- optionally add a director layer above it for campaign-style pacing and adaptive anti-cheese responses
- add a deterministic real-time simulation core beside the current turn engine
- let "commander mode" send the same kind of intent objects that the AI commander would send

That gives you one consistent architecture for:

- player vs AI
- AI vs AI
- player-as-commander with AI subordinates

## Findings For Question 1: What Is The Gold Standard For Commander Decision-Making?

## Answer In One Sentence

The gold standard is not one technique. It is a hierarchical hybrid that separates operational intent from local execution.

## What The Best Public Examples Converge On

Across shipped games, talks, and RTS research, the strongest pattern looks like this:

| Layer | Best-fit techniques | Role |
| --- | --- | --- |
| Director (optional) | meta-AI, pacing systems, adaptive package gating, coarse hinting | Manage pressure, request replans, and unlock or fade counter-behavior packages without commanding troops |
| Commander | HTN, operation hypotheses, goal decomposition, doctrine weighting | Choose main effort, supporting effort, reserve policy, timing, ROE, and operational pivots |
| Subcommander | Utility scoring, lightweight HTN, task arbitration | Turn commander intent into sector tasks, assault groups, reserve release, support fires, and fallback decisions |
| Unit executor | Behavior trees, state trees, FSMs, reactive controllers | Execute move, fire, cover, formation, pursue, halt, disengage, and local reactions |
| Shared services | Blackboard, influence maps, tactical graphs, smart terrain, pathfinding, perception/memory | Provide the world understanding every layer depends on |

The `director` row is optional rather than foundational. It is most useful for solo, campaign, or explicitly adaptive AI modes. It is not a replacement for the commander brain, and it should not be allowed to quietly become the real commander under another name.

The most important takeaway is separation of concerns:

- behavior trees are excellent executors, but weak as whole-army strategy
- utility AI is excellent at arbitration, but weak as the only operational brain
- GOAP is strong for bounded tactical planning, but too heavy as the sole architecture for every unit in a full battle
- HTN and objective systems are strongest at command-level decomposition and coordination

## Recommended Gold Standard By Mode

| Mode | Best-fit architecture | Why |
| --- | --- | --- |
| Player vs AI | HTN or hypothesis commander + utility subcommanders + reactive executors | Produces readable plans and believable local adaptation |
| AI vs AI | Same stack, plus autoplay/self-play tuning harness | Lets us tune doctrine weights, reserve logic, and branch ordering without runtime ML dependency |
| Commander mode | Human intent -> AI subcommanders -> unit executors | Preserves player agency while avoiding click-per-unit micromanagement |

## Best Practical Recommendation For `open-conflict`

If I had to pick one architecture for this project, I would choose:

1. A commander brain that selects 2-3 hypotheses, scores them, and chooses one.
2. Subordinate brains attached to HQs, formations, or sectors that receive commander intent and translate it into actionable tasks.
3. Unit-level controllers that execute those tasks with reactive local logic.
4. Shared tactical analysis services that continuously compute control, threat, routes, chokepoints, and likely enemy avenues of approach.

That is the most explainable, production-proven, and project-compatible answer.

## What Not To Use As The Main Architecture

These are useful pieces, but not good top-level answers by themselves:

- one giant behavior tree for the whole army
- GOAP for every unit at all times
- pure utility scoring with no decomposition layer
- end-to-end reinforcement learning for the main commander

## Why This Recommendation Is Strong

The best supporting evidence comes from:

- `Killzone 2` and `Killzone 3`, which explicitly describe commander, squad, and individual layers with HTN and terrain reasoning
- `Halo`, which shows the value of separating objective-level direction from local execution
- `Total War`, which shows large-scale battle orchestration through tactic managers, influence graphs, entry-point logic, and reserve handling
- `Full Spectrum Command`, which almost exactly matches your desired commander-mode structure: high-level plans, tactical AI, then low-level execution

## Findings For Question 2: Does The Project Already Have "Dual-Brained" Or Commander/Subordinate Documentation?

## Short Answer

Partially, but not fully.

The repo clearly contains:

- a serious non-LLM AI-opponent track
- doctrine profiles
- tactical analysis
- operational memory
- all-AI local runs
- command hierarchy as scenario data and UI

It does not yet contain:

- an optional meta-director layer for pacing, coarse hints, and adaptive counter-behavior packages
- an explicit commander/subordinate runtime with separate brains and update loops
- a continuous real-time execution model
- a true "commander issues intent, subordinates execute continuously" control stack

## What Already Exists In The Repo

### 1. A real zero-LLM AI-opponent plan

`AI-OPPONENT-PLAN.md` already defines an algorithmic AI opponent with:

- `aiConfig.engine: "algorithmic" | "llm"`
- doctrine profiles
- think budgets
- operational memory
- 2-3 operation hypotheses
- goal-directed candidate generation
- coordination passes
- optional bounded portfolio search

This is already very close to a commander-brain design, just still oriented around turn output.

### 2. A real algorithmic implementation path

The repo already contains:

- `src/simulation/algorithmicAi.js`
- `src/simulation/tacticalAnalysis.js`
- `src/simulation/aiPathfinding.js`
- `server/aiPlayer.js`
- `server/gameEngine.js`
- `src/simulation/aiOrderClient.js`

The important point is that this is not speculative. The project already has:

- hypothesis selection
- coordination scoring
- commander-thought summaries
- operational state persistence
- an engine switch between algorithmic and LLM paths

### 3. Command hierarchy already exists as data and UI

The project already references command structure through:

- `docs/ADDING_PRESETS.md` with `parentHQ`
- `src/simulation/schemas.js` with `command_hierarchy`
- `src/simulation/SimGame.jsx` with a visible `Command Hierarchy` panel

That means the simulation data model already acknowledges command relationships, even though the AI does not yet exploit them as separate subordinate controllers.

### 4. Separable command roles already exist in one subsystem

`docs/AIR_FORCES_DESIGN.md` explicitly describes:

- "LLM handles judgment, mechanics handle math"
- "Joint command, separable roles"

That is not a general dual-brain runtime, but it is proof that the project already accepts role separation as a design pattern.

## The Closest Existing "Dual-Brain" Discussion

The closest direct design discussion is in `CLADUE-CHAT-DISCUSSION-14.md`:

- it explicitly separates `AI Opponent` from `LLM Commander`
- it discusses the "two-brain problem"
- it later settles on an `operation hypothesis architecture`

That conversation is important because it shows the project already recognized the architectural issue:

- if top-level intent and low-level scoring are not aligned, the AI becomes incoherent

What it still does not define is the runtime form you are asking for now:

- commander brain
- subordinate brains
- continuous execution loop
- status reports upward
- replan and interruption rules

## Bottom Line On Question 2

The project absolutely has documentation and code that can seed a dual-brained RTS AI.

It does not yet have the runtime architecture itself.

The best reading of the repo is:

- the commander-brain idea exists
- the subordinate-brain idea is implicit
- the continuous RTS runtime does not exist yet

## Findings For Question 3: What Other Famous AI Examples Should We Borrow From?

## Best Transferable Examples

| Example | What it is best at | Best RTS use |
| --- | --- | --- |
| `Halo 2` / `Halo 3` | layered combat behavior and objectives | commander/subordinate structure, objective ownership, reserve tasks |
| `F.E.A.R.` | bounded GOAP planning | scarce assets, special tactics, smart lieutenant behavior |
| `XCOM` | fast scoring of movement and action choices | formation-level and unit-level local tactical choice |
| `The Sims` | smart terrain and affordances | crossings, strongpoints, roads, ridges, refit points, observation positions |
| `Hitman: Absolution` | shared "situation" coordination | local incident controllers, temporary response groups |
| `Left 4 Dead` Director | meta-level pacing and pressure | solo campaign pacing, escalation, reinforcement timing |
| `Alien: Isolation` Director/Controller split | omniscient meta-direction with constrained creature control | adaptive pressure, coarse search hinting, and learn-then-forget counter packages above a non-omniscient commander |
| `Total War` | battle-space orchestration | assault axes, reserves, chokepoints, tactic managers |
| `Gran Turismo Sophy` | learned high-performance real-time control | narrow learned micro later, not first-pass commander AI |
| `AlphaStar` | frontier RTS self-play RL | benchmark and long-term research reference, not first shipping path |

## My Strongest Recommendations

### Borrow immediately

- `Halo` for commander/subordinate organization
- `Total War` for battle orchestration and reserve logic
- `XCOM` for fast local tactical scoring
- `The Sims` for smart terrain and affordance tagging
- `F.E.A.R.` for bounded planning on scarce assets and difficult local problems

### Borrow only as optional layers

- `Left 4 Dead` for pacing, campaign drama, and event timing
- `Alien: Isolation` for an omniscient director that influences but does not directly control the main actor brain
- `Hitman` for local situation handlers

### Borrow much later, and only narrowly

- `Gran Turismo Sophy` style RL for continuous-control micro
- `AlphaStar` style self-play as research, benchmark, or offline tuning inspiration

## Why These Borrowings Make Sense For This Project

`open-conflict` is already moving toward:

- tactical analysis
- doctrine-aware scoring
- route reasoning
- bounded hypothesis search

That means the right borrowings are the ones that reinforce explainable, inspectable, deterministic control. The wrong borrowings are the ones that require giant opaque training pipelines before the mode is even playable.

## The Best Outside Pattern For Commander Mode

The strongest direct reference for your "player issues command, AI executes" idea is `Full Spectrum Command`.

Its structure maps almost perfectly onto what you described:

- high-level plan generation
- tactical AI that decomposes those plans to platoon and squad tasks
- low-level game AI that handles movement, pathing, and animation

That is almost exactly the architecture I would recommend for this project.

## A Qualified Alien: Isolation Takeaway

`Alien: Isolation` is useful here, but only if we copy the right part of it.

The best-supported lesson is the `director/controller` split:

- a high-level system with fuller knowledge decides where pressure should go
- the actor brain still has to hunt and act through its own local logic

That maps cleanly onto `open-conflict` if we treat it as an optional `director` above the commander, not as a replacement for the commander/subordinate stack.

The most interesting extension for this project is not "the director commands troops." It is:

- detecting repeated player habits
- raising evidence for matching counters
- activating adaptive behavior packages
- letting those packages fade again when the player changes behavior

For example:

- repeated treeline advances can gradually elevate a `shell_forest_corridors` package
- repeated static artillery parks can elevate a `counterbattery_harass` package
- repeated road-column pushes can elevate a `screen_road_junctions` package

The important constraint is that these packages should only bias what the commander and subordinates consider. They should not issue direct fire missions or hand exact hidden positions to the AI in fair-play modes.

So the `Alien: Isolation` inspiration fits the report's existing recommendation well, but as a `meta-layer`. It strengthens the plan rather than replacing it.

## Findings For Question 4: What Must Be Added To Create RTS Mode?

## Short Answer

A lot of the map, terrain, pathing, and AI-analysis substrate is reusable.

The biggest missing pieces are:

- a continuous deterministic simulation loop
- a non-LLM combat resolution model
- a proper command and control runtime
- an optional director/adaptation layer for campaign-style pacing and anti-cheese response
- RTS-specific player controls and feedback
- a commander/subordinate AI stack that runs continuously instead of per turn

## What Can Be Reused

The following systems are strong starting points:

- map rendering and interaction
- terrain and LOS math
- movement simulation kernels
- detection and FOW logic
- tactical analysis
- algorithmic AI opponent logic
- all-AI local simulation shell

The repo already has real assets here in:

- `src/mapRenderer/MapView.jsx`
- `src/simulation/SimMap.jsx`
- `src/mapRenderer/overlays/OrderOverlay.js`
- `src/simulation/orderComputer.js`
- `src/simulation/movementSimulator.js`
- `src/simulation/detectionEngine.js`
- `src/simulation/algorithmicAi.js`

## What Will Break If We Try To "Just Make It Real Time"

The current architecture is still fundamentally turn-based:

- `turnPhases.js` defines planning, adjudication, review, challenge, rebuttal, and resolution phases
- `orchestrator.js` still depends on `/api/llm/adjudicate`
- orders are sealed turn artifacts, not continuous commands
- PBEM persistence assumes "submit all orders, then process a turn"

That means RTS cannot be treated as a small toggle on the current core flow.

It needs a parallel simulation mode.

## Comprehensive RTS Requirement List

### 1. A fixed-step simulation core

Needed:

- a deterministic `tick(state, commands, dt)` loop
- authoritative state updates for positions, facing, suppression, morale, visibility, and fire cycles
- event queues for contact, kill, route-blocking, retreat, reinforcement, and objective capture
- deterministic RNG, ideally seeded and centralized

Why:

- the current turn engine resolves state in large jumps
- RTS needs a continuously advancing world

### 2. A direct combat model

Needed:

- deterministic fire-resolution rules
- weapon cooldowns and burst timing
- direct and indirect fire handling
- morale, suppression, cohesion, and recovery
- target acquisition, loss of contact, and retargeting
- casualty, disablement, and readiness rules

Why:

- right now outcome authority still runs through adjudication `state_updates`
- a no-LLM RTS cannot rely on that path

### 3. A real command model

Needed:

- queued commands
- command overwrite and cancellation rules
- timestamps and command age
- formation orders
- attack-move, move, hold, screen, escort, support, assault, fallback, disengage
- ROE, posture, and reserve state
- command latency or friction rules if desired

Why:

- current orders are discrete turn declarations
- RTS needs interruptible, revisable, live intent

### 4. A commander/subordinate runtime

Needed:

- commander brain per side
- subordinate brains per HQ, task force, or sector
- unit-level executors
- upward reporting of status, contact, losses, blocked routes, and task completion
- replan rules and interrupt thresholds

Recommended update cadence:

- commander: every 5-15 seconds or on major events
- subordinate: every 1-3 seconds or on major events
- unit execution: every tick

Why:

- this is the cleanest way to support all three desired modes with one architecture

### 5. A world-state and memory model for AI

Needed:

- last-known enemy positions
- uncertainty and stale intel timers
- sector ownership estimates
- threat and opportunity maps
- route congestion and traffic awareness
- commander intent memory
- subordinate task state and commitment

Why:

- turn-based planning can rebuild large summaries each turn
- RTS AI needs persistent belief and commitment between replans

### 6. An optional director and adaptation layer

Needed:

- pressure and stale-state metrics
- coarse hint packets
- adaptive pattern detectors
- behavior-package activation with evidence, decay, and hysteresis
- mode policies for campaign, commander mode, fair skirmish, and AI-vs-AI benchmarking

Why:

- this is the cleanest way to add an `Alien: Isolation` style meta-layer without replacing commander planning
- it gives the AI a controlled way to stop being farmed by repeated player habits
- it preserves the main architecture as long as the director suggests and unlocks, rather than commands

The director should:

- manage pressure
- request replans
- provide sector or corridor hints
- activate and relax adaptive packages over time

The director should not:

- issue unit orders
- choose exact targets or routes
- feed exact hidden enemy positions to the commander in fair modes
- manipulate combat outcomes behind the scenes

### 7. Terrain affordances and tactical graphs

Needed:

- chokepoints
- crossings
- defensible strongpoints
- assault lanes
- support-fire positions
- supply/refit nodes
- recon vantage points

Why:

- this is how the AI stops looking like a local optimizer and starts looking like it understands the battlefield

### 8. RTS controls and user experience

Needed:

- marquee selection and selection groups
- command queues and waypoints
- pause and speed controls
- formation previews
- attack range and threat overlays
- status feedback for AI subordinate interpretation of player intent
- battle log and commander log

For commander mode specifically:

- objective markers
- time windows
- priority sliders
- reserve release permissions
- sector boundaries
- ROE and aggression settings

Why:

- commander mode only works if the player can issue intent clearly and see how AI interpreted it

### 9. Debugging and telemetry

Needed:

- live overlays for influence, threat, control, and intent
- current commander hypothesis
- current director pressure and active adaptive packages
- subordinate task ownership
- reserve state
- route-choice debug
- replan causes
- AI-vs-AI replay and batch harness

Why:

- complex hierarchical AI is impossible to tune if it is not inspectable

### 10. Save/load/replay support

Needed:

- snapshot save/load for a running match
- deterministic replay
- AI-vs-AI autoplay runs
- scenario benchmark harness

Why:

- this is essential for balancing and regression testing

### 11. Content authoring support

Needed:

- task-force definitions
- HQ relationships
- doctrine packages
- adaptive package definitions
- objective templates
- map affordance tags when auto-detection is not enough
- RTS-specific scenario scripting

Why:

- battle AI quality depends heavily on usable command structure and map semantics

### 12. Performance engineering

Needed:

- time budgets for commander and subordinate replans
- incremental updates to spatial analysis
- pruned candidate generation
- batch evaluation for AI-vs-AI
- stress testing on large scenarios

Why:

- the project can already do sophisticated analysis, but RTS mode needs it on a clock

### 13. Optional future multiplayer work

Needed later, not first:

- lockstep or rollback strategy
- low-latency session transport
- authoritative live match service

Why:

- the existing PBEM tables and routes are the wrong shape for live RTS
- local RTS should come first

## Recommended Architecture For `open-conflict`

## The Core Recommendation

Build an explicit commander/subordinate runtime, with an optional director layer above it:

- optional director or meta-AI layer
- one commander brain per side
- one or more subordinate brains below it
- reactive execution below that

## Recommended Runtime Shape

### Optional director responsibilities

- manage pressure and pacing
- detect stale states and repeated player habits
- request replans when the current approach is stale or failing
- emit coarse sector or corridor hints instead of exact hidden truth
- activate and relax adaptive behavior packages through evidence, decay, and hysteresis

Inputs:

- full battlefield state in modes where omniscience is allowed
- recent player behavior
- commander state
- pressure metrics and recent outcomes

Outputs:

- bounded director packets consumed by the commander

Example output shape:

```js
{
  desiredPressure: 0.62,
  replanReason: "right_axis_stale",
  searchHints: [
    { kind: "sector", region: "RIGHT", confidence: 0.57, ttlSec: 45 }
  ],
  activePackages: [
    { id: "shell_forest_corridors", strength: 0.68, ttlSec: 60 }
  ]
}
```

The director should influence the commander by changing what is considered or weighted, not by choosing actual routes, targets, or unit orders.

### Commander brain responsibilities

- select main and supporting efforts
- choose assault axis or defensive posture
- manage reserves
- set ROE and risk tolerance
- allocate scarce assets
- react to major battlefield events

Inputs:

- tactical analysis summaries
- doctrine profile
- objective state
- last-known enemy posture
- subordinate status reports

Outputs:

- intent packages for subordinate controllers

Example output shape:

```js
{
  hypothesis: "center_bridgehead_then_exploit_north",
  primaryObjective: "crossing_e11",
  supportingObjective: "fix_enemy_right",
  reservePolicy: "hold_until_bridgehead_secure",
  firePriority: "center",
  roe: "aggressive",
  timingWindowSec: 90
}
```

### Subordinate brain responsibilities

- translate intent into formation tasks
- choose routes
- assign screen, assault, support, reserve, flank, and fallback roles
- react to local threat changes
- request clarification or report blockage upward

Inputs:

- commander intent
- local perception
- formation state
- local threat and terrain affordances

Outputs:

- formation tasks and command queues for units

### Unit executor responsibilities

- move
- halt
- hold
- attack
- suppress
- take cover
- retreat
- maintain formation
- reacquire targets

This layer should be simple and reactive.

## Why This Fits The Repo

This architecture aligns cleanly with what already exists:

- a future `director` layer can sit above the current algorithmic commander without forcing a rewrite
- `algorithmicAi.js` can evolve into the commander layer
- `tacticalAnalysis.js` can become the shared staff-analysis service
- `aiPathfinding.js` and `orderComputer.js` can support subordinate routing and spatial evaluation
- `movementSimulator.js` and `detectionEngine.js` can seed the RTS sim core

## The Most Important Design Principle

The player in commander mode should speak the same language as the AI commander.

That means the human should not issue a different class of order than the AI does.

Instead, both should manipulate the same intent objects:

- objective
- axis
- priority
- reserve policy
- ROE
- timing

That is the cleanest way to unify:

- player vs AI
- AI vs AI
- player commander mode

## Suggested Implementation Phases

### Phase 1: Build the RTS sim core beside the turn engine

Goal:

- create a deterministic real-time kernel without touching PBEM assumptions more than necessary

Deliverables:

- `tick(state, commands, dt)`
- deterministic combat
- central RNG
- pause, resume, speed control

### Phase 2: Replace turn orders with live commands

Goal:

- move from sealed turn artifacts to continuous command objects

Deliverables:

- command queue format
- cancellation rules
- formation and ROE commands
- commander-mode input model

### Phase 3: Promote current algorithmic AI into an explicit commander brain

Goal:

- turn the current hypothesis-based turn planner into a recurring commander process

Deliverables:

- commander replans
- intent package outputs
- status-report ingestion

### Phase 4: Add subordinate brains

Goal:

- create formation or HQ controllers that can execute commander intent autonomously

Deliverables:

- sector or HQ ownership
- local task generation
- reserve release logic
- fallback and rejoin behavior

### Phase 5: Add an optional director layer for adaptive modes

Goal:

- add campaign-style pacing and anti-cheese adaptation without replacing commander planning

Deliverables:

- pattern detectors
- adaptive behavior packages
- evidence, decay, and hysteresis rules
- director telemetry and mode-gating rules

### Phase 6: Build commander mode UI

Goal:

- let the player control the commander layer directly

Deliverables:

- objective markers
- priorities
- ROE
- reserve permissions
- AI-interpretation feedback

### Phase 7: Add autoplay, benchmarking, and tuning harnesses

Goal:

- make AI-vs-AI useful for balance and development

Deliverables:

- batch scenario runner
- replay and telemetry
- doctrine regression tests

### Phase 8: Consider networking later

Goal:

- only after local RTS feels good

Deliverables:

- separate live-match transport and persistence path

## Final Recommendations

If the goal is a strong local RTS mode with no LLM at runtime, I would make the following calls:

1. Do not search for one "best AI brain." Build a layered stack.
2. Treat the current algorithmic AI as the seed of the commander layer.
3. Add explicit subordinate controllers instead of stuffing everything into one scorer.
4. Build RTS as a parallel mode, not as a small variant of the turn adjudication pipeline.
5. Make commander mode use the same intent objects as the AI commander.
6. Treat an `Alien: Isolation` style director as an optional meta-layer, not a replacement for the commander/subordinate architecture.
7. Keep machine learning as an optional later tool for narrow micro problems, not as the first implementation path.

## Bottom Line

The repo already contains enough groundwork to make this realistic:

- algorithmic AI
- tactical analysis
- doctrine profiles
- AI-vs-AI local runs
- command hierarchy metadata

What is missing is the thing that matters most for RTS:

- a continuous deterministic runtime
- a direct combat model
- an explicit commander/subordinate control stack
- and, only if desired, an optional director layer that shapes pressure and adaptation without issuing orders

So the right next move is not "invent a magic RTS brain."

It is:

- formalize the commander layer
- add subordinate layers
- build the runtime they can actually control

If later we want adaptive anti-cheese behavior, we can add a director layer above that stack without overturning the main research conclusion.

## Project Artifacts Reviewed

- `AI-OPPONENT-PLAN.md`
- `CLADUE-CHAT-DISCUSSION-14.md`
- `docs/FEATURE_LIST.md`
- `docs/AIR_FORCES_DESIGN.md`
- `docs/AI_RESEARCH_TASK3_NON_RTS_MEMO.md`
- `src/simulation/algorithmicAi.js`
- `src/simulation/tacticalAnalysis.js`
- `src/simulation/aiPathfinding.js`
- `src/simulation/movementSimulator.js`
- `src/simulation/detectionEngine.js`
- `src/simulation/orderComputer.js`
- `src/simulation/orderTypes.js`
- `src/simulation/turnPhases.js`
- `src/simulation/orchestrator.js`
- `src/simulation/SimGame.jsx`
- `server/gameEngine.js`
- `server/aiPlayer.js`

## External Sources

- Guerrilla Games, `Killzone 2 Multiplayer Bots`:
  [https://www.guerrilla-games.com/read/killzone-2-multiplayer-bots](https://www.guerrilla-games.com/read/killzone-2-multiplayer-bots)
- Guerrilla Games, `HTN Planning in Decima`:
  [https://www.guerrilla-games.com/read/htn-planning-in-decima](https://www.guerrilla-games.com/read/htn-planning-in-decima)
- GDC Vault, `Three Approaches to Halo-style Behavior Tree AI`:
  [https://www.gdcvault.com/play/760/Three-Approaches-to-Halo-style](https://www.gdcvault.com/play/760/Three-Approaches-to-Halo-style)
- GDC Vault, `Building a Better Battle: HALO 3 AI Objectives`:
  [https://gdcvault.com/play/497/Building-a-Better-Battle-HALO](https://gdcvault.com/play/497/Building-a-Better-Battle-HALO)
- Jeff Orkin, `Three States and a Plan: The A.I. of F.E.A.R.`:
  [https://madwomb.com/tutorials/gamedesign/prototyping/gdc2006_JeffOrkin_AI_FEAR.pdf](https://madwomb.com/tutorials/gamedesign/prototyping/gdc2006_JeffOrkin_AI_FEAR.pdf)
- Game AI Pro 3, `Dragon Age Inquisition's Utility Scoring Architecture`:
  [https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter31_Behavior_Decision_System_Dragon_Age_Inquisition%E2%80%99s_Utility_Scoring_Architecture.pdf](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter31_Behavior_Decision_System_Dragon_Age_Inquisition%E2%80%99s_Utility_Scoring_Architecture.pdf)
- Michael Booth, `The AI Systems of Left 4 Dead`:
  [https://valvearchive.com/archive/Other%20Files/Publications/ai_systems_of_l4d_mike_booth.pdf](https://valvearchive.com/archive/Other%20Files/Publications/ai_systems_of_l4d_mike_booth.pdf)
- GDC Vault, `Building Fear in Alien: Isolation`:
  [https://www.gdcvault.com/play/1021852/Building-Fear-in-Aliens](https://www.gdcvault.com/play/1021852/Building-Fear-in-Aliens)
- MCV/Develop, `A tiger in the office: how Alien: Isolation's xenomorph took shape`:
  [https://mcvuk.com/business-news/a-tiger-in-the-office-how-alien-isolations-xenomorph-took-shape/](https://mcvuk.com/business-news/a-tiger-in-the-office-how-alien-isolations-xenomorph-took-shape/)
- Game Developer, `The Perfect Organism: The AI of Alien: Isolation`:
  [https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation)
- Game Developer, `Revisiting the AI of Alien: Isolation`:
  [https://www.gamedeveloper.com/design/revisiting-the-ai-of-alien-isolation](https://www.gamedeveloper.com/design/revisiting-the-ai-of-alien-isolation)
- Michael van Lent et al., `A Tactical and Strategic AI Interface for Real-Time Strategy Games`:
  [https://www.cs.auckland.ac.nz/courses/compsci767s2c/resources/Papers/WS04-04-007.pdf](https://www.cs.auckland.ac.nz/courses/compsci767s2c/resources/Papers/WS04-04-007.pdf)
- Journal of Computers in Education, `Chain of command in autonomous cooperative agents for battles in real-time strategy games`:
  [https://link.springer.com/article/10.1007/s40692-018-0119-8](https://link.springer.com/article/10.1007/s40692-018-0119-8)
- AAAI, `Goal-Directed Hierarchical Dynamic Scripting for RTS Games`:
  [https://cdn.aaai.org/ojs/18742/18742-52-22402-1-10-20210928.pdf](https://cdn.aaai.org/ojs/18742/18742-52-22402-1-10-20210928.pdf)
- Creative Assembly, `Total War: WARHAMMER III Improving AI in Campaign`:
  [https://community.creative-assembly.com/total-war/total-war-warhammer/blogs/65Abonne](https://community.creative-assembly.com/total-war/total-war-warhammer/blogs/65Abonne)
- Andre Arsenault, `Have Fun Storming the Castle! Siege Battle AI in Total War: Warhammer`:
  [https://media.gdcvault.com/gdc2016/Presentations/Arsenault_Andre_Have_Fun_Storming.pdf](https://media.gdcvault.com/gdc2016/Presentations/Arsenault_Andre_Have_Fun_Storming.pdf)
- IEEE Spectrum, `Mind Games`:
  [https://spectrum.ieee.org/mind-games](https://spectrum.ieee.org/mind-games)
- Sony Group, `Gran Turismo Sophy - An AI Breakthrough`:
  [https://www.sony.com/en/SonyInfo/blog/2022/02/17/](https://www.sony.com/en/SonyInfo/blog/2022/02/17/)
- Nature, `Outracing champion Gran Turismo drivers with deep reinforcement learning`:
  [https://www.nature.com/articles/s41586-021-04357-7](https://www.nature.com/articles/s41586-021-04357-7)
- Nature, `Grandmaster level in StarCraft II using multi-agent reinforcement learning`:
  [https://www.nature.com/articles/s41586-019-1724-z](https://www.nature.com/articles/s41586-019-1724-z)
