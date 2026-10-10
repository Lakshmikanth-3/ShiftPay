# ShiftPay contracts

`MetronomeVault` holds employer funding in 64 shard sub-vaults, accrues wages lazily against EIP-712 shift attestations, caps payable wages at funding, and escrows withholding for the employer's tax address. The accounting is specified in [`../docs/architecture.md`](../docs/architecture.md).

```sh
npm install         # OpenZeppelin Contracts 5.1.0 and forge-std (pre-existing dependencies)
forge build
forge test          # 31 unit/fuzz tests + 4 stateful invariants
```

## Deploy (Monad testnet)

Network: Monad Testnet, RPC `https://testnet-rpc.monad.xyz/`, chain id `10143`, currency MON, explorer https://testnet.monadexplorer.com/.

Set these in your shell or a `.env` (never committed). No keys or addresses are hard-coded:

| Variable | Meaning |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Funded deployer; becomes admin of the first employer |
| `AUSD_ADDRESS` | Agora AUSD on the target network |
| `ATTESTOR_ADDRESS`, `TAX_ADDRESS` | Optional: register the first employer during deploy |

```sh
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast   # chain id 10143
```

`MockERC20` in `test/mocks` exists only for the test suite.
