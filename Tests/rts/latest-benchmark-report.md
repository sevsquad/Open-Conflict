# RTS Benchmark Report

- Run: `rts-benchmark-2026-04-23T19-35-35-993Z-1d566d`
- Time: 2026-04-23T19:38:18.316Z

## Scenario Results

### AI Duel

- Iterations: 3
- Tick cap per run: 160
- Stop on winner: no
- Average tick cost: 8.425ms
- Average wall time per run: 1386.216ms
- Average ticks executed: 160
- Average simulated seconds per wall second: 29.256x
- Peak tick cost: 56.785ms

- Seed 2468: 160 ticks, wall 1388.561ms, avg 8.427ms, p95 12.491ms, max 56.785ms, winner none (none), speed 28.807x, replay `773e81689b9e0f3f6bd8fd7b2e4758e18fb51b154a593e6d5d40e8bacb1490f6`
- Seed 2469: 160 ticks, wall 1187.349ms, avg 7.216ms, p95 9.696ms, max 25.967ms, winner none (none), speed 33.688x, replay `bac8496560774fde6cfe10adcdce05c88270bb6af3fe4c93588da175ecb06c80`
- Seed 2470: 160 ticks, wall 1582.738ms, avg 9.632ms, p95 13.503ms, max 17.416ms, winner none (none), speed 25.273x, replay `6760100256f07dde2380f65024573c3149d28def7c52efa863041f012d8d1b28`

### Helo Corridor

- Iterations: 3
- Tick cap per run: 72
- Stop on winner: no
- Average tick cost: 5.742ms
- Average wall time per run: 428.936ms
- Average ticks executed: 72
- Average simulated seconds per wall second: 34.973x
- Peak tick cost: 12.867ms

- Seed 1357: 72 ticks, wall 429.132ms, avg 5.753ms, p95 8.213ms, max 12.867ms, winner actor_2 (vp_goal), speed 34.954x, replay `07c5675efb6b8422f9326370ff58ea5d41cf87cd863184c90bb3a9cb87c7dc47`
- Seed 1358: 72 ticks, wall 424.356ms, avg 5.671ms, p95 7.585ms, max 8.984ms, winner actor_2 (vp_goal), speed 35.348x, replay `d2817c1d156c782cae6b9e877518fcd05838c9906abb1cdf62d1b4966cb63abd`
- Seed 1359: 72 ticks, wall 433.319ms, avg 5.803ms, p95 8.13ms, max 10.012ms, winner actor_2 (vp_goal), speed 34.617x, replay `fbb2e3b54849ab425b8437a58d4669c5209abb89dd4cfd7439f14f7fba3677bf`

### AI Duel Terminal

- Iterations: 3
- Tick cap per run: 2400
- Stop on winner: yes
- Average tick cost: 21.703ms
- Average wall time per run: 52289.393ms
- Average ticks executed: 2400
- Average simulated seconds per wall second: 11.477x
- Peak tick cost: 65.163ms
- Note: Runs until a real terminal state with a 10-minute cap, 20-second objective hold, and a 45 VP threshold.

- Seed 8642: 2400 ticks, wall 53372.489ms, avg 22.148ms, p95 29.524ms, max 63.835ms, winner draw (time_limit), speed 11.242x, replay `160f7615f7e12ae0e49d73e1af9cc0f384a01eb37f0ebd8a8459275198e8b0d1`
- Seed 8643: 2400 ticks, wall 52065.345ms, avg 21.613ms, p95 27.561ms, max 59.973ms, winner draw (time_limit), speed 11.524x, replay `4eb4893cbf965f7e97a5af35b22dbc7829a60c10f72816168c5d253e9ca952b4`
- Seed 8644: 2400 ticks, wall 51430.344ms, avg 21.348ms, p95 28.955ms, max 65.163ms, winner draw (time_limit), speed 11.666x, replay `cbe79768fd6b126a6738ba3ec27b52f53aebe2b8f3441ab895277d08e2715473`

