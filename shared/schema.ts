/*
 * SHSY-RB-2025-Team1 MongoDB Schemas
 */

import { db } from "../server/db.ts";

// Helper function to create collection with schema validation
async function createCollectionIfNotExists(name, schema) {
  const collections = await db.listCollections({ name }).toArray();
  if (collections.length === 0) {
    await db.createCollection(name, { validator: { $jsonSchema: schema } });
    console.log(`Collection '${name}' created.`);
  } else {
    console.log(`Collection '${name}' already exists.`);
  }
}

/* ==========================
   1️⃣ Users Collection
========================== */
export const usersSchema = {
  bsonType: "object",
  required: ["username", "email", "createdAt"],
  properties: {
    _id: { bsonType: "objectId" },
    walletAddress: { bsonType: ["string", "null"] },
    username: { bsonType: "string" },
    email: { bsonType: "string" },
    firstName: { bsonType: ["string", "null"] },
    lastName: { bsonType: ["string", "null"] },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   2️⃣ Puzzles Collection
========================== */
export const puzzlesSchema = {
  bsonType: "object",
  required: ["question", "options", "correctAnswer"],
  properties: {
    _id: { bsonType: "objectId" },
    question: { bsonType: "string" },
    options: { bsonType: "array", items: { bsonType: "string" } },
    correctAnswer: { bsonType: "int" },
    hint: { bsonType: ["string", "null"] },
    rewardAmount: { bsonType: "decimal" },
    isActive: { bsonType: "bool" },
    publishDate: { bsonType: ["date", "null"] },
    expiresAt: { bsonType: ["date", "null"] },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   3️⃣ Guesses Collection
========================== */
export const guessesSchema = {
  bsonType: "object",
  required: ["userId", "riddleId", "guessText", "isCorrect", "createdAt"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    riddleId: { bsonType: "objectId" },
    guessText: { bsonType: "string" },
    optionsId: { bsonType: ["objectId", "null"] },
    isCorrect: { bsonType: "bool" },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   4️⃣ Stakes Collection
========================== */
export const stakesSchema = {
  bsonType: "object",
  required: ["userId", "stakeIndex", "amount", "lockPeriodDays", "apyRate", "lockedUntil"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletAddress: { bsonType: ["string", "null"] },
    stakeIndex: { bsonType: "int" },
    poolId: { bsonType: ["objectId", "null"] },
    amount: { bsonType: "string" },
    duration: { bsonType: ["int", "null"] },
    lockPeriodDays: { bsonType: "int" },
    apyRate: { bsonType: "decimal" },
    lockedUntil: { bsonType: "date" },
    status: { bsonType: "string" },
    txHash: { bsonType: ["string", "null"] },
    transactionSignature: { bsonType: ["string", "null"] },
    withdrawTxHash: { bsonType: ["string", "null"] },
    rewardsClaimed: { bsonType: "string" },
    startTime: { bsonType: ["date", "null"] },
    endTime: { bsonType: ["date", "null"] },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   5️⃣ Reward Pools Collection
========================== */
export const rewardPoolsSchema = {
  bsonType: "object",
  required: ["poolName", "poolType", "totalPoolAmount", "availableAmount"],
  properties: {
    _id: { bsonType: "objectId" },
    poolName: { bsonType: "string" },
    poolType: { bsonType: "string" },
    minStakeAmount: { bsonType: ["decimal", "null"] },
    minStakePeriod: { bsonType: ["int", "null"] },
    totalPoolAmount: { bsonType: "decimal" },
    availableAmount: { bsonType: "decimal" },
    isActive: { bsonType: "bool" },
    description: { bsonType: ["string", "null"] },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   6️⃣ Reward Distributions Collection
========================== */
export const rewardDistributionsSchema = {
  bsonType: "object",
  required: ["userId", "poolId", "rewardAmount", "distributionType"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    stakeId: { bsonType: ["objectId", "null"] },
    poolId: { bsonType: "objectId" },
    rewardAmount: { bsonType: "decimal" },
    distributionType: { bsonType: "string" },
    transactionSignature: { bsonType: ["string", "null"] },
    status: { bsonType: "string" },
    createdAt: { bsonType: "date" },
    distributedAt: { bsonType: ["date", "null"] }
  }
};

/* ==========================
   7️⃣ Market Data Collection
========================== */
export const marketDataSchema = {
  bsonType: "object",
  required: ["timestamp"],
  properties: {
    _id: { bsonType: "objectId" },
    totalStaked: { bsonType: "decimal" },
    totalUsers: { bsonType: "int" },
    currentYield: { bsonType: "decimal" },
    activeStakes: { bsonType: "int" },
    prizePool: { bsonType: "decimal" },
    timestamp: { bsonType: "date" }
  }
};

/* ==========================
   8️⃣ Prize Activities Collection
========================== */
export const prizeActivitiesSchema = {
  bsonType: "object",
  required: ["name", "prizeType", "prizeAmount"],
  properties: {
    _id: { bsonType: "objectId" },
    name: { bsonType: "string" },
    description: { bsonType: ["string", "null"] },
    prizeType: { bsonType: "string" },
    prizeAmount: { bsonType: "decimal" },
    minStakeRequired: { bsonType: "decimal" },
    criteria: { bsonType: ["string", "null"] },
    duration: { bsonType: ["int", "null"] },
    participantCount: { bsonType: "int" },
    isActive: { bsonType: "bool" },
    startDate: { bsonType: "date" },
    endDate: { bsonType: ["date", "null"] },
    rules: { bsonType: ["string", "null"] },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   9️⃣ Wallet Connections Collection
========================== */
export const walletConnectionsSchema = {
  bsonType: "object",
  required: ["userId", "walletType", "publicKey"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletType: { bsonType: "string" },
    publicKey: { bsonType: "string" },
    isActive: { bsonType: "bool" },
    lastConnected: { bsonType: "date" },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   🔟 Riddles With Options Collection
========================== */
export const riddlesWithOptionsSchema = {
  bsonType: "object",
  required: ["contentChinese", "contentEnglish", "answer", "optionsEnglish", "winReward", "participationReward"],
  properties: {
    _id: { bsonType: "objectId" },
    contentChinese: { bsonType: "string" },
    contentEnglish: { bsonType: "string" },
    answer: { bsonType: "string" },
    hintChinese: { bsonType: ["string", "null"] },
    hintEnglish: { bsonType: ["string", "null"] },
    optionsEnglish: { bsonType: "array", items: { bsonType: "string" } },
    imageUrl: { bsonType: ["string", "null"] },
    winReward: { bsonType: "decimal" },
    participationReward: { bsonType: "decimal" },
    duration: { bsonType: "int" },
    status: { bsonType: "string" },
    publishedAt: { bsonType: ["date", "null"] },
    expiresAt: { bsonType: ["date", "null"] },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   11️⃣ Riddle Submissions Collection
========================== */
export const riddleSubmissionsSchema = {
  bsonType: "object",
  required: ["userId", "riddleId", "selectedAnswer", "isCorrect", "submittedAt"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    riddleId: { bsonType: "objectId" },
    selectedAnswer: { bsonType: "string" },
    isCorrect: { bsonType: "bool" },
    rewardAmount: { bsonType: ["decimal", "null"] },
    rewardIssued: { bsonType: "bool", default: false },
    submittedAt: { bsonType: "date" }
  }
};

/* ==========================
   12️⃣ Reward Settings Collection
========================== */
export const rewardSettingsSchema = {
  bsonType: "object",
  required: ["settingKey", "settingValue"],
  properties: {
    _id: { bsonType: "objectId" },
    settingKey: { bsonType: "string" },
    settingValue: { bsonType: "string" },
    description: { bsonType: ["string", "null"] },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   13️⃣ Global Challenges Collection
========================== */
export const globalChallengesSchema = {
  bsonType: "object",
  required: ["challengeType", "startedAt", "targetMinutes", "rewardAmount"],
  properties: {
    _id: { bsonType: "objectId" },
    challengeType: { bsonType: "string" },
    startedAt: { bsonType: "date" },
    targetMinutes: { bsonType: "int" },
    rewardAmount: { bsonType: "decimal" },
    status: { bsonType: "string", default: "active" },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   14️⃣ Challenge Participations Collection
========================== */
export const challengeParticipationsSchema = {
  bsonType: "object",
  required: ["globalChallengeId", "userId", "walletAddress", "joinedAt"],
  properties: {
    _id: { bsonType: "objectId" },
    globalChallengeId: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletAddress: { bsonType: "string" },
    joinedAt: { bsonType: "date" },
    isWinner: { bsonType: "bool", default: false },
    rewardClaimed: { bsonType: "bool", default: false },
    claimedAt: { bsonType: ["date", "null"] }
  }
};

/* ==========================
   15️⃣ Locked Funds Collection
========================== */
export const lockedFundsSchema = {
  bsonType: "object",
  required: ["userId", "walletAddress", "rewardType", "tokenType", "totalRewardAmount", "lockedAmount", "availableAmount", "lockPercentage", "lockDays", "lockedAt", "unlocksAt", "status"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletAddress: { bsonType: "string" },
    rewardType: { bsonType: "string" },
    tokenType: { bsonType: "string", default: "SHSY" },
    totalRewardAmount: { bsonType: "decimal" },
    lockedAmount: { bsonType: "decimal" },
    availableAmount: { bsonType: "decimal" },
    lockPercentage: { bsonType: "int" },
    lockDays: { bsonType: "int" },
    lockedAt: { bsonType: "date" },
    unlocksAt: { bsonType: "date" },
    status: { bsonType: "string", default: "locked" },
    originalTransactionId: { bsonType: ["string", "null"] }
  }
};

/* ==========================
   16️⃣ Lock Settings Collection
========================== */
export const lockSettingsSchema = {
  bsonType: "object",
  required: ["settingKey", "settingValue", "updatedAt"],
  properties: {
    _id: { bsonType: "objectId" },
    settingKey: { bsonType: "string" },
    settingValue: { bsonType: "string" },
    description: { bsonType: ["string", "null"] },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   17️⃣ Million Pool Settings Collection
========================== */
export const millionPoolSettingsSchema = {
  bsonType: "object",
  required: ["isActive", "distributionFrequencyMinutes", "rewardAmountShsy", "numberOfWinners", "usdtRequirement", "shsyRequirement", "createdAt", "updatedAt"],
  properties: {
    _id: { bsonType: "objectId" },
    isActive: { bsonType: "bool", default: false },
    distributionFrequencyMinutes: { bsonType: "int", default: 1440 },
    rewardAmountShsy: { bsonType: "decimal", default: "10.00000000" },
    numberOfWinners: { bsonType: "int", default: 5 },
    usdtRequirement: { bsonType: "decimal", default: "4.00" },
    shsyRequirement: { bsonType: "decimal", default: "100.00" },
    lastDistribution: { bsonType: ["date", "null"] },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   18️⃣ Million Pool Participants Collection
========================== */
export const millionPoolParticipantsSchema = {
  bsonType: "object",
  required: ["userId", "walletAddress", "participationType", "isActive"],
  properties: {
    _id: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletAddress: { bsonType: "string" },
    participationType: { bsonType: "string" },
    usdtDepositAmount: { bsonType: ["decimal", "null"] },
    shsyStakeAmount: { bsonType: ["decimal", "null"] },
    depositTransactionId: { bsonType: ["string", "null"] },
    isActive: { bsonType: "bool", default: true },
    joinedAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" }
  }
};

/* ==========================
   19️⃣ Million Pool Distributions Collection
========================== */
export const millionPoolDistributionsSchema = {
  bsonType: "object",
  required: ["totalParticipants", "numberOfWinners", "rewardAmountShsy", "createdAt"],
  properties: {
    _id: { bsonType: "objectId" },
    distributionDate: { bsonType: "date" },
    totalParticipants: { bsonType: "int" },
    numberOfWinners: { bsonType: "int" },
    rewardAmountShsy: { bsonType: "decimal" },
    distributionTransactionId: { bsonType: ["string", "null"] },
    status: { bsonType: "string", default: "pending" },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   20️⃣ Million Pool Winners Collection
========================== */
export const millionPoolWinnersSchema = {
  bsonType: "object",
  required: ["distributionId", "userId", "walletAddress", "rewardAmountShsy", "status", "createdAt"],
  properties: {
    _id: { bsonType: "objectId" },
    distributionId: { bsonType: "objectId" },
    userId: { bsonType: "objectId" },
    walletAddress: { bsonType: "string" },
    rewardAmountShsy: { bsonType: "string" },
    transactionId: { bsonType: ["string", "null"] },
    status: { bsonType: "string", default: "pending" },
    claimedAt: { bsonType: ["date", "null"] },
    createdAt: { bsonType: "date" }
  }
};

/* ==========================
   ⚡ Setup All Collections
========================== */
async function setupCollections() {
  await createCollectionIfNotExists("users", usersSchema);
  await createCollectionIfNotExists("puzzles", puzzlesSchema);
  await createCollectionIfNotExists("guesses", guessesSchema);
  await createCollectionIfNotExists("stakes", stakesSchema);
  await createCollectionIfNotExists("rewardPools", rewardPoolsSchema);
  await createCollectionIfNotExists("rewardDistributions", rewardDistributionsSchema);
  await createCollectionIfNotExists("marketData", marketDataSchema);
  await createCollectionIfNotExists("prizeActivities", prizeActivitiesSchema);
  await createCollectionIfNotExists("walletConnections", walletConnectionsSchema);
  await createCollectionIfNotExists("riddlesWithOptions", riddlesWithOptionsSchema);
  await createCollectionIfNotExists("riddleSubmissions", riddleSubmissionsSchema);
  await createCollectionIfNotExists("rewardSettings", rewardSettingsSchema);
  await createCollectionIfNotExists("globalChallenges", globalChallengesSchema);
  await createCollectionIfNotExists("challengeParticipations", challengeParticipationsSchema);
  await createCollectionIfNotExists("lockedFunds", lockedFundsSchema);
  await createCollectionIfNotExists("lockSettings", lockSettingsSchema);
  await createCollectionIfNotExists("millionPoolSettings", millionPoolSettingsSchema);
  await createCollectionIfNotExists("millionPoolParticipants", millionPoolParticipantsSchema);
  await createCollectionIfNotExists("millionPoolDistributions", millionPoolDistributionsSchema);
  await createCollectionIfNotExists("millionPoolWinners", millionPoolWinnersSchema);
}

setupCollections().catch(console.error);
