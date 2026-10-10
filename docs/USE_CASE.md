# Who ShiftPay is for

## The user: hourly shift workers who send part of their pay home

**Primary segment:** migrant hourly workers in hospitality, delivery and retail who are paid by the shift and
send part of every paycheck to family in another country. The India corridor is the clearest example: India is
the world's largest recipient of remittances, and many of those senders work hourly jobs abroad.

**Launch segment (reachable this month):** part-time student workers on Indian college campuses (canteens,
events, libraries, tutoring) who are paid by the hour, often weeks late, and frequently support family.
The team studies at LICET, Chennai, which gives direct access to both workers and the small employers who pay them.

## Their problem, in their words

| Moment | What happens today | With ShiftPay |
|---|---|---|
| Shift ends | Money arrives at the next payday, up to two weeks later | Earned wages are available the same minute |
| Rent or food is due before payday | Borrow from friends, salary advance with a fee, or a payday loan | Withdraw what is already earned; no fee, no loan |
| Sending money home | Remittance fees and days of delay | Send AUSD; settled instantly through Agora |
| Proving income | Paper slips or nothing | Private payslips, encrypted, available on any phone |

## Why employers adopt it

Workers do not choose payroll; employers do. ShiftPay is sold to the employer and used by the worker.

- **Retention:** same-day pay is a hiring and retention benefit in high-turnover hourly work.
- **No credit risk:** wages are capped by money the employer already deposited; nothing is lent.
- **Less admin:** shifts, tax set-aside and payments are recorded automatically with a signed audit trail.
- **Cost:** the employer pays network fees (about 0.012 MON per withdrawal measured on Monad testnet).

## How the next 100 users find it

ShiftPay grows employer by employer: one employer brings all of its workers.

1. **Campus pilot (weeks 1–2):** one campus employer (canteen or event team), 10–20 student workers. Workers join
   by scanning a QR code at the start of a shift and creating a passkey; no app store, no seed phrase.
2. **Second and third employers (weeks 3–6):** local cafés and event staffing teams near campus, introduced by
   the first employer and by students who work several jobs. Target: 100 workers across 4–6 employers.
3. **Remittance corridor (after the hackathon):** staffing agencies that place workers abroad, where the
   Send-abroad feature carries the most value.

Measures we will track per pilot: time from QR scan to first confirmed transaction, share of workers who withdraw
before payday, average withdrawal size, and employer retention after 30 days.

## What we have not proven yet

- User testing evidence is being collected; see [USER_TESTING.md](USER_TESTING.md). Results will be recorded
  there as they happen, not estimated.
- No employer has signed a pilot yet.
- Testnet only: AUSD → CTK stands in for a local-currency payout until a production corridor exists.
