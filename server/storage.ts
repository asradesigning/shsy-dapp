/*
 * SHSY-RB-2025-Team1
 */

import { ObjectId } from "mongodb";
import {
  getUsersCollection,
  getStakesCollection,
  getRewardsCollection,
  getSettingsCollection,
  getRiddlesCollection,
  getRiddleSubmissionsCollection,
  getRewardSettingsCollection,
  getStakingChallengesCollection,
  getLockedFundsCollection,
  getLockSettingsCollection,
  getMillionPoolSettingsCollection,
  getMillionPoolParticipantsCollection,
  getMillionPoolDistributionsCollection,
  getMillionPoolWinnersCollection,
} from "../shared/mongoDb";


export class Storage {

  // ========== User operations ==========
  async getUser(id: string): Promise<User | null> {
    return getUsersCollection().findOne({ _id: new ObjectId(id) });
  }

  async getUserByWallet(walletAddress: string): Promise<User | null> {
    return getUsersCollection().findOne({ walletAddress });
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await getUsersCollection().insertOne({
      ...user,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { _id: result.insertedId, ...user, createdAt: new Date(), updatedAt: new Date() };
  }

  async updateUser(id: string, userData: Partial<User>): Promise<User | null> {
    const result = await getUsersCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...userData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return result.value;
  }

  async getAllUsers(): Promise<User[]> {
    return getUsersCollection().find().sort({ createdAt: -1 }).toArray();
  }

  async createUserWithWallet(walletAddress: string): Promise<User> {
    const existing = await this.getUserByWallet(walletAddress);
    if (existing) return existing;

    return this.createUser({
      walletAddress,
      username: `user_${walletAddress.slice(0, 8)}`,
      email: null,
      firstName: null,
      lastName: null,
    });
  }

  // ========== Staking operations ==========
  async createStake(stake: InsertStake): Promise<Stake> {
    const result = await getStakesCollection().insertOne({ ...stake, createdAt: new Date() });
    return { _id: result.insertedId, ...stake, createdAt: new Date() };
  }

  async createStakeWithIndex(stakeData: InsertStake & { stakeIndex: number }): Promise<Stake> {
    return this.createStake(stakeData);
  }

  async getNextStakeIndex(walletAddress: string): Promise<number> {
    const lastStake = await getStakesCollection()
      .find({ walletAddress })
      .sort({ stakeIndex: -1 })
      .limit(1)
      .toArray();
    return lastStake.length === 0 ? 0 : lastStake[0].stakeIndex + 1;
  }

  async deleteStakeByIndex(walletAddress: string, stakeIndex: number): Promise<boolean> {
    const result = await getStakesCollection().deleteOne({ walletAddress, stakeIndex });
    return result.deletedCount === 1;
  }

  async getStakeByIndex(walletAddress: string, stakeIndex: number): Promise<Stake | null> {
    return getStakesCollection().findOne({
      walletAddress,
      stakeIndex,
      status: "unlocked",
    }, { sort: { createdAt: -1 } });
  }

  async getUserStakes(userId: string): Promise<Stake[]> {
    const stakes = await getStakesCollection().find({ userId }).toArray();
    const now = new Date();

    // Update unlocked stakes
    await Promise.all(
      stakes.map(async (stake) => {
        if (stake.status === "active" && stake.lockedUntil && now >= new Date(stake.lockedUntil)) {
          await getStakesCollection().updateOne(
            { _id: stake._id },
            { $set: { status: "unlocked" } }
          );
          stake.status = "unlocked";
        }
      })
    );

    return stakes;
  }

  async updateStake(id: string, stakeData: Partial<Stake>): Promise<Stake | null> {
    const result = await getStakesCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: stakeData },
      { returnDocument: "after" }
    );
    return result.value;
  }

  // ========== Reward operations ==========
  async createReward(reward: InsertReward): Promise<Reward> {
    const result = await getRewardsCollection().insertOne({ ...reward, createdAt: new Date() });
    return { _id: result.insertedId, ...reward, createdAt: new Date() };
  }

  async getUserRewards(userId: string): Promise<Reward[]> {
    return getRewardsCollection()
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();
  }

