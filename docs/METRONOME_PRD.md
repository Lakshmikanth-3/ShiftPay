# ShiftPay — Product Requirements Document

**Hackathon:** Monad Metropolis
**Submission deadline:** 13 Oct 2026, 11:59 PM ET
**Track:** 02 — Consumer Products & Payments

**Tagline:** **You earned it at 2pm. Why wait until the 15th?**

**One line:** ShiftPay pays wages as they are earned, second by second, so workers never borrow against money that is already theirs.

---

## Part A: ShiftPay explained simply

Read this part first. It needs no technical knowledge.

### The story in one minute

Priya works evening shifts at a café. She finishes a shift on the 2nd of the month, but her pay arrives on the 15th.
On the 5th her rent is due, so she borrows money and pays a fee to borrow her *own* wages.

ShiftPay fixes the timing. The café puts payroll money into a safe digital account first. While Priya works, her
pay grows on her phone every second. Whenever she needs money she taps **Withdraw**, and the money she has already
earned is hers within seconds. No loan, no fee. She can also send part of it to her family in another country,
and it arrives instantly.

### Who uses it

| Person | Uses | What they do |
|---|---|---|
| **The business** (the café) | A website: shiftpay-business.vercel.app | Puts payroll money in, adds employees, starts and ends shifts, sees who earned what |
| **The employee** (Priya) | A phone app: shiftpay-employee.vercel.app | Watches her pay grow, withdraws it, sends money home, keeps private payslips |

### The six steps of a working day

1. **The business adds money.** It moves dollars into the payroll vault and sets aside an amount for Priya.
2. **The business starts Priya's shift.** One click on the website.
3. **Priya's pay grows every second.** Her phone shows the number going up. It can never go above the money the
   business set aside, so the business can never owe more than it put in.
4. **Tax is set aside automatically.** A share the business chose (for example 10%) is held separately, so Priya
   only ever sees money that is really hers to take.
5. **Priya taps Withdraw.** The money moves to her account in about a second. The business pays the small
   network fee; Priya pays nothing.
6. **Priya sends money home or cashes out.** She can send dollars to anyone, or convert them to local currency
   instantly at a fixed price with no fee.

### How someone signs in (no passwords, no crypto wallet)

Both apps use a **passkey**: the same fingerprint, face or PIN you use to unlock your phone. The first time,
one scan creates the account. Later, one scan unlocks it. There is no password to forget, no 12-word recovery
phrase and no wallet app to install. Lose your phone? Sign in on a new one with the same passkey and everything
comes back.

### What is happening underneath (the parts users never see)

| Plain words | What it really is |
|---|---|
| "Safe digital account" for payroll | The **MetronomeVault** smart contract on the **Monad** blockchain. It holds the money and enforces the rules: pay only verified shifts, never more than deposited, tax kept aside. |
| "Dollars" | **USDC** and **AUSD**: digital dollars that stay worth one US dollar. AUSD is made by **Agora**. |
| The passkey account | **Mera** turns the passkey into a private key inside the browser. The key is never stored or sent anywhere and is wiped after 15 minutes. |
| "Instant send home" and "cash out" | **Agora Instant Settlement**: a fixed-price exchange contract that settles in the same transaction. |
| "The business pays the fee" | A ShiftPay **relayer** account, funded by the business, submits the employee's signed withdrawal and pays the network fee. New accounts also get a small free fee credit. |
| "Private payslips" | Payslips encrypted on the phone with a second key from the same passkey. The server stores only unreadable data. |
| The website and phone app | **Next.js** apps on **Vercel**. The business site also runs the payroll service and a **Neon Postgres** database for profiles and history. |

### Why it is safe

- **Priya cannot take more than she earned**, and never more than the business deposited.
- **The business cannot take back wages Priya already earned.** It can only take back unused money.
- **Nobody can redirect the tax money.** Its destination is fixed when the business is created.
- **The fee payer cannot steal or change a withdrawal.** It can only deliver what Priya signed.
- Every payment is recorded publicly, so either side can check it.

What ShiftPay cannot prove: that the hours were really worked. That is still the employer's word, the same as
payroll today, but now every shift is signed and recorded.

### Why Monad

At the end of a shift, many workers stop at once. Monad processes many transactions in parallel, with blocks
about every second and very low fees, so paying hundreds of people at the same moment is fast and cheap. The vault
spreads workers across 64 separate compartments so their payments do not get in each other's way.

