# ShiftPay trust model

| Actor | Can | Cannot |
|---|---|---|
| Employer admin | Create workers, set rate/withholding/max shift, fund, reclaim unearned funding, suspend/reinstate, rotate attestor, trigger tax remittance | Withdraw wages, redirect withheld tax (tax address is immutable), reduce `withdrawn`, reclaim earned or reserved funds |
| Attestor key (employer timekeeping, held by the bridge) | Sign open, close, and correction records | Move money; attest beyond what funding can pay; replay a shift; reduce past withdrawals |
| Relayer key (bridge) | Pay gas to submit signed records and worker-signed withdrawals | Withdraw without a worker signature; change amounts or recipients |
| Worker (`payoutAddr`) | Sign withdrawals up to `claimable`, any time | Draw unfunded or unattested wages; withdraw while suspended |
| Tax address | Receive remitted withholding | Anything else |

## Failure bounds

- **Attestor compromise.** Fake shifts can only release money the employer has already funded for that worker. The admin rotates the attestor in one transaction, and downward corrections recover from future accrual.
- **Relayer compromise.** The attacker can only submit or delay transactions. Workers can submit their own signed withdrawal from any wallet.
- **Admin compromise.** The attacker can stop future accrual (suspend) and reclaim unearned funding. Earned, funded wages stay claimable after reinstatement, and withheld tax only goes to the fixed tax address.
- **Employer underfunds.** Work is still recorded; payable wages stop at the funded ceiling and the shortfall shows as arrears. No claim exceeds deposited money.

## Off-chain trust

The chain proves that every paid amount traces to a signature from the employer's attestor and to deposited funds. It does not prove that the hours were truly worked. That remains the employer's timekeeping system, which is the same trust the worker places in payroll today, but now every record is signed and public.