  // ========== Dashboard Stats ==========
  async getDashboardStats() {
  const usersCollection = getUsersCollection();
  const stakesCollection = getStakesCollection();

  // Count DISTINCT users who have ever staked
  const usersWithStakes = await stakesCollection.distinct("userId");
  const totalUsers = usersWithStakes.length;

  // Count stakes that are currently locked or completed (not withdrawn)
  const activeStakes = await stakesCollection.countDocuments({ status: { $ne: "withdrawn" } });

  // Sum of amounts of active stakes (status != 'withdrawn')
  const totalStakedResult = await stakesCollection.aggregate([
    { $match: { status: { $ne: "withdrawn" } } },
    { $group: { _id: null, totalAmount: { $sum: { $toDouble: "$amount" } } } },
  ]).toArray();

  const totalStaked = totalStakedResult[0]?.totalAmount || 0;

  return {
    totalUsers,
    activeStakes,
    totalStaked,
    totalRewards: 0, // Can later fetch from smart contract if needed
  };
}


  // ========== Settings operations ==========
  async getSetting(key: string): Promise<Setting | null> {
    return getSettingsCollection().findOne({ key });
  }

  async setSetting(key: string, value: string, description?: string): Promise<Setting> {
    const result = await getSettingsCollection().findOneAndUpdate(
      { key },
      { $set: { value, description, updatedAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    );
    return result.value!;
  }

  // ========== Riddle operations ==========
  async createRiddle(riddleData: InsertRiddleWithOptions): Promise<RiddleWithOptions> {
    const result = await getRiddlesCollection().insertOne({ ...riddleData, createdAt: new Date(), updatedAt: new Date() });
    return { _id: result.insertedId, ...riddleData, createdAt: new Date(), updatedAt: new Date() };
  }

  async getAllRiddles(): Promise<RiddleWithOptions[]> {
    return getRiddlesCollection().find().sort({ createdAt: -1 }).toArray();
  }

  async getRiddleById(id: string): Promise<RiddleWithOptions | null> {
    return getRiddlesCollection().findOne({ _id: new ObjectId(id) });
  }

  async getPublishedRiddles(): Promise<RiddleWithOptions[]> {
    return getRiddlesCollection().find({ status: "published" }).sort({ publishedAt: -1 }).toArray();
  }

  async updateRiddleStatus(
    id: string,
    status: string,
    publishedAt?: Date,
    expiresAt?: Date
  ): Promise<RiddleWithOptions | null> {
    const updateData: any = { status, updatedAt: new Date() };
    if (publishedAt) updateData.publishedAt = publishedAt;
    if (expiresAt) updateData.expiresAt = expiresAt;

    const result = await getRiddlesCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: "after" }
    );
    return result.value;
  }

  async updateRiddle(id: string, riddleData: Partial<RiddleWithOptions>): Promise<RiddleWithOptions | null> {
    const result = await getRiddlesCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...riddleData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return result.value;
  }

  async deleteRiddle(id: string): Promise<boolean> {
    const result = await getRiddlesCollection().deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount === 1;
  }

  // ========== Riddle Submissions ==========
  async createRiddleSubmission(submissionData: InsertRiddleSubmission): Promise<RiddleSubmission> {
    const result = await getRiddleSubmissionsCollection().insertOne({ ...submissionData, submittedAt: new Date() });
    return { _id: result.insertedId, ...submissionData, submittedAt: new Date() };
  }

  async getRiddleSubmissionsByUser(userId: string, riddleId?: string): Promise<RiddleSubmission[]> {
    const filter: any = { userId: new ObjectId(userId) };
    if (riddleId) filter.riddleId = new ObjectId(riddleId);
    return getRiddleSubmissionsCollection().find(filter).sort({ submittedAt: -1 }).toArray();
  }

  async getRiddleSubmissionsByRiddle(riddleId: string): Promise<RiddleSubmission[]> {
    return getRiddleSubmissionsCollection()
      .find({ riddleId: new ObjectId(riddleId) })
      .sort({ submittedAt: -1 })
      .toArray();
  }
  async hasUserSubmittedRiddle(userId: string, riddleId: string): Promise<boolean> {
  const count = await getRiddleSubmissionsCollection().countDocuments({
    userId: new ObjectId(userId),
    riddleId: new ObjectId(riddleId),
  });
  return count > 0;
}