---

## Part B: Current status, 11 Oct 2026

**Live:** business website https://shiftpay-business.vercel.app · employee phone app https://shiftpay-employee.vercel.app ·
code https://github.com/Lakshmikanth-3/ShiftPay

| Phase | Status | Evidence |
|---|---|---|
| 1. Safe payroll contract | Done | 36 unit and fuzz tests, 5 invariants (solvency, conservation, no unbacked claims, monotonic totals, all earnings funded) |
| 2. Business website and employee app | Done, live | Passkey-only accounts (Privy removed), plain dollar wording, mobile layout, pitch deck button |
| 3. Hosting | Done, live | Payroll service inside the business Vercel project on Neon Postgres; employee app relays to it; public RPC fallbacks and caching for speed |
| 4. Real testnet run | In progress | USDC vault `0xA1C794EA48A1D86294848D28E85c76328070DB24` (block 69456787, employer 1); employee 1 registered; funding fix deployed; full payroll cycle with the owner's passkey still to run; AUSD payroll vault not deployed |
| 5. Sponsor proof, user testing, videos, submission | In progress | Agora send-abroad, direct send and cash-out confirmed on chain by the automated agent; user tests and videos pending |

**Automated proof:** `npm run test:agent` drives both live sites with a virtual passkey and passed 26/26 checks on
11 Oct 2026, with real Monad transactions: send abroad via Agora Instant Settlement `0xcd3a6301…a51f0a5e`, cash out
`0xcb5e299e…2e5bfcc6`, and a brand-new business passkey creating its own company with a sponsored fee credit
`0x3770f479…326976b7`. Judges can therefore try both the employee and the business side themselves.

**Bounties entered on the portal:** Agora Cross-Border Payments, Best Mera-Powered UX, Mera: One Passkey Many Keys.
Not eligible: Best Community Team (campus not on the onboarded list). Envio: live, payroll history indexed by HyperSync (health reports `envio-hypersync ok`).

### Remaining work, in order

1. Owner: suspend employee 1, register employee 2 for the phone account, fund it, run a shift, withdraw.
2. Done: Envio HyperSync indexing live and the Envio bounty added.
3. Owner: make the GitHub repository public, or invite metropolis@hackathon.monad.xyz.
4. Owner: five-person user test ([USER_TESTING.md](USER_TESTING.md)).
5. Deploy the AUSD payroll vault and repeat the cycle in AUSD.
6. Record the technical demo (≤3 min) and pitch (≤2 min) videos; add the logo; submit.

### Known limits

- The employee app is an installable web app (works on any phone), not an app-store app.
- On testnet, Agora's pair settles AUSD to CTK only; CTK stands in for local currency.
- Withholding is a flat rate chosen by the employer and held in escrow; no tax calculation or filing.
- Shift times are recorded by the employer; the fee payer and payroll service are run by the employer.
- No revenue model is implemented yet; workers pay no fees.

## 1. The leak, quantified

| Evidence | Figure |
|---|---|
| Payday loan fees paid annually by 12M+ mostly low-income people | **$4.6B** |
| Average borrower pays in fees to repeatedly borrow **$375** | **$520** |
| Workers who accessed earned wage advances (2022) | 10M, **$32B** |
| EWA transaction growth, 2021→2022 | **+90%** |
| Workers paying at least one EWA fee | **~90%** |
| Average fees per worker per year | $68.88 across 27 transactions |
| Earned wage access market | $9.2B (2025) → $38.4B (2034) |
| Payday lending market, 2026 | $43.02B |

**The one statistic that is the entire pitch:**

> **$520 in fees to borrow $375.** People pay more than the principal to reach money they have already earned.

---

## 2. Why the leak exists

Work happens continuously. Payroll settles in a batch, every two weeks.

Between the moment labour is performed and the moment it is paid, the worker holds an **unfunded claim on their own earnings**. Rent is due on the 1st; the paycheque lands on the 15th. So the worker borrows against it, and an entire industry exists to lend people their own money back at a markup.

**The pay cycle is not a policy choice. It is a technical artefact.** Batch payroll exists because computing, verifying and settling millions of individual payments was expensive, so it was amortised over a fortnight. Earned wage access doesn't fix that — it layers a lender on top of it and charges a fee per access.

