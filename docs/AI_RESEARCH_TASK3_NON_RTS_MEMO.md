# Task 3 Memo: Excellent Non-RTS Game AI and What Transfers to an RTS

## Purpose

This memo surveys respected game AI examples outside traditional RTS and evaluates which techniques are most transferable into a real-time wargame mode for `open-conflict`, especially one that must run locally and use no LLM at runtime.

It is written to support the project's existing algorithmic-AI direction in:

- `AI-OPPONENT-PLAN.md`
- `DESIGN_NOTES_tactical_awareness.md`

## Executive Summary

The strongest transferable ideas do **not** come from one "gold standard AI brain." They come from stacking several layers:

1. **Commander / battle-shaping layer**
   - Best exemplars: `Halo 3`, `Total War`, `Left 4 Dead AI Director`
   - Use for objectives, reserve release, attack axes, tempo, pressure, and scenario pacing.
2. **Tactical action-selection layer**
   - Best exemplars: `F.E.A.R.`, `Halo 2`, `XCOM`
   - Use for maneuver, local attack decisions, cover selection, firing priorities, breach timing, and role-based behavior.
3. **Spatial knowledge / affordance layer**
   - Best exemplars: `The Sims`, `Hitman`, `Total War`
   - Use for smart objectives, crossing points, chokepoints, tactical positions, search zones, and role assignment.
4. **Specialized learned micro layer**
   - Best exemplar: `Gran Turismo Sophy`
   - Use only in narrow, high-value domains where symbolic methods are weak and training is feasible, such as vehicle handling, evasive movement, or benchmark sparring agents.

For `open-conflict`, the best near-term architecture is a **hybrid symbolic stack**, not a pure planner, pure behavior tree, or pure machine learning solution:

- doctrine-aware objective selection
- spatial analysis and influence/control maps
- hypothesis generation
- unit or formation-level scoring/utility
- role/tactic assignment
- bounded coordination/search
- optional meta-director for scenario pacing

`Gran Turismo Sophy`-style reinforcement learning is promising, but only as a later, narrow module. It is not the best first implementation path for the main commander brain.

## Selection Logic

I prioritized primary sources and well-documented public cases with enough technical detail to say something concrete about transferability. That favored:

- developer talks
- official or near-official slide decks
- papers
- official studio or platform writeups

I did **not** give full treatment to some otherwise interesting categories, especially football/sports-management and some grand-strategy titles, because public implementation detail is thinner or more fragmented than for `F.E.A.R.`, `Halo`, `Left 4 Dead`, `Hitman`, `Total War`, and `Gran Turismo Sophy`.

## Findings by Case

### 1. F.E.A.R.

**Why it is respected**

`F.E.A.R.` is still one of the canonical examples of combat AI that felt coordinated, aggressive, and legible to players. Its enemies seemed to flank, suppress, retreat, and work together in ways players interpreted as genuinely tactical.

**Underlying technique**

The core technique was **Goal-Oriented Action Planning (GOAP)** with a shared working-memory model and very small execution state machinery. Orkin's talk explicitly frames the value as reducing brittle hand-authored transitions and allowing runtime plan construction from goals, preconditions, effects, and action costs.

**What transfers to RTS**

- Strong fit for local tactical problem solving:
  - "take crossing"
  - "suppress threat"
  - "disengage damaged unit"
  - "secure VP"
  - "reposition for support"
- Strong fit for scarce or high-value assets:
  - engineers
  - recon teams
  - artillery observers
  - air-mobile units
- Strong fit for the project's existing idea of 2-3 operation hypotheses plus bounded portfolio search.

**Risks and limits**

- Pure GOAP does not by itself solve large-scale command across many simultaneous units.
- Authoring actions, world state facts, and procedural preconditions/effects gets expensive.
- Planners can become hard to debug once many units are re-planning at once.
- A unit-level planner without a commander layer will often look tactically clever but operationally incoherent.

