# RTS AI Smoke Report

- Status: passed
- Run: `rts-ai-2026-04-23T19-43-19-901Z-84e5a6`
- Time: 2026-04-23T19:43:30.879Z

## Checks

- [pass] Same-seed AI-vs-AI runs produced identical normalized state hashes
- [pass] Same-seed AI-vs-AI runs produced identical replay hashes
- [pass] Same-seed AI-vs-AI runs produced identical AI provenance hashes
- [pass] AI produced director, subordinate, commander, and executor decision traces
- [pass] Standard mode kept extended AI summaries and diaries disabled
- [pass] LLM Summary mode produced prompt-ready per-actor summaries without enabling the full diary
- [pass] Full Diary mode captured decision, order, thought, and perception events together
- [pass] All AI provenance tags stayed within the legal fog-of-war set
- [pass] AI run emitted perception snapshots for later replay/debug inspection
- [pass] AI run persisted subordinate task queues and status reports
- [pass] AI run persisted subordinate local group plans in live state and replay snapshots
- [pass] Director telemetry captured bounded packet state for replay/debug review
- [pass] Replay snapshots retained perception and director summaries
- [pass] Multi-zone director packets carried primary, secondary, and supporting zone intents
- [pass] Lower-VP support zones were chosen to shape a higher-VP assault when the terrain warranted it
- [pass] Commander replay snapshots retained zone-role plans with edge or lane metadata
- [pass] Multi-zone AI plans spread tasking across more than one zone instead of one pure dogpile
- [pass] No side kept more than 60% of maneuver owners on one zone for over 90 continuous seconds while multiple non-friendly zones remained
- [pass] Cross-zone maneuver plans never dropped lane assignment and never double-booked a narrow lane
- [pass] Staging hexes stayed on the correct side of the chosen lane
- [pass] RTS AI generated plain-English commander and director thoughts
- [pass] RTS AI thoughts refreshed on a 15-second cadence and landed in telemetry/replay
- [pass] AI run generated command and event telemetry
- [pass] Stock AI duel formed fires owners and issued ammo-typed fire missions for artillery actors
- [pass] Support units spent at least 80% of sampled time in rear, transition, or staging zones
- [pass] Mixed owners containing artillery were treated as support owners and never assigned reserve release roles
- [pass] Mixed support owners stamped fire-mission metadata only onto indirect-fire units while maneuver elements held the support anchor
- [pass] Counter-battery artillery targeted enemy guns ahead of armor when both were visible in the tasked zone
- [pass] Artillery could queue area fire from spotter memory without a direct unit lock or live visual contact
- [pass] Artillery could launch preparatory area fire on a planned assault hex even with no spotter history or live contact
- [pass] Artillery held fire while moving and resumed only after emplacement
- [pass] Main-effort and supporting-attack plans stayed anchored to real objective hexes or bounded approach rings
- [pass] HQs stayed out of contested or overexposed frontline zones for at least 85% of sampled time
- [pass] No single hex accumulated more than six stack-limit collisions in the long multi-zone run
- [pass] Zone-role tasks can complete on zone control recovery without literal VP-hex stacking
- [pass] Neutral objectives accumulate candidate hold progress and promote to awarded control once the hold window completes
- [pass] Opening bootstrap seeds uncontested anchor zones before the first AI plan
- [pass] Live VP wins require every critical objective, while timeout wins only require crossing the VP threshold at 30 minutes
- [pass] Blind commanders still formed a bounded screen package while scout flights stayed off dedicated screen ownership
- [pass] Commander operations persist across adjacent reviews, capture deep-review timestamps, and can spawn support operations
- [pass] Commander state records whether director advice was accepted, deferred, or rejected
- [pass] VP zone outline geometry is stable and produces perimeter segments for both single and merged objective zones
- [pass] Profile, reserve, and think-budget tuning changed the AI behavior
- [pass] High reserve-patience profiles held back more reserves than low-patience profiles
- [pass] High rear-security bias preserved at least as much rear-security tasking as low-bias profiles
- [pass] High neutral-zone opportunism preserved at least as much early multi-zone breadth as cautious profiles
- [pass] High support-by-fire bias preserved artillery support tasking, fire missions, and ammo assignment volume against the aggressive baseline
- [pass] High pocket-relief bias favored relief plans more strongly in the encirclement scenario
- [pass] RTS spectator/debug UI references zone-based hypotheses instead of stale point targets

## Outcome

- Winner: none
- Victory reason: none
- Elapsed: 40.0s
- Living units: actor_1=6, actor_2=6
- VP: actor_1=0, actor_2=0
- Commands logged: 13
- Events logged: 25
- AI decisions: 81
- State hash: `2e64a05496172a5178f1fe9da01052bc1fde5d87a230589f2050114544c35be3`
- Replay hash: `8349a79f1a81b08c3b1560c90189d2894879bdad35563e650bb7849cc5e2294b`
- Provenance hash: `fefedd15a7f22ded5564e865e61c51acac60fb0fa4c24d9a1350980853098c04`
- Tick stats: avg 5.173ms, p95 6.282ms, max 30.346ms

## Provenance

- Provenance tags: directorHint, doctrine, lastKnown
- Decision sources: director, commander, subordinates
- Cautious profile hash: `f81d7fd76dfc83cf7a879dfd8e675e62368dee0acf5c0337bf23e41c2d1af996`
- Aggressive profile hash: `6f4beb163579630f57c91eecd0e43bc35e98d24289442a02b99651ad60616b22`
- Log modes: standard summaries=0, standard diary=0, llm-summary actors=2, llm-summary history depth=4, full-diary entries=136
- Full diary kinds: combat_event, command_event, decision, order_issue, perception_delta, thought_snapshot
- Support residency: actor_1=100% / actor_2=100%
- Default artillery doctrine: actor_1=fires:1, missions:20, ammo:18 / actor_2=fires:1, missions:20, ammo:18
- Mixed support-owner regression: role=rear_security, kind=rear_security
- Mixed fire-mission regression: mission=mixed-fire-mission-task, infantry-anchor=2,6
- Counter-battery regression: target=artillery, queued=yes
- Over-horizon area-fire regression: queued=yes, detected=0, contacts=0
- Preparatory area-fire regression: queued=yes, last-known=0, contacts=0
- Emplacement regression: arrived=yes, moving-fire=no, emplaced-fire=yes
- Zone recovery regression: completed=no, invalidated=yes, next-role=screen
- Objective approach coverage: none
- HQ exposure: actor_1=0% / actor_2=0%
- Stack-limit hotspot peak: 1
- Concentration violations: 0

## Notes

- This harness runs the Cold War AI duel twice with the same seed to catch nondeterministic commander/director behavior.
- The provenance check is deliberately strict: any tag outside the legal FOW vocabulary fails the run.
- The sustained spread check uses the long multi-zone run and ignores late-game states where only one non-friendly zone remains.