### The insight

> Remove the batch and the lender has nothing to lend against. There is no advance to fee, because there is no gap.

This is only true if settlement is cheap and massively concurrent. That is the whole reason this is a Monad product and not a 2015 product.

---

## 3. Scope — deliberately narrow

**ShiftPay is:** continuous, attested wage accrual with instant withdrawal, for hourly and shift-based workers paid by a single employer who pre-funds the payroll vault.

**ShiftPay is not:**
- a lender, an advance, or an EWA provider
- a general money-streaming protocol
- a full HR or payroll suite
- a tax filing service
- an employer-of-record

**One buyer:** the operations lead at a shift-based employer — logistics, warehousing, hospitality, delivery, BPO — who is already paying for an EWA benefit and would rather not.

**One job:** make the worker's balance reflect reality continuously, and let them take it whenever they want, at zero fee.

**Deliberate exclusion:** no credit, ever. The moment you advance unearned money you become a lender and inherit the regulatory surface you are attacking. Accrual is capped by work actually attested and money actually funded.

---

## 4. Why Monad — the honest version

Be precise here, because the obvious claim is wrong and a judge will catch it.

**Accrual itself is free and needs no transactions.** It is computed lazily on read — `earned = rate × attestedSeconds` — so a million workers accruing costs nothing. Do **not** claim a million streams means a million transactions per second. It doesn't.

The parallelism bites in three real places:

**1. Shift changes are synchronised, and that's the burst.** At 06:00, 14:00 and 22:00, tens of thousands of workers clock in or out **at the same instant**. Every attestation is an independent write to a different worker's state. A sequential chain queues them, so the last worker's clock-out confirms minutes late — and until it confirms, they cannot withdraw the wages they just earned. That is exactly the moment they want them: walking out of the building, past a shop.

**2. Withdrawal bursts.** The EWA data shows 27 withdrawals per worker per year, clustered around rent days and weekends. A million workers means ~27M withdrawals a year, heavily bursty. Independent balances, perfectly parallel — **if** the contract doesn't funnel them through a shared counter.

**3. Payroll funding sweeps** across thousands of worker allocations.

So the claim to make:

> Continuous payroll is an attestation and withdrawal burst problem, not a streaming problem. At shift change the whole workforce hits the chain at once, and every one of those writes is independent — provided the accounting never shares state. That layout is what we built.

**Precedent to acknowledge:** `Flow` placed 2nd at a Blitz with per-second value streaming. Read it. Your difference: Flow streams a committed amount over time; ShiftPay accrues against **attested work**, caps accrual at **funded balance**, and handles withholding. A wage is not a vesting schedule.

---

## 5. Architecture

```text
┌──────────────┐  signed shift record  ┌────────────────────┐
│ Timekeeping  │ ────────────────────► │ MetronomeVault.sol │
│ (employer    │   EIP-712             │ • attested accrual │
│  system or   │                       │ • funded ceiling   │
│  device)     │                       │ • withholding      │
└──────────────┘                       │ • sharded ledger   │
                                       └─────────┬──────────┘
┌──────────────┐    withdraw any time            │
│   Worker     │ ◄──────────────────────────────┘
│ (Mera passkey)│
└──────────────┘
```

The worker never pays gas and never manages keys. The employer's timekeeping system is the attestation authority. The vault is pre-funded, so no claim is ever unbacked.

---

## 6. The core mechanism

Three quantities per worker:

```text
earned     = Σ over attested shifts (ratePerSec × seconds)   ← lazy, computed
withheld   = earned × withholdingBps / 10000                  ← tax escrow
withdrawn  = cumulative taken out
claimable  = earned − withheld − withdrawn
```

Plus one hard safety rule:

```text
claimable <= allocated[worker]      // never pay what isn't funded
```

**Accrual is lazy.** Nothing is written as time passes. A shift attestation writes the shift record; `claimable()` is a view that integrates. Workers see a number ticking up in the UI that costs nobody anything.

### Mid-shift accrual

Workers want to see earnings rise *during* a shift, not after clock-out. So an open shift accrues optimistically against a clock-in attestation, capped at `maxShiftSeconds`:

```text
openSeconds = min(now − clockInAt, maxShiftSeconds)
```

