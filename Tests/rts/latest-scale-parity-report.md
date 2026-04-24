# RTS Scale Parity Report

## 80 Total Units

- Seed: 9080
- Hash parity: pass
- State hash: `1136410e9926012ff279a1b0bb070cea1567954a1881d6ed9c266910a4c3471a`
- Replay hash: `bfb8fa8f9780e83a87058f025177ae56adf96a210b8611c89dcf4781428b42d8`
- Provenance hash: `2c3b799006ff40577305e385d9be7ea4a9be183a13f9b4d075d2611811894852`
- Winner: none
- Victory reason: none
- Elapsed: 30.0s
- Living units: actor_1=40, actor_2=40
- VP: actor_1=0, actor_2=0
- Commands logged: 80
- Events logged: 169
- AI decisions: 200

## 100 Total Units

- Seed: 9100
- Hash parity: pass
- State hash: `0e8cfdfa183012aec53fd7fd7b580d15f881459b8cffe38fcf89364be782df60`
- Replay hash: `6551b93f989b6b3e0cf07cd988a02c318a50a931013d7f96af6ce4e54b6ff59b`
- Provenance hash: `86d944cb3cfea6402c3b22dfe3fbd8cd017ece6f081c8bf7250427232b368822`
- Winner: none
- Victory reason: none
- Elapsed: 30.0s
- Living units: actor_1=50, actor_2=50
- VP: actor_1=0, actor_2=0
- Commands logged: 100
- Events logged: 200
- AI decisions: 200


## Tie Regressions

- Spotter tie expected `blue_spotter_b`, observed `blue_spotter_b`
- Combat tie expected `red_alpha`, observed `red_alpha`

## Checks

- [pass] 80 Total Units hash parity
- [pass] 100 Total Units hash parity
- [pass] Equal-quality spotter tie preserved the later global-order spotter
- [pass] Equal-score combat tie preserved the earlier global-order target
