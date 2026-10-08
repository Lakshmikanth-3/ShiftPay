-- Generated from prisma/schema.prisma by prisma migrate diff --from-empty.
CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "ClockType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "AttestationKind" AS ENUM ('OPEN', 'CLOSE', 'CORRECTION');
CREATE TYPE "TxKind" AS ENUM ('OPEN_SHIFT', 'CLOSE_SHIFT', 'CORRECT_SHIFT', 'WITHDRAW');
CREATE TYPE "TxStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED');
CREATE TABLE "ClockEvent" (
 "id" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "workerId" TEXT NOT NULL,
 "type" "ClockType" NOT NULL, "at" BIGINT NOT NULL, "shiftId" TEXT,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Shift" (
 "id" TEXT NOT NULL, "workerId" TEXT NOT NULL, "status" "ShiftStatus" NOT NULL,
 "startAt" BIGINT NOT NULL, "endAt" BIGINT, "ratePerHour" TEXT, "gross" TEXT,
 "version" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Attestation" (
 "id" TEXT NOT NULL, "kind" "AttestationKind" NOT NULL, "shiftId" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0, "message" JSONB NOT NULL,
 "signature" TEXT NOT NULL, "signer" TEXT NOT NULL, "deadline" BIGINT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChainTx" (
 "id" TEXT NOT NULL, "kind" "TxKind" NOT NULL, "workerId" TEXT NOT NULL,
 "shard" INTEGER NOT NULL, "attestationId" TEXT, "params" JSONB,
 "status" "TxStatus" NOT NULL DEFAULT 'QUEUED', "sender" TEXT, "hash" TEXT,
 "blockNumber" BIGINT, "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ChainTx_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClockEvent_idempotencyKey_key" ON "ClockEvent"("idempotencyKey");
CREATE INDEX "Shift_workerId_status_idx" ON "Shift"("workerId", "status");
CREATE INDEX "ChainTx_status_nextAttemptAt_idx" ON "ChainTx"("status", "nextAttemptAt");
CREATE INDEX "ChainTx_workerId_idx" ON "ChainTx"("workerId");
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChainTx" ADD CONSTRAINT "ChainTx_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