On clock-out, the real duration replaces the estimate. If the worker withdrew against an over-estimate, the difference is recovered from **future accrual only** — never clawed back from their wallet. That asymmetry is non-negotiable and should be stated in the pitch; it is what separates this from an advance.

---

## 7. Contracts

### 7.1 Storage

```solidity
struct Worker {
    // slot 0
    uint128 ratePerSec;        // 6-dp stablecoin units per second
    uint128 allocated;         // employer-funded ceiling
    // slot 1  ← written on withdraw
    uint128 withdrawn;
    uint128 accruedSettled;    // from closed shifts
    // slot 2  ← written on clock in/out
    uint64  clockInAt;         // 0 = not on shift
    uint64  lastSettled;
    uint32  shard;
    uint16  withholdingBps;
    uint16  flags;             // bit0 active, bit1 suspended
    // slot 3
    address payoutAddr;
    uint64  owedBack;          // over-estimate recovery, future accrual only
    uint32  maxShiftSeconds;
}

mapping(uint256 => Worker) public workers;          // workerId → Worker
mapping(uint256 => address) public attestor;        // employerId → signer
mapping(uint256 => uint256) public allocShard;      // shard → allocated total
mapping(uint256 => uint256) public withheldShard;   // shard → tax escrow
mapping(uint256 => mapping(uint256 => uint256)) public shiftUsed; // replay bitmap
uint256 public unallocated;                         // cold path only
```

Four slots per worker. Clock-in/out writes slot 2 only. Withdrawal writes slot 1 only. **Two workers never touch the same slot.**

### 7.2 Shift attestation

```solidity
bytes32 constant SHIFT_TYPEHASH = keccak256(
  "Shift(uint256 workerId,uint64 startAt,uint64 endAt,uint128 ratePerSec,uint256 shiftId,uint64 deadline)"
);

function closeShift(
    uint256 workerId,
    uint64 startAt,
    uint64 endAt,
    uint128 ratePerSec,
    uint256 shiftId,
    uint64 deadline,
    bytes calldata sig
) external {
    require(block.timestamp <= deadline, "expired");
    require(endAt > startAt, "bad window");
    Worker storage w = workers[workerId];
    require(w.flags & SUSPENDED == 0, "suspended");

    bytes32 digest = _hashTypedData(keccak256(abi.encode(
        SHIFT_TYPEHASH, workerId, startAt, endAt, ratePerSec, shiftId, deadline
    )));
    require(ECDSA.recover(digest, sig) == attestor[employerOf[workerId]], "bad attestor");
    _useShift(workerId, shiftId);                       // replay bitmap

    uint256 gross = uint256(ratePerSec) * (endAt - startAt);

    // recover any over-estimate from THIS accrual, never from the wallet
    if (w.owedBack != 0) {
        uint256 cut = gross < w.owedBack ? gross : w.owedBack;
        gross -= cut;
        w.owedBack -= uint64(cut);
    }

    w.accruedSettled += uint128(gross);
    w.clockInAt = 0;
    w.lastSettled = uint64(block.timestamp);

    emit ShiftClosed(workerId, shiftId, startAt, endAt, gross);
}
```

### 7.3 Claimable — the view that drives the UI

```solidity
function claimable(uint256 workerId) public view returns (uint256) {
    Worker storage w = workers[workerId];
    uint256 gross = w.accruedSettled;

    if (w.clockInAt != 0) {                             // mid-shift estimate
        uint256 secs = block.timestamp - w.clockInAt;
        if (secs > w.maxShiftSeconds) secs = w.maxShiftSeconds;
        gross += uint256(w.ratePerSec) * secs;
    }
    if (w.owedBack != 0) {
        gross = gross > w.owedBack ? gross - w.owedBack : 0;
    }

    uint256 net = gross - (gross * w.withholdingBps / 10000);
    if (net <= w.withdrawn) return 0;
    uint256 avail = net - w.withdrawn;

    uint256 room = w.allocated > w.withdrawn ? w.allocated - w.withdrawn : 0;
    return avail < room ? avail : room;                 // funded ceiling
}
```

### 7.4 Withdrawal