 // ================= Reward Settings Management =================
async getRewardSetting(key: string): Promise<RewardSetting | null> {
  return getRewardSettingsCollection().findOne({ settingKey: key });
}

async setRewardSetting(
  key: string,
  value: string,
  description?: string
): Promise<RewardSetting> {
  const result = await getRewardSettingsCollection().findOneAndUpdate(
    { settingKey: key },
    { $set: { settingValue: value, description: description || null, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return result.value!;
}

async getAllRewardSettings(): Promise<RewardSetting[]> {
  return getRewardSettingsCollection().find().toArray();
}

// ================= Staking Challenges Management =================
async createStakingChallenge(challengeData: InsertStakingChallenge): Promise<StakingChallenge> {
  const result = await getStakingChallengesCollection().insertOne({
    ...challengeData,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { _id: result.insertedId, ...challengeData, createdAt: new Date(), updatedAt: new Date() };
}

async getActiveStakingChallenges(walletAddress: string): Promise<StakingChallenge[]> {
  const challenges = await getStakingChallengesCollection().find({ walletAddress }).toArray();
  return challenges.filter(c => ["active", "completed", "not_started"].includes(c.status));
}

async updateStakingChallengeProgress(walletAddress: string, challengeType: string): Promise<void> {
  await getStakingChallengesCollection().updateOne(
    { walletAddress, challengeType, status: "active" },
    {
      $inc: { currentStreak: 1 },
      $set: { lastStakeAt: new Date(), updatedAt: new Date() },
    }
  );
}

async completeStakingChallenge(id: string): Promise<StakingChallenge | null> {
  const result = await getStakingChallengesCollection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  return result.value;
}

async claimStakingChallengeReward(id: string): Promise<StakingChallenge | null> {
  const result = await getStakingChallengesCollection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status: "claimed", claimedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  return result.value;
}

async pauseStakingChallenges(walletAddress: string): Promise<void> {
  await getStakingChallengesCollection().updateMany(
    { walletAddress, status: "active" },
    { $set: { status: "paused", updatedAt: new Date() } }
  );
}

async resumeStakingChallenges(walletAddress: string): Promise<void> {
  await getStakingChallengesCollection().updateMany(
    { walletAddress, status: "paused" },
    { $set: { status: "active", startedAt: new Date(), lastStakeAt: new Date(), currentStreak: 0, updatedAt: new Date() } }
  );
}

async getStakingChallengeById(id: string): Promise<StakingChallenge | null> {
  return getStakingChallengesCollection().findOne({ _id: new ObjectId(id) });
}

// ================= Locked Funds Management =================
async createLockedFund(lockedFundData: InsertLockedFund): Promise<LockedFund> {
  const result = await getLockedFundsCollection().insertOne({ ...lockedFundData, createdAt: new Date() });
  return { _id: result.insertedId, ...lockedFundData, createdAt: new Date() };
}

async getUserLockedFunds(userId: string): Promise<LockedFund[]> {
  return getLockedFundsCollection().find({ userId: new ObjectId(userId) }).toArray();
}

async getLockedFundsByWallet(walletAddress: string): Promise<LockedFund[]> {
  return getLockedFundsCollection().find({ walletAddress }).toArray();
}

async getAvailableLockedFunds(walletAddress: string): Promise<LockedFund[]> {
  const now = new Date();
  return getLockedFundsCollection()
    .find({ walletAddress, status: "locked", unlocksAt: { $lte: now } })
    .toArray();
}

async withdrawLockedFund(id: string): Promise<LockedFund | null> {
  const result = await getLockedFundsCollection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status: "withdrawn" } },
    { returnDocument: "after" }
  );
  return result.value;
}

// ================= Lock Settings Management =================
async getLockSetting(key: string): Promise<LockSetting | null> {
  return getLockSettingsCollection().findOne({ settingKey: key });
}

async setLockSetting(key: string, value: string, description?: string): Promise<LockSetting> {
  const result = await getLockSettingsCollection().findOneAndUpdate(
    { settingKey: key },
    { $set: { settingValue: value, description, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return result.value!;
}

async getAllLockSettings(): Promise<LockSetting[]> {
  return getLockSettingsCollection().find().toArray();
}

// ================= Million Pool Settings =================
async getMillionPoolSettings(): Promise<MillionPoolSetting | null> {
  return getMillionPoolSettingsCollection().findOne({});
}

async updateMillionPoolSettings(settingsData: Partial<MillionPoolSetting>): Promise<MillionPoolSetting> {
  const existing = await this.getMillionPoolSettings();
  if (existing) {
    const result = await getMillionPoolSettingsCollection().findOneAndUpdate(
      { _id: existing._id },
      { $set: { ...settingsData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return result.value!;
  } else {
    const result = await getMillionPoolSettingsCollection().insertOne({ ...settingsData, createdAt: new Date(), updatedAt: new Date() });
    return { _id: result.insertedId, ...settingsData, createdAt: new Date(), updatedAt: new Date() };
  }
}

// ================= Million Pool Participants =================
async addMillionPoolParticipant(participantData: InsertMillionPoolParticipant): Promise<MillionPoolParticipant> {
  const result = await getMillionPoolParticipantsCollection().insertOne({ ...participantData, createdAt: new Date() });
  return { _id: result.insertedId, ...participantData, createdAt: new Date() };
}

async getMillionPoolParticipant(userId: string): Promise<MillionPoolParticipant | null> {
  return getMillionPoolParticipantsCollection().findOne({ userId: new ObjectId(userId), isActive: true });
}

async getAllActiveMillionPoolParticipants(): Promise<MillionPoolParticipant[]> {
  return getMillionPoolParticipantsCollection().find({ isActive: true }).toArray();
}

async updateParticipantStatus(userId: string, isActive: boolean): Promise<void> {
  await getMillionPoolParticipantsCollection().updateOne(
    { userId: new ObjectId(userId) },
    { $set: { isActive, updatedAt: new Date() } }
  );
}

// Check if user qualifies for million pool (100+ SHSY staked or $4 USDT deposited)
  async checkMillionPoolEligibility(userId: string): Promise<{
    eligible: boolean;
    qualificationType: "shsy_staking" | "usdt_deposit" | "none";
    amount: string;
  }> {
    const settings = await this.getMillionPoolSettings();
    if (!settings || !settings.isActive) {
      return { eligible: false, qualificationType: "none", amount: "0" };
    }

    // Check SHSY staking qualification
    const userStakes = await this.getUserStakes(userId);
    const activeStakes = userStakes.filter(
      (stake) => stake.status !== "withdrawn",
    );
    const totalStaked = activeStakes.reduce(
      (sum, stake) => sum + parseFloat(stake.amount),
      0,
    );

    if (totalStaked >= parseFloat(settings.shsyRequirement)) {
      return {
        eligible: true,
        qualificationType: "shsy_staking",
        amount: totalStaked.toString(),
      };
    }

    // Check USDT deposit qualification
    const participant = await this.getMillionPoolParticipant(userId);
    if (
      participant &&
      participant.participationType === "usdt_deposit" &&
      participant.usdtDepositAmount &&
      parseFloat(participant.usdtDepositAmount) >=
        parseFloat(settings.usdtRequirement)
    ) {
      return {
        eligible: true,
        qualificationType: "usdt_deposit",
        amount: participant.usdtDepositAmount,
      };
    }

    return { eligible: false, qualificationType: "none", amount: "0" };
  }


// ================= Million Pool Distributions =================
async createMillionPoolDistribution(distributionData: InsertMillionPoolDistribution): Promise<MillionPoolDistribution> {
  const result = await getMillionPoolDistributionsCollection().insertOne({ ...distributionData, createdAt: new Date() });
  return { _id: result.insertedId, ...distributionData, createdAt: new Date() };
}

async getLastMillionPoolDistribution(): Promise<MillionPoolDistribution | null> {
  return getMillionPoolDistributionsCollection().find().sort({ distributionDate: -1 }).limit(1).next();
}

// ================= Million Pool Winners =================
async createMillionPoolWinners(winnersData: InsertMillionPoolWinner[]): Promise<MillionPoolWinner[]> {
  const result = await getMillionPoolWinnersCollection().insertMany(winnersData.map(d => ({ ...d, createdAt: new Date() })));
  return winnersData.map((d, i) => ({ ...d, _id: result.insertedIds[i], createdAt: new Date() }));
}

async getMillionPoolWinnersByUser(userId: string): Promise<MillionPoolWinner[]> {
  return getMillionPoolWinnersCollection().find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
}

async updateMillionPoolWinnerStatus(winnerId: string, status: string, transactionId?: string): Promise<void> {
  const updateData: any = { status };
  if (transactionId) updateData.transactionId = transactionId;
  await getMillionPoolWinnersCollection().updateOne({ _id: new ObjectId(winnerId) }, { $set: updateData });
}

async removeMillionPoolWinner(winnerId: string): Promise<boolean> {
  const result = await getMillionPoolWinnersCollection().deleteOne({ _id: new ObjectId(winnerId) });
  return result.deletedCount === 1;
}
}



export const storage = new Storage();
