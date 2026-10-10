CREATE TABLE "CompanyProfile" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id"));
CREATE TABLE "WorkerProfile" ("workerId" TEXT NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL, "department" TEXT NOT NULL, CONSTRAINT "WorkerProfile_pkey" PRIMARY KEY ("workerId"));
CREATE TABLE "ConsumedAuthorization" ("id" TEXT NOT NULL, "deadline" BIGINT NOT NULL, CONSTRAINT "ConsumedAuthorization_pkey" PRIMARY KEY ("id"));