```solidity
function withdraw(uint256 workerId, uint256 amount) external {
    Worker storage w = workers[workerId];
    require(msg.sender == w.payoutAddr || msg.sender == relayer, "not worker");
    uint256 avail = claimable(workerId);
    require(amount != 0 && amount <= avail, "exceeds claimable");

    w.withdrawn += uint128(amount);
    // only per-worker slot + one sharded total are written
    allocShard[w.shard] -= amount;

    IERC20(token).safeTransfer(w.payoutAddr, amount);
    emit Withdrawn(workerId, amount, avail - amount);
}
```

The ERC-20 transfer is unavoidable here — delivery *is* the product — but it writes the worker's own token balance plus the vault's. Shard the vault's holdings across sub-vaults by `shard` so withdrawals in different shards don't contend on one balance slot.

### 7.5 Funding and the solvency alarm

```solidity
function fundWorkers(uint256[] calldata ids, uint256[] calldata amounts) external
function allocationRunway(uint256 workerId) external view returns (uint64 seconds_)
```

`allocationRunway` returns how long the worker can keep accruing before hitting the funded ceiling. The dashboard alarms below a configured threshold. **An underfunded vault must stop accrual, never create an unbacked claim** — the instant you let claims exceed funding you have become a lender.

### 7.6 Withholding

Payroll cannot pay gross. `withholdingBps` routes a share into `withheldShard`, releasable only to the employer's designated tax address:

```solidity
function remitWithholding(uint256[] calldata shards, address taxAddr) external onlyEmployer
```

Most hackathon projects ignore this. Including it is the single clearest signal to a judge that you understand payroll rather than streaming.

### 7.7 Function surface

```solidity
createEmployer(address attestor, address taxAddr)
createWorker(uint256 workerId, WorkerConfig cfg, address payoutAddr)
setRate(uint256 workerId, uint128 ratePerSec)
setWithholding(uint256 workerId, uint16 bps)
openShift(uint256 workerId, uint256 shiftId, bytes sig)
closeShift(...)
correctShift(uint256 shiftId, uint128 correctGross, bytes sig)  // future accrual only
fundWorkers(uint256[] ids, uint256[] amounts)
withdraw(uint256 workerId, uint256 amount)
remitWithholding(uint256[] shards, address taxAddr)
suspend(uint256 workerId) / reinstate(uint256 workerId)
claimable(uint256) view
allocationRunway(uint256) view
```

---

## 8. Off-chain

### 8.1 Attestation bridge

A connector that reads shift events from the employer's timekeeping system and signs them. Build one adapter for the demo: a webhook receiver plus a simple clock-in/out PWA for workers, so the demo is end-to-end without a real HR integration.

**Batch the submission, not the execution.** Group closing shifts **by shard** and submit one transaction per shard, so Monad executes them concurrently. One large `closeShiftBatch()` call would run sequentially inside the EVM and forfeit the entire benefit — say this in the pitch.

### 8.2 Worker app

- Mera passkey sign-in (face, fingerprint or PIN), no seed phrase, no extension
- A number that ticks upward in real time, driven by the `claimable` view
- One button: **Take it now**
- Shift history with the signed attestation behind each line
- Gas sponsored by the employer via a relayer

The ticking number is the entire emotional product. Build it first and make it beautiful.

---

## 9. Tech stack (as built)

| Layer | Choice |
|---|---|
| Contracts | Solidity, Foundry, OpenZeppelin (SafeERC20, EIP-712, Clones) |
| Chain | Monad testnet, chain id 10143; public RPC with fallbacks (monadinfra, Ankr, dRPC) |
| Accounts | **Mera** passkeys (`@category-labs/mera`): PRF-derived keys, no seed phrase, no extension |
| Frontend | Next.js 16 (App Router), React 19, viem, plain CSS |
| Payroll service | Fastify app bundled into the business Next.js project, served at `/api/bridge/*` on Vercel |
| Database | Neon Postgres via the Vercel Marketplace, Prisma, one schema per token |
| Settlement | USDC and Agora AUSD; Agora Instant Settlement pair for send-abroad and cash-out |
| Indexing | Envio HyperSync feeds vault events into Postgres with a persisted cursor |

Bounty focus: **Agora cross-border payments**, **Best Mera-Powered UX** and **Mera: One Passkey, Many Keys**.
Privy was removed so Mera is the entire account layer.

---

## 10. MVP scope