**RTS verdict**

Very strong as a **subordinate brain** or high-value-unit decision layer. Weak as the only commander architecture.

**Sources**

- Jeff Orkin, "Three States and a Plan: The A.I. of F.E.A.R." (GDC 2006): <https://madwomb.com/tutorials/gamedesign/prototyping/gdc2006_JeffOrkin_AI_FEAR.pdf>

### 2. Halo 2 / Halo 3

**Why it is respected**

`Halo` combat is famous because the enemies feel readable, varied, and coordinated without looking robotic. The series is also one of the most influential public examples of behavior-tree-era combat AI and squad/objective control.

**Underlying technique**

Public Bungie material points to a layered approach:

- `Halo 2`: scalable hierarchical behavior selection, usually discussed as Halo-style behavior trees / behavior DAGs, built for transparency, hackability, customizability, and variation.
- `Halo 3`: a higher-level **AI objectives** system for getting many NPCs to perform coherent tasks in battle.

The important lesson is not "behavior trees beat planners." It is that Bungie split the problem into:

- local behavior selection
- squad or group orders
- spatial organization
- designer-directable objectives

**What transfers to RTS**

- Excellent fit for a **commander-and-subordinate** model.
- Strong template for:
  - formation or platoon roles
  - explicit attack/hold/guard/assault orders
  - objective ownership
  - reserve tasks
  - zone-based control of unit groups
- Especially useful for `open-conflict` because the project already wants structured tactical context, doctrine profiles, and operation hypotheses.

**Risks and limits**

- Behavior trees can explode in authoring scope if used as the only decision system.
- Trees are good at execution structure, but weaker at whole-battle tradeoff reasoning unless paired with utility or objective layers.
- Halo's strong results depended heavily on level design and authored control of space.

**RTS verdict**

One of the best blueprints for the **overall runtime shape** of an RTS AI stack: commander objectives above subordinate execution brains.

**Sources**

- Damian Isla, "Managing Complexity in the Halo 2 AI System" (GDC 2005): <https://www.gdcvault.com/play/1020270/Managing-Complexity-in-the-Halo>
- "Three Approaches to Halo-style Behavior Tree AI" (GDC 2007): <https://www.gdcvault.com/play/760/Three-Approaches-to-Halo-style>
- Damian Isla, "Building a Better Battle: HALO 3 AI Objectives" (GDC 2008): <https://gdcvault.com/play/497/Building-a-Better-Battle-HALO>
- Bungie weekly update referencing the Halo 3 objectives talk: <https://halo.bungie.org/bwu/index.html?item=164>

### 3. The Sims

**Why it is respected**

`The Sims` is one of the industry's most important autonomy successes. It produced characters that looked self-directed and generative without requiring heavyweight deliberation for every action.

**Underlying technique**

The key public concept is **smart terrain / smart objects**. The Sims themselves are driven by needs or motives, while objects in the world advertise how they satisfy those needs. Intelligence is therefore distributed between agents and environment affordances rather than stored entirely inside each agent.

**What transfers to RTS**

- Extremely useful for a real-time wargame:
  - bridges advertise "crossing" affordances
  - ridge hexes advertise "overwatch" or "observation" value
  - strongpoints advertise "defend/occupy" roles
  - supply nodes advertise "resupply/refit" value
  - roads advertise maneuver speed value
- Good fit for the project's tactical-awareness discussion:
  - approach route scoring
  - VP objective threat assessment
  - sector summaries
  - combined-arms pairing
- Also useful for "commander mode": the player can assign intent while environment-marked affordances help subordinates execute it sensibly.

**Risks and limits**

- Need satisfaction alone is too local and can produce greedy or oscillating behavior.
- Strong affordance systems need careful weighting or units will chase the nearest useful-looking object instead of following the operational plan.
- This technique needs a commander layer above it to avoid "smart local stupidity."

**RTS verdict**

Outstanding as a **world-knowledge and affordance representation**, not a complete warfighting brain by itself.

