import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { deriveShiftId, makeAttestor, types } from '../src/attestor.js';
import { loadConfig } from '../src/config.js';
import { signWebhook } from '../src/app.js';

// Throwaway key generated in-process for signature round-trips only; never persisted or funded.
const key = generatePrivateKey();
const vault = '0x00000000000000000000000000000000000000aa' as const;

describe('attestor', () => {
  it('signs records that recover to the attestor address', async () => {
    const att = makeAttestor(key, 10143, vault);
    const message = { workerId: 7n, startAt: 100n, endAt: 200n, ratePerHour: 24_000_000n, shiftId: 1n, deadline: 999n };
    const signature = await att.signShift(message);
    const signer = await recoverTypedDataAddress({ domain: att.domain, types, primaryType: 'Shift', message, signature });
    expect(signer).toBe(att.address);
  });

  it('binds signatures to chain and vault', async () => {
    const a = makeAttestor(key, 10143, vault);
    const b = makeAttestor(key, 1, vault);
    const message = { workerId: 7n, shiftId: 1n, startAt: 100n, deadline: 999n };
    expect(await a.signOpen(message)).not.toBe(await b.signOpen(message));
  });

  it('derives deterministic, distinct shift ids', () => {
    const a = deriveShiftId(vault, 1n, 7n, 'evt-1');
    expect(deriveShiftId(vault, 1n, 7n, 'evt-1')).toBe(a);
    expect(deriveShiftId(vault, 2n, 7n, 'evt-1')).not.toBe(a);
    expect(deriveShiftId(vault, 1n, 8n, 'evt-1')).not.toBe(a);
    expect(deriveShiftId(vault, 1n, 7n, 'evt-2')).not.toBe(a);
  });
});

describe('webhook signature', () => {
  it('is an HMAC-SHA256 over the exact body', () => {
    const s = signWebhook('x'.repeat(32), '{"a":1}');
    expect(s).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhook('x'.repeat(32), '{"a": 1}')).not.toBe(s);
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
    MONAD_RPC_URL: 'http://localhost:8545',
    MONAD_CHAIN_ID: '10143',
    VAULT_ADDRESS: vault,
    EMPLOYER_ID: '1',
    ATTESTOR_PRIVATE_KEY: key,
    RELAYER_PRIVATE_KEYS: `${key}, ${key}`,
    WEBHOOK_SECRET: 'w'.repeat(32),
    ADMIN_API_TOKEN: 'a'.repeat(32),
  };

  it('parses a complete environment', () => {
    const cfg = loadConfig(base);
    expect(cfg.relayerKeys).toHaveLength(2);
    expect(cfg.chainId).toBe(10143);
    expect(cfg.attestationTtl).toBe(600n);
  });

  it('refuses missing or malformed values instead of guessing', () => {
    expect(() => loadConfig({ ...base, MONAD_RPC_URL: '' })).toThrow(/MONAD_RPC_URL/);
    expect(() => loadConfig({ ...base, RELAYER_PRIVATE_KEYS: '' })).toThrow(/RELAYER_PRIVATE_KEYS/);
    expect(() => loadConfig({ ...base, ATTESTOR_PRIVATE_KEY: '0x1234' })).toThrow(/ATTESTOR_PRIVATE_KEY/);
    expect(() => loadConfig({ ...base, WEBHOOK_SECRET: 'short' })).toThrow(/WEBHOOK_SECRET/);
  });
});