### Must have
- [x] `MetronomeVault.sol` on Monad: attested accrual, funded ceiling, withholding
- [x] EIP-712 shift attestation with replay bitmap
- [x] Lazy `claimable()` with mid-shift estimate
- [x] Instant withdrawal, any amount, zero fee
- [x] Worker PWA with the live ticking balance and one-tap withdraw
- [x] Employer dashboard: funding, runway alarm, per-worker ledger
- [x] **Shift-change burst benchmark:** run on Monad testnet (16 workers, 96 transactions, 0 failures); designs equal at this scale, see benchmark/README.md
- [x] Foundry unit + invariant suite green

### Should have
- [x] Passkey login (Mera) and employer-sponsored gas
- [x] Withholding remittance flow: "Send to tax account" on the business Funding page calls `remitWithholding`
- [ ] Over-estimate recovery demo
- [ ] Clock-in/out PWA for workers — employer starts/ends verified shifts from the business dashboard instead

### Nice to have
- [ ] Overtime multipliers
- [ ] Multi-employer workers
- [ ] CSV import of a real shift roster

### Do not build
Credit or advances, a token, governance, cross-chain, tax filing, a full HR suite.

---

## 11. Demo script (3 min cap)

**0:00–0:30 — the leak.** *"Twelve million people pay four point six billion dollars a year in payday fees. The average borrower pays five hundred and twenty dollars in fees to borrow three hundred and seventy-five. That's money they already earned. They're paying a fee to reach their own wages, because payroll runs every two weeks."*

**0:30–1:10 — the product, live.** Worker clocks in on a phone. The balance starts ticking, visibly, in real time. Fast-forward four hours of shift. *"No advance. No lender. No fee. This is just what she has earned, as she earns it."* Tap **Take it now** — money arrives.

**1:10–1:50 — the honest engineering.** *"Accrual costs nothing; it's a view. The hard part is shift change."* Fire 5,000 simultaneous clock-outs at both contracts. Show the two curves. *"At two p.m. the whole warehouse clocks out at once. The naive design writes one shared total on every attestation, so they queue — and until yours confirms, you can't withdraw. Ours never shares state between workers."*

**1:50–2:25 — the parts that make it payroll.** Show withholding routed to tax escrow, the funded-runway alarm, and an over-estimate recovered from future accrual rather than the worker's wallet. *"We will never take money back out of a worker's account. Ever."*

**2:25–3:00 — close.** *"We're not a better advance. We removed the thing you'd be advancing against."*

---

## 12. Market, PMF and traction

### Who pays

**Employers.** Many already buy EWA as a retention benefit. ShiftPay replaces it with something that costs workers nothing — a straightforward upgrade to pitch internally.

### Market sizing — bottom-up

Do **not** quote the $43B payday lending market as your TAM; you're not lending. Build from pricing:

```text
addressable = target workers × per-worker-per-month fee
```

The EWA market at **$9.2B (2025) → $38.4B (2034)** is the right comparable, because that is what employers and workers already pay for partial access to earned wages. Your claim is that a continuous ledger makes most of that spend unnecessary.

### PMF evidence

1. **Demand is already paid for.** 10M workers took $32B in advances in 2022 and ~90% paid a fee. People are *buying* a worse version of this today.
2. **It is growing fast.** +90% transaction growth in a single year.
3. **The pricing is indefensible.** $520 to access $375 invites regulation, and EWA has been called "payday lending on steroids" by critics. Employers do not want to be associated with that.
4. **Employers already carry the cost** of turnover driven by cash-flow stress.

### Why a chain

- **Workers can verify their own ledger.** Every accrual traces to a signed shift record the employer cannot silently alter.
- **Funded-only accrual is enforceable**, so a claim can never exceed money actually set aside. A database can promise that; a contract proves it.
- **Cross-border contractors** have no shared payroll system to trust.

Concede the limit honestly: for a single domestic employer with a trusted payroll provider, a well-built internal system could do much of this. The argument strengthens with contractors, multiple jurisdictions, and workers who have reason not to trust the employer's numbers.

### Traction targets for 7 days

- **8–12 conversations** with shift employers or gig platforms. One question: *do you offer earned wage access, and what does it cost you?*
- **2–3 workers** who use the PWA through a real simulated shift and say whether the ticking balance changes how they feel.
- **1 design partner** willing to pilot a roster, named with permission.
- Benchmark reproducible from the repo.

Claim no payroll volume, employers or users you do not have.

### Business model