**Sources**

- IEEE Spectrum, "Mind Games" discussion of The Sims smart terrain: <https://spectrum.ieee.org/mind-games>
- GDC Vault, "Emergent Storytelling Techniques in 'The Sims'": <https://www.gdcvault.com/play/1025112/>

### 4. Left 4 Dead AI Director

**Why it is respected**

`Left 4 Dead` is one of the classic examples of meta-AI. Players remember it because it created pacing, replayability, tension spikes, and recovery windows that felt authored even though they were procedural.

**Underlying technique**

Valve's public material describes the AI Director as a **meta-level pacing controller**. It monitors survivor-team "emotional intensity" and modulates enemy population, items, and event timing to create peaks and valleys of dramatic pressure. Booth explicitly notes that the system adjusts **pacing, not difficulty**.

**What transfers to RTS**

- Strong fit for any RTS mode that wants:
  - scenario pacing
  - escalation waves
  - reinforcement timing
  - dynamic event injection
  - PvE campaign tension control
- Useful for a "battle director" layer above unit AI:
  - when to escalate
  - when to release reserves
  - when to trigger recon pressure
  - when to intensify attrition
- Could be valuable for tutorial or solo campaign variants where the game wants to maintain dramatic tempo without obvious cheating.

**Risks and limits**

- Dangerous for symmetric competitive or simulation-first play if it over-corrects outcomes.
- Can feel fake or rubber-banded if players detect the hand on the scale.
- Best when used for content pacing and pressure management, not to overwrite the actual tactical model.

**RTS verdict**

Excellent as a **meta-AI director** for pacing and event control. Not a replacement for commander decision-making.

**Sources**

- Michael Booth, "The AI Systems of Left 4 Dead" (AIIDE 2009): <https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf>

### 5. XCOM: Enemy Unknown

**Why it is respected**

`XCOM` enemy behavior is respected because alien types feel distinct, their actions are tactically legible, and the AI generally creates interesting pressure with relatively simple building blocks.

**Underlying technique**

Public descriptions from Firaxis's GDC talk emphasize **enumeration and scoring**:

- reachable tiles are scored for movement
- abilities are scored for use after movement
- different enemy types weight the same factors differently

This is best understood as a tactical **utility/scoring system** tuned per archetype rather than a large symbolic planner.

**What transfers to RTS**

- Great for per-unit or per-formation local decisions:
  - best reachable firing position
  - best support position
  - best fallback tile
  - best attack mode
- Strong fit for doctrine-based variation:
  - melee/close-assault archetypes
  - cautious support-fire archetypes
  - bodyguard or screen archetypes
  - breakthrough units that discount cover and prioritize damage
- Directly compatible with the project's interest in profile divergence and bounded candidate generation.

**Risks and limits**

- Real-time large-unit RTS will make full tile enumeration expensive unless heavily pruned.
- Pure scoring can become predictable if the utility features are too visible.
- This model usually needs some information advantages, approximations, or heuristics to stay performant.

**RTS verdict**

Very strong as the **default tactical evaluator** beneath a commander layer.

**Evidence note**

Public technical detail is thinner here than for `F.E.A.R.` or `Left 4 Dead`. The movement/ability scoring description below comes from Firaxis's GDC session overview plus a contemporaneous conference report summarizing the talk.

**Sources**

- GDC Vault, "AI Postmortems: Assassin's Creed III, XCOM: Enemy Unknown, and Warframe": <https://www.gdcvault.com/play/1018223/AI-Postmortems-Assassin-s-Creed>
- MCV/Develop summary of Alex Cheng's GDC 2013 talk: <https://mcvuk.com/development-news/gdc-13-inside-x-coms-hidden-movement/>

### 6. Hitman: Absolution

**Why it is respected**

`Hitman` is respected less for tactical combat brilliance and more for creating a living social-stealth space where many NPCs coordinate responses, escalate suspicion, and occupy roles in a readable way.

