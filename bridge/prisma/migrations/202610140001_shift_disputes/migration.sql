CREATE TABLE "ShiftDispute" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftDispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShiftDispute_workerId_createdAt_idx" ON "ShiftDispute"("workerId", "createdAt");
