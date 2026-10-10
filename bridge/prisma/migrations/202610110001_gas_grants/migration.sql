CREATE TABLE "GasGrant" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GasGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GasGrant_workerId_at_idx" ON "GasGrant"("workerId", "at");

CREATE TABLE "PrivateVault" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivateVault_pkey" PRIMARY KEY ("id")
);