**Underlying technique**

The public material points to layered AI plus "situations":

- NPCs subscribe to a shared situation object when a coordinated response is needed
- the situation assigns roles such as leader/other
- the situation updates shared context and influences participant behavior

This is basically a **local incident coordinator** that sits above individual AI.

**What transfers to RTS**

- Very useful for local battlefield incidents:
  - a breach response
  - cordon and search
  - pursuit and screening
  - recovery of a threatened objective
  - bridgehead reaction
- Could handle temporary coordination problems without needing the top-level commander to micromanage every unit.
- Good pattern for subcommanders who need to form ad hoc local groups around events.

**Risks and limits**

- Situation-specific logic can scatter across many actors and become brittle.
- Social-stealth assumptions do not directly map to battlefield maneuver.
- Heavy authoring burden if every incident type becomes bespoke.

**RTS verdict**

Useful as a **local coordination middleware** layer. Not a full strategic AI.

**Sources**

- GDC Vault, "Creating the AI for the Living, Breathing World of Hitman: Absolution": <https://gdcvault.com/play/1017802/Creating-the-AI-for-the>
- AAAI paper discussing Hitman: Absolution "situations" and role assignment: <https://cdn.aaai.org/ojs/12715/12715-52-16232-1-2-20201228.pdf>

### 7. Total War: Warhammer siege/battle AI

**Why it is respected**

`Total War` is one of the closest relatives to an RTS wargame problem because it must coordinate large numbers of semi-autonomous units in real time over complex terrain while still supporting higher-level tactics.

**Underlying technique**

Creative Assembly's siege AI talk shows a highly structured battle stack:

- battle model
- siege battle AI architecture
- attack-focus and assault-designation scoring
- settlement and influence graphs
- entry point managers
- tactic modules for gates, walls, breaches, storming, and reserves
- coordination between tactics

This is classic **hierarchical orchestration** over spatial analysis plus tactic managers.

**What transfers to RTS**

- Extremely high transfer value for:
  - entry point management
  - reserve handling
  - assault axis assignment
  - multi-group coordination
  - chokepoint and crossing logic
  - battle-space decomposition into tactic managers
- Aligns very closely with the project's desire for:
  - hypothesis generation
  - route generation
  - coordination passes
  - crossing congestion annotations
  - reserve commitment state

**Risks and limits**

- Total War leans heavily on authored hints, graphs, and battle-specific representations.
- Specialized tactic managers can be brittle when the environment or rules change.
- This architecture becomes expensive if every special case needs its own manager.

**RTS verdict**

Probably the single best public example of a **battle orchestrator** that is close to the desired problem space.

**Sources**

- Andre Arsenault, "Have Fun Storming the Castle! Siege Battle AI in Total War: Warhammer" (GDC 2016): <https://media.gdcvault.com/gdc2016/Presentations/Arsenault_Andre_Have_Fun_Storming.pdf>

### 8. Gran Turismo Sophy

**Why it is respected**

`Gran Turismo Sophy` is respected because it demonstrated superhuman performance in a real-time, physically grounded, multi-agent environment while also complying with loosely specified sportsmanship norms. It is one of the most credible public examples of modern game AI using machine learning at elite performance.

**Underlying technique**

Sony's published work describes:

- deep reinforcement learning
- mixed-scenario training
- integrated control policy for both speed and tactics
- carefully designed rewards that also encode etiquette / sportsmanship constraints

The important lesson is not just "RL can win." It is that reward design and constraint shaping were central.

**What transfers to RTS**

- Best use is narrow, not global:
  - learned vehicle handling
  - evasive maneuvers
  - dogfighting or pursuit micro
  - benchmark opponent generation
  - QA stress agents
- Promising for subproblems where symbolic methods are weak and continuous control matters.

**Risks and limits**

