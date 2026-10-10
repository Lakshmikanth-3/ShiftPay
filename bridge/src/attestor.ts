import { encodeAbiParameters, keccak256, type Address, type Hex, type TypedDataDomain } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

/** EIP-712 types; must match the typehashes in MetronomeVault.sol. */
export const types = {
  OpenShift: [
    { name: 'workerId', type: 'uint256' },
    { name: 'shiftId', type: 'uint256' },
    { name: 'startAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
  Shift: [
    { name: 'workerId', type: 'uint256' },
    { name: 'startAt', type: 'uint64' },
    { name: 'endAt', type: 'uint64' },
    { name: 'ratePerHour', type: 'uint128' },
    { name: 'shiftId', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
  Correction: [
    { name: 'shiftId', type: 'uint256' },
    { name: 'correctGross', type: 'uint128' },
    { name: 'version', type: 'uint32' },
    { name: 'deadline', type: 'uint64' },
  ],
  Withdraw: [
    { name: 'workerId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export type OpenMessage = { workerId: bigint; shiftId: bigint; startAt: bigint; deadline: bigint };
export type ShiftMessage = {
  workerId: bigint;
  startAt: bigint;
  endAt: bigint;
  ratePerHour: bigint;
  shiftId: bigint;
  deadline: bigint;
};
export type CorrectionMessage = { shiftId: bigint; correctGross: bigint; version: number; deadline: bigint };
export type WithdrawMessage = { workerId: bigint; amount: bigint; nonce: bigint; deadline: bigint };

export function vaultDomain(chainId: number, vault: Address): TypedDataDomain {
  return { name: 'Metronome', version: '1', chainId, verifyingContract: vault };
}

export type Attestor = {
  address: Address;
  domain: TypedDataDomain;
  signOpen(m: OpenMessage): Promise<Hex>;
  signShift(m: ShiftMessage): Promise<Hex>;
  signCorrection(m: CorrectionMessage): Promise<Hex>;
};

export function makeAttestor(key: Hex, chainId: number, vault: Address): Attestor {
  const account: PrivateKeyAccount = privateKeyToAccount(key);
  const domain = vaultDomain(chainId, vault);
  return {
    address: account.address,
    domain,
    signOpen: (message) => account.signTypedData({ domain, types, primaryType: 'OpenShift', message }),
    signShift: (message) => account.signTypedData({ domain, types, primaryType: 'Shift', message }),
    signCorrection: (message) => account.signTypedData({ domain, types, primaryType: 'Correction', message }),
  };
}

/**
 * Deterministic on-chain shift id: unique per (vault, employer, worker, clock-in event), so a retried
 * clock-in maps to the same shift and ids never collide with other employers on the shared vault.
 */
export function deriveShiftId(vault: Address, employerId: bigint, workerId: bigint, clockInKey: string): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'string' }],
        [vault, employerId, workerId, clockInKey],
      ),
    ),
  );
}

/** JSON-safe copy of a typed-data message (bigints as decimal strings). */
export function toJsonMessage(m: Record<string, bigint | number | string>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
}