- Per active worker per month, paid by the employer
- Optional treasury yield on the funded-but-unwithdrawn float — **disclose this**, because it is exactly where the incentives could turn predatory
- Never a worker-side fee. That is the product.

---

## 13. Competition

| Alternative | Why it falls short |
|---|---|
| Payday lenders | $520 to borrow $375. The thing being replaced |
| EWA providers (Earnin, DailyPay, Payactiv) | Charge ~90% of users a fee per access; still a batch cycle with a lender bolted on |
| Weekly or daily payroll runs | Still a batch, just a shorter one. Doesn't help on day three |
| Streaming protocols (Sablier, Superfluid) | Stream a committed amount on a schedule. No attested work, no funded ceiling, no withholding — a vesting schedule, not a wage |
| `Flow` (2nd place, Blitz) | Per-second value streaming on Monad — closest precedent. Read it and state the difference: attestation, funding caps, withholding |

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| **"This is just token streaming"** | Attested work, funded ceiling, withholding, over-estimate recovery. A wage is not a vesting schedule. Demo all four |
| **Becoming a lender** | Accrual never exceeds attested work **and** funded balance. Accrual halts rather than creating a claim. Say it explicitly |
| **Over-estimate abuse mid-shift** | Capped by `maxShiftSeconds`; recovery only from future accrual, never the wallet |
| **Employer underfunds** | Runway alarm; accrual stops at the ceiling. Workers see real numbers, not promises |
| **Attestor key compromise** | Bounded by funded allocation; rotation is one transaction; corrections possible on future accrual |
| **Regulatory surface (withholding, minimum wage)** | Scope to one jurisdiction for the pitch; present withholding as a hook, not a compliance claim |
| **No real employer in 7 days** | Ship the clock-in PWA plus a CSV roster import so the demo is end-to-end and reproducible |
| **Float yield looks predatory** | Disclose it in the pitch before anyone asks |

---

## 15. Security requirements

```text
claimable(w) <= allocated[w] − withdrawn[w]          always
withdrawn[w] <= net earned                            always
Σ allocShard[i] + unallocated == vault balance        (within rounding)
a shiftId settles at most once
only attestor[employer] can attest a shift
corrections never reduce `withdrawn`, only future accrual
suspended workers cannot accrue or withdraw
withheld funds are only remittable to taxAddr
```

### Foundry test matrix

```text
test_accrual_matches_rate_times_seconds
test_midshift_estimate_capped
test_closeshift_replaces_estimate
test_overestimate_recovered_from_future_only
test_never_claws_back_withdrawn
test_withdraw_capped_by_allocation
test_accrual_halts_when_underfunded
test_withholding_routed_to_escrow
test_withholding_only_to_taxAddr
test_shift_replay_reverts
test_wrong_attestor_reverts
test_suspended_cannot_withdraw
test_shard_totals_match_balance
testFuzz_claimable_never_exceeds_funded
invariant_vault_solvency
invariant_no_unbacked_claims
```

`invariant_no_unbacked_claims` is the one to feature. It is the difference between payroll and lending.

---

## 16. Build plan — 7 days

| Day | Deliverable |
|---|---|
| 1 | `Worker` layout, lazy `claimable()`, mid-shift estimate. Unit tests |
| 2 | EIP-712 attestation, replay bitmap, funded ceiling, withholding. Invariants |
| 3 | Deploy to Monad. Naive control contract. Shift-burst benchmark + chart |
| 4 | **Worker PWA with the live ticking balance and one-tap withdraw** |
| 5 | Employer dashboard, funding, runway alarm. Privy + sponsored gas |
| 6 | Attestation bridge, clock-in/out flow, CSV roster, over-estimate demo |
| 7 | README, demo video, submission fields, bounty checklists. Freeze and rehearse |

Cut order: CSV import, then the bridge, then withholding remittance. **Never cut the ticking balance** — it is the product — **or the burst benchmark** — it is the Monad argument.

---

## 17. Repository