- Training cost is high.
- Behavior can be hard to interpret and hard to direct.
- Reward hacking is a real risk.
- Hard to integrate with designer intent, doctrine, explainability, and deterministic wargame logic.
- Poor first choice for the top-level commander brain.

**RTS verdict**

Very promising as a **specialized learned micro module** and benchmarking tool. Poor first choice for the main RTS command architecture.

**Sources**

- Nature paper: <https://www.nature.com/articles/s41586-021-04357-7>
- Sony overview: <https://www.sony.com/en/SonyInfo/blog/2022/02/17/>
- Official Gran Turismo Sophy technology page: <https://www.gran-turismo.com/us/gran-turismo-sophy/technology/>

## Cross-Case Takeaways for an RTS

### What clearly transfers well

These techniques appear repeatedly across the strongest cases:

- **Hierarchical control**
  - commander intent above subordinate execution
  - seen in `Halo`, `Hitman`, `Total War`
- **Spatial representations**
  - control maps, influence graphs, entry points, affordances, smart terrain
  - seen in `The Sims`, `Hitman`, `Total War`
- **Utility / scoring**
  - fast local evaluation of positions, abilities, roles, and threats
  - seen in `XCOM`, `The Sims`, `Total War`
- **Role and tactic assignment**
  - group units into assault, reserve, flank, screen, breach, pursue, support
  - seen in `Halo 3`, `Hitman`, `Total War`
- **Bounded deliberation**
  - planning or search only where it matters
  - seen in `F.E.A.R.` and implied by many successful hybrid systems
- **Meta-AI above unit AI**
  - pacing, escalation, reserve release, intensity control
  - seen most clearly in `Left 4 Dead`

### What does not transfer cleanly

- Purely local autonomy without operational control
- Purely script-driven special cases
- Pure behavior trees without utility or objective layers
- Pure machine learning for the whole commander stack

## Recommended Implications for `open-conflict`

### Best near-term architecture

Use a hybrid stack that combines:

1. **Commander hypothesis layer**
   - choose attack main axis / alternate axis / hold-set-conditions
2. **Spatial analysis layer**
   - influence/control maps
   - route scoring
   - sector summaries
   - crossing and chokepoint analysis
3. **Doctrine-weighted tactical scoring**
   - evaluate movement, posture, attack, support, fallback, reserve release
4. **Role/tactic coordinator**
   - assign breach groups, defenders, supports, flankers, reserves
5. **Optional bounded search**
   - compare a small portfolio of whole-plan variants
6. **Optional meta-director**
   - only for solo campaign pacing, not for fair symmetric PvP logic

### Best direct inspirations by subsystem

- **Operational hypotheses and commander/subordinate split**
  - `Halo`
  - `Total War`
- **Local tactical planning for scarce assets**
  - `F.E.A.R.`
- **Fast position and action scoring**
  - `XCOM`
- **World affordances and smart terrain**
  - `The Sims`
- **Incident coordination and ad hoc local teams**
  - `Hitman`
- **Battle pacing / escalation control**
  - `Left 4 Dead`
- **Future learned micro or benchmark opponents**
  - `Gran Turismo Sophy`

### What to avoid as the first implementation

- A monolithic GOAP-for-everything runtime
- A giant behavior tree as the only brain
- End-to-end reinforcement learning for the commander
- A "cheating director" that overrides the simulation in core competitive modes

## Bottom Line

If the goal is a strong local, non-LLM RTS AI for `open-conflict`, the best answer is not to copy one famous game wholesale.

The best transferable pattern is:

- `Total War`-style battle orchestration
- `Halo`-style commander/subordinate layering
- `XCOM`-style utility scoring
- `F.E.A.R.`-style bounded planning for special units and hard local problems
- `The Sims`-style smart terrain / affordances
- `Left 4 Dead`-style meta-AI only where pacing control is desired
- `Gran Turismo Sophy`-style RL only for narrow micro domains later

That combination matches the project's current algorithmic-opponent direction far better than either pure scripting or pure machine learning.
