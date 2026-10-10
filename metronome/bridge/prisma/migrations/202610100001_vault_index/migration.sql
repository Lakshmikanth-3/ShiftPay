CREATE TABLE "IndexCursor" (
    "id" TEXT NOT NULL,
    "nextBlock" BIGINT NOT NULL,
    "blockHash" TEXT,
    CONSTRAINT "IndexCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultEvent" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "workerId" TEXT,
    "employerId" TEXT,
    "amount" TEXT,
    "hash" TEXT NOT NULL,
    CONSTRAINT "VaultEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VaultEvent_eventName_employerId_idx" ON "VaultEvent"("eventName", "employerId");
CREATE INDEX "VaultEvent_workerId_idx" ON "VaultEvent"("workerId");
CREATE INDEX "VaultEvent_blockNumber_idx" ON "VaultEvent"("blockNumber");