```text
ShiftPay/
├── contracts/   MetronomeVault, ShardVault, tests and invariants (Foundry)
├── bridge/      payroll service: attestor, relayer, indexer, gas grants, Prisma schema
├── app/
│   ├── app/         routes: /employer, /employee, /deploy, /api/bridge
│   ├── components/  business-app, wallet-app, deployment, payroll state
│   ├── lib/         agora, mera, private-payslips, rpc, funding, tokens, ABI
│   ├── styles/      CSS per portal
│   ├── scripts/     build helpers and configure-vercel
│   └── tests/       unit tests, live checks, automated passkey agent
├── benchmark/   shift-change benchmark procedure and local results
└── docs/        this PRD, architecture, trust model, use case, user testing, judge access
```

---

## 18. Submission checklist

- [x] Public repo, OSI licence, public from the start of work
- [x] Pre-existing dependencies declared in the README
- [ ] Contract deployed and verified, address in README — USDC vault deployed; AUSD vault and explorer verification pending
- [ ] Benchmark reproducible in one command
- [ ] Demo video ≤ 3 minutes
- [x] Track 02 — Consumer Products & Payments
- [x] Agora and Mera bounty requirements mapped line by line in [BOUNTIES.md](BOUNTIES.md); Agora transfers confirmed on chain by the automated agent
- [x] Agora: mobile app, Mera passkey onboarding, AUSD send, Instant Settlement integration (built)
- [ ] Agora: real transaction evidence recorded

---

## 19. The pitch

> Twelve million people pay four point six billion dollars a year in payday loan fees. The average borrower pays five hundred and twenty dollars to borrow three hundred and seventy-five. Ten million more took thirty-two billion in wage advances, and ninety per cent of them paid a fee for it.
>
> All of that is money they had already earned.
>
> They pay it because payroll settles every two weeks, and rent is due on the first. The two-week cycle isn't a policy. It's a leftover from when paying a million people individually was too expensive to do more than twice a month.
>
> ShiftPay deletes the gap. You clock in, your balance rises, you take it whenever you want, and it costs you nothing — because there's no advance to charge for. Nothing is ever lent. You can only draw what you've worked for and what's already funded.
>
> At two p.m. an entire warehouse clocks out at once. Every one of those attestations is independent, and we built the accounting so none of them collide.
>
> **We're not a better advance. We removed the thing you'd be advancing against.**

---

## 20. Judge Q&A

**Isn't this just token streaming?** Streaming pays out a committed amount on a clock. ShiftPay accrues against **attested work**, caps at **funded balance**, withholds tax, and recovers over-estimates from future earnings only. Those four things are what make it a wage.

**Why does it need a blockchain?** The worker can verify their own ledger — every accrual traces to a shift record signed by the employer, who cannot silently change it. And funded-only accrual is enforced rather than promised. For one domestic employer with a trusted provider, a good internal system gets close; the argument strengthens with contractors and cross-border work.

**Doesn't a million workers streaming mean a million transactions a second?** No, and we don't claim it. Accrual is a view and costs nothing. The real load is synchronised shift changes and bursty withdrawals, and the benchmark shows both.

**Are you a lender?** No, and the invariant suite proves it. Accrual can never exceed attested work or funded money. If the employer underfunds, accrual stops — we never create a claim we can't honour.

**What if the employer attests a shift wrongly?** Corrections apply to future accrual. We never claw money back from a worker's wallet. If the employer is wrong in their favour, that's their loss, not the worker's.

**How do you make money?** Per active worker per month, from the employer. We also could earn yield on funded-but-unwithdrawn float — we're flagging that ourselves, because it's the one place where our incentives could drift against workers.

---

## Appendix: Sources

- [CFPB — Developments in the Paycheck Advance Market](https://www.consumerfinance.gov/data-research/research-reports/data-spotlight-developments-in-the-paycheck-advance-market/)
- [UW Evans School — Earned Wage Access report (PDF)](https://evans.uw.edu/wp-content/uploads/2025/08/EWA-Report-1.pdf)
- [The true cost of payday loans](https://stream.co/en-us/articles/the-true-cost-of-payday-loans-what-american-workers-and-employers-need-to-know)
- [CNBC — "payday lending on steroids"](https://www.cnbc.com/2024/01/28/why-one-expert-called-earned-wage-access-payday-lending-on-steroids.html)
- [Earned wage access market size](https://dataintelo.com/report/earned-wage-access-market)
- [Payday lending market size](https://www.mordorintelligence.com/industry-reports/payday-lending-market)
- [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis)

**Verify every figure against its primary source before pitching.** The CFPB report is the strongest primary source here — read it directly rather than relying on summaries.
