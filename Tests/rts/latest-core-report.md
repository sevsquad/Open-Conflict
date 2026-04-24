# RTS Core Smoke Report

- Status: passed
- Run: `rts-core-2026-04-23T19-43-19-901Z-3e04ab`
- Time: 2026-04-23T19:43:25.376Z

## Checks

- [pass] Base RTS movement now stays in transit after 12 ticks instead of finishing the first hex hop
- [pass] Same-seed conflict run produced identical normalized state hash
- [pass] Same-seed conflict run produced identical replay hash
- [pass] Simultaneous arrival allowed two friendlies to share hex 8,3
- [pass] A third friendly was denied once hex 8,3 reached the two-unit stack cap
- [pass] Duration limit ended an otherwise idle match on time
- [pass] Delayed-release units ignored commands before their timer elapsed
- [pass] Initial objective controllers seed RTS ownership before the first tick
- [pass] Suppression interrupts transit and logs the halt
- [pass] Stale parent HQ references were normalized to a live headquarters unit
- [pass] All six VP clustering fixtures produced the expected source-zone merges
- [pass] Equidistant cells became explicit boundary hexes and did not count toward any zone interior
- [pass] Shared boundary hexes still produced the expected inter-zone edge
- [pass] Every generated lane resolved to the correct ingress and egress zone in both directions
- [pass] Same-seed helicopter run produced identical normalized state hash
- [pass] Replay from the 130-tick snapshot matched the uninterrupted helicopter run
- [pass] Helicopter insertion logged embark and disembark events
- [pass] Infantry ended the run disembarked on the map
- [pass] Air and airmobile units did not consume ground hex occupancy slots
- [pass] Air-only or airmobile-only presence did not capture RTS objectives
- [pass] Transport helicopter took resource or combat stress while crossing the AD threat area
- [pass] Smoke area effects blocked LOS while active and released it after expiry
- [pass] Illumination area effects increased friendly detection inside the lit ring
- [pass] Enemy artillery fire created a counter-battery queue entry and the next friendly fires owner received a counter-battery mission

## Conflict Scenario

- Winner: none
- Victory reason: none
- Elapsed: 45.0s
- Living units: actor_1=6, actor_2=6
- VP: actor_1=0, actor_2=0
- Commands logged: 2
- Events logged: 14
- AI decisions: 0
- State hash: `70fbc8dc932909a27e2f670d2369c0b282e61d9efcf90dbad4de4d04f558a797`
- Replay hash: `32b39fa338f2f7889e635d8fa13f60bf644c266e926ddab1d1acd114a8889471`
- Tick stats: avg 4.012ms, p95 4.874ms, max 9.224ms

## Timed Scenario

- Winner: draw
- Victory reason: time_limit
- Elapsed: 60.0s
- Living units: actor_1=6, actor_2=6
- VP: actor_1=0, actor_2=0
- Commands logged: 0
- Events logged: 13
- AI decisions: 0
- State hash: `cc929f38191af488e03ba33ecd6ffe672a87518443666989231d428d5db567d8`
- Replay hash: `660f0686f387025bbfca04c05845c6f297406cf72564f8e9f1e361662f02dd79`
- Tick stats: avg 0.752ms, p95 1.265ms, max 2.017ms

## Helicopter Scenario

- Winner: none
- Victory reason: none
- Elapsed: 65.0s
- Living units: actor_1=3, actor_2=4
- VP: actor_1=0, actor_2=40
- Commands logged: 4
- Events logged: 96
- AI decisions: 0
- State hash: `44ee403d096b6b57cbeb484c41a8907f0c70f9fadaf75bcbdd7f2732253e35e5`
- Replay hash: `726e8c2a3495c59a7e4bf4540b31dd0d626289517145256ba4b180e96426b550`
- Tick stats: avg 3.77ms, p95 4.396ms, max 7.805ms

## Notes

- Conflict smoke checks deterministic occupancy resolution when two friendlies converge on the same hex on the same tick.
- Timed smoke verifies that duration-limited matches terminate cleanly even without VP capture or force destruction.
- Helicopter smoke exercises embark, transit, AD exposure, disembark, and snapshot-resume determinism.
- Smoke LOS regression: baseline=seen, active-smoke=blocked, expired=seen.
- Illumination regression: baseline=not-seen, illuminated=seen.
- Counter-battery regression: queued=yes, mission=counter_battery -> 0,1.
