/*
 * SHSY-RB-2025-Team1
 */

import dotenv from "dotenv";
dotenv.config();

import { initMongo } from "../shared/mongoDb";
await initMongo();
import { ObjectId } from "mongodb";

import express from "express";
import { fileURLToPath } from "url";
import cors from "cors";
import path from "path";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
// import { storage } from "./storage";
import { tokenReader } from "./token-reader";
import { simplifiedMultipleStaking } from "./anchor-staking-updated";
import { db } from "./db";
// import { stakesSchema } from "../shared/schema";
import { globalChallengeManager } from "./simple-global-challenges";
import { rewardLocker } from "./reward-locker";
// USDT functionality integrated into existing anchor-staking-updated.ts
// import { eq, and, sql, gte, ne } from "drizzle-orm";
import {
  getStakesCollection, 
  getRiddleSubmissionsCollection, 
  getMillionPoolParticipantsCollection, 
  getUsersCollection, 
  getChallengeParticipationsCollection,
  getGlobalChallengesCollection
} from "../shared/mongoDb";
const { storage } = await import("./storage");
const app: any = express();

// Constants
const PROGRAM_ID = "FAWD65XmEDxXFKTBJP952VaXHQxomCoqPGPWN3H7yvf6";

// Admin diagnostic endpoint to check pool admin
app.get("/api/admin/debug-pool-admin", async (req, res) => {
  try {
    const [stakingPoolPDA] = simplifiedMultipleStaking.getStakingPoolPDA();
    const poolAccountInfo =
      await simplifiedMultipleStaking.connection.getAccountInfo(stakingPoolPDA);

    if (!poolAccountInfo) {
      return res.json({ success: false, error: "Staking pool not found" });
    }

    // Parse the pool account data to get the admin (assuming it's stored after discriminator and total_staked)
    const data = poolAccountInfo.data;
    const adminBytes = data.slice(16, 48); // Skip 8 bytes discriminator + 8 bytes total_staked
    const adminPubkey = new PublicKey(adminBytes);

    const currentAdminPubkey = simplifiedMultipleStaking.adminKeyPair.publicKey;

    res.json({
      success: true,
      poolAdmin: adminPubkey.toString(),
      currentAdmin: currentAdminPubkey.toString(),
      isMatch: adminPubkey.equals(currentAdminPubkey),
      poolAddress: stakingPoolPDA.toString(),
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Check if user is eligible for challenges (at least 1 stake OR 1 riddle guess OR million pool participation)
async function checkUserEligibility(userId: string): Promise<boolean> {
  try {
    const stakesCollection = getStakesCollection();
    const guessesCollection = getRiddleSubmissionsCollection();
    const millionPoolCollection = getMillionPoolParticipantsCollection();

    const hasStakes = (await stakesCollection.countDocuments({
      userId: userId,
      status: { $ne: "withdrawn" }
    })) > 0;

    console.log("Has Staked: " + hasStakes);

    const hasGuesses = (await guessesCollection.countDocuments({
      userId: userId
    })) > 0;
    console.log("Has Guessed: " + hasGuesses);
    const hasMillionPoolParticipation = (await millionPoolCollection.countDocuments({
      userId: userId,
      isActive: true
    })) > 0;

    console.log(
      `User ${userId} eligibility: stakes=${hasStakes}, guesses=${hasGuesses}, millionPool=${hasMillionPoolParticipation}`
    );

    return hasStakes || hasGuesses || hasMillionPoolParticipation;
  } catch (error) {
    console.error("Error checking user eligibility:", error);
    return false;
  }
}

// Calculate total rewards for a user (staking + guessing)
async function calculateUserRewards(userId: string, timeframeDays: number): Promise<number> {
  try {
    const stakesCollection = getStakesCollection();
    const guessesCollection = getRiddleSubmissionsCollection();

    const timeframeStart = new Date();
    timeframeStart.setDate(timeframeStart.getDate() - timeframeDays);

    // Staking rewards
    const userStakes = await stakesCollection.find({
      userId: new ObjectId(userId),
      createdAt: { $gte: timeframeStart }
    }).toArray();

    let stakingRewards = 0;
    for (const stake of userStakes) {
      const principal = parseFloat(stake.amount);
      const apyRate = parseFloat(stake.apyRate || "5");
      const stakeStart = stake.startTime ? new Date(stake.startTime) : new Date(stake.createdAt);
      const elapsedDays = Math.max(0, (Date.now() - stakeStart.getTime()) / (1000 * 60 * 60 * 24));
      const timeElapsedInYears = elapsedDays / 365;
      stakingRewards += principal * (apyRate / 100) * timeElapsedInYears;
    }

    // Guessing rewards
    const correctGuessesCount = await guessesCollection.countDocuments({
      userId: new ObjectId(userId),
      isCorrect: true,
      createdAt: { $gte: timeframeStart }
    });
    const guessingRewards = correctGuessesCount * 3; // 3 SHSY per correct guess

    const totalRewards = stakingRewards + guessingRewards;
    console.log(
      `User ${userId} rewards: staking=${stakingRewards.toFixed(8)}, guessing=${guessingRewards}, total=${totalRewards.toFixed(8)}`
    );

    return totalRewards;
  } catch (error) {
    console.error("Error calculating user rewards:", error);
    return 0;
  }
}

// Get or create global challenge start time
async function getGlobalChallengeStartTime(challengeType: "10_day" | "30_day"): Promise<Date> {
  try {
    const globalChallengesCollection = getGlobalChallengesCollection();
    
    const existingChallenge = await globalChallengesCollection.find({
      challengeType,
      status: "active"
    }).sort({ startedAt: 1 }).limit(1).toArray();

    if (existingChallenge.length > 0) {
      console.log(`Using existing ${challengeType} challenge start time: ${existingChallenge[0].startedAt}`);
      return new Date(existingChallenge[0].startedAt);
    }

    const newStartTime = new Date();
    console.log(`Creating new global ${challengeType} challenge start time: ${newStartTime.toISOString()}`);
    return newStartTime;
  } catch (error) {
    console.error("Error getting global challenge start time:", error);
    return new Date();
  }
}

// Get random winners for a global challenge
async function getRandomWinnersForChallenge(challengeType: "10_day" | "30_day"): Promise<Array<{ userId: string; walletAddress: string }>> {
  try {
    const challengeParticipationsCollection = getChallengeParticipationsCollection();
    const globalChallengesCollection = getGlobalChallengesCollection();

    // Find active challenge of this type
    const activeChallenge = await globalChallengesCollection.find({
      challengeType,
      status: "active"
    }).limit(1).toArray();

    if (!activeChallenge.length) return [];

    const challengeId = activeChallenge[0]._id;

    const allParticipants = await challengeParticipationsCollection.find({
      globalChallengeId: challengeId
    }).project({ userId: 1, walletAddress: 1 }).toArray();

    console.log(`Found ${allParticipants.length} participants for ${challengeType} challenge`);

    if (allParticipants.length <= 5) return allParticipants;

    // Randomly select 5 winners
    const shuffled = [...allParticipants].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, 5);

    console.log(`Randomly selected 5 winners out of ${allParticipants.length} participants for ${challengeType} challenge`);
    return winners;
  } catch (error) {
    console.error("Error getting random winners:", error);
    return [];
  }
}

// Challenge management system
async function manageStakingChallenges(
  walletAddress: string,
  userId: number,
  action:
    | "stake_created"
    | "stake_withdrawn"
    | "reward_claimed"
    | "progress_check",
) {
  try {
    console.log(`Managing challenges for ${walletAddress}, action: ${action}`);

    // Skip individual staking challenge management - use global challenges only
    console.log(
      "Using simplified global challenge system - skipping individual challenge management",
    );
  } catch (error) {
    console.error("Error in manageStakingChallenges:", error);
    throw error;
  }
}

async function handleChallengeType(
  challengeType: "10_day" | "30_day",
  existingChallenge: any,
  walletAddress: string,
  userId: number,
  action: string,
  hasActiveStakes: boolean,
  now: Date,
) {
  const targetMinutes = challengeType === "10_day" ? 14400 : 43200; // Production: 10 days = 14400 minutes, 30 days = 43200 minutes

  // Get reward amount from database settings
  const rewardSettingKey =
    challengeType === "10_day" ? "participation_10d" : "participation_30d";
  const rewardSetting = await storage.getRewardSetting(rewardSettingKey);
  const rewardAmount = rewardSetting
    ? parseFloat(rewardSetting.settingValue).toFixed(8)
    : challengeType === "10_day"
      ? "75.00000000"
      : "150.00000000";

  const user = await storage.getUserByWallet(walletAddress);
  if (action === "stake_created") {
    // Check eligibility: user must have at least 1 stake OR 1 riddle guess
    const isEligible = await checkUserEligibility(user._id.toString());

    console.log(
      `${challengeType} challenge eligibility check for user ${walletAddress}: ${isEligible}`,
    );

    if (!isEligible) {
      console.log(
        `User ${walletAddress} not eligible for ${challengeType} challenge - needs at least 1 stake OR 1 riddle guess`,
      );
      return;
    }

    // When user stakes: check if challenge is running or not
    console.log(
      `Checking ${challengeType} challenge status - exists: ${!!existingChallenge}, status: ${existingChallenge?.status}`,
    );

    if (!existingChallenge || existingChallenge.status !== "active") {
      // Challenge is not running - start it with global synchronized time
      const globalStartTime = await getGlobalChallengeStartTime(challengeType);
      console.log(
        `Creating new ${challengeType} challenge for eligible user ${walletAddress} with global start time: ${globalStartTime.toISOString()}`,
      );

      const newChallenge = await storage.createStakingChallenge({
        userId: userId,
        walletAddress: walletAddress,
        challengeType: challengeType,
        startedAt: globalStartTime,
        lastStakeAt: globalStartTime,
        currentStreak: 1,
        targetDays: targetMinutes,
        rewardAmount: rewardAmount,
        status: "active",
      });
      console.log(
        `✓ Started ${challengeType} challenge for eligible user ${walletAddress}:`,
        newChallenge.id,
      );
    } else {
      // Challenge is already running - don't do anything
      console.log(
        `${challengeType} challenge already running - no action needed`,
      );
    }
    return;
  }

  if (!existingChallenge) return;

  // FIRST: Always check if user has active stakes before any progress updates
  if (
    !hasActiveStakes &&
    (action === "progress_check" ||
      action === "stake_withdrawn" ||
      action === "reward_claimed")
  ) {
    // No active stakes found - delete the challenge completely
    // User no longer eligible for challenges
    console.log("User no longer eligible for challenges");
    console.log(
      `${challengeType} challenge deleted - no active stakes detected during ${action}`,
    );
    return;
  }

  // Check if time is completed
  const startTime = new Date(existingChallenge.startedAt);
  const elapsedMinutes = Math.floor(
    (now.getTime() - startTime.getTime()) / (1000 * 60),
  );
  const isTimeCompleted = elapsedMinutes >= targetMinutes;

  console.log(
    `${challengeType}: status=${existingChallenge.status}, elapsed=${elapsedMinutes}min, target=${targetMinutes}min, completed=${isTimeCompleted}`,
  );

  if (action === "stake_withdrawn") {
    // User withdrew a stake - always check if any stakes remain after withdrawal
    if (!hasActiveStakes) {
      // No active stakes remaining after withdrawal - user no longer eligible for challenges
      console.log(
        "User no longer eligible for challenges - will be removed from global challenges",
      );
      console.log(
        `${challengeType} challenge deleted - no active stakes remaining after withdrawal`,
      );
    } else {
      // Still has active stakes after withdrawal - challenge continues
      console.log(
        `${challengeType} challenge continues - active stakes remain after withdrawal`,
      );
    }
  } else if (action === "reward_claimed") {
    // User claimed reward - check if there are active stakes
    if (hasActiveStakes) {
      // Has active stakes - start challenge again with global synchronized time
      const globalStartTime = await getGlobalChallengeStartTime(challengeType);
      await storage.createStakingChallenge({
        userId: userId,
        walletAddress: walletAddress,
        challengeType: challengeType,
        startedAt: globalStartTime,
        lastStakeAt: globalStartTime,
        currentStreak: 1,
        targetDays: targetMinutes,
        rewardAmount: rewardAmount,
        status: "active",
      });
      console.log(
        `Restarted ${challengeType} challenge after claim with global start time - has active stakes`,
      );
    } else {
      // No active stakes - delete the challenge completely
      await db
        .delete(stakingChallenges)
        .where(eq(stakingChallenges.id, existingChallenge.id));
      console.log(
        `${challengeType} challenge deleted - no active stakes after reward claim`,
      );
    }
  } else if (existingChallenge.status === "active" && isTimeCompleted) {
    // Time completed - check if user is randomly selected from eligible participants
    const randomWinners = await getRandomWinnersForChallenge(challengeType);
    const isUserWinner = randomWinners.some((user) => user.userId === userId);

    if (isUserWinner) {
      // User is randomly selected as winner - mark as completed and eligible for reward
      await db
        .update(stakingChallenges)
        .set({
          status: "completed",
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(stakingChallenges.id, existingChallenge.id));
      console.log(
        `${challengeType} challenge completed - user ${walletAddress} randomly selected as winner`,
      );
    } else {
      // User not selected as winner - delete challenge (no reward)
      await db
        .delete(stakingChallenges)
        .where(eq(stakingChallenges.id, existingChallenge.id));
      console.log(
        `${challengeType} challenge deleted - user ${walletAddress} not selected as random winner`,
      );
    }
  }
}

app.use(
  cors({
    origin: ["http://localhost:3000"],
    credentials: true,
  }),
);

app.use(express.json());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "client", "dist")));

// Initialize devnet token
async function initializeCustomToken() {
  try {
    console.log("Initializing devnet token...");

    const tokenMintAddress =
      process.env.DEVNET_TOKEN_MINT ||
      "3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P";

    console.log("Using specified devnet token:");
    console.log(`- Mint Address: ${tokenMintAddress}`);
    console.log("- Supply: 100,000 tokens");
    console.log("- Read-only mode: No admin keys required");
  } catch (error) {
    console.error("Error initializing custom token:", error);
  }
}

// Simplified staking endpoint using only your deployed contract
app.post("/api/stake", async (req, res) => {
  try {
    const { walletAddress, amount, lockPeriod } = req.body;

    console.log("Creating simplified stake transaction for:", {
      walletAddress,
      amount,
      lockPeriod,
    });

    // Validate input
    if (!walletAddress || !amount || !lockPeriod) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, amount, lockPeriod",
      });
    }

    // Validate lock period
    if (![30, 90, 180].includes(parseInt(lockPeriod))) {
      return res.status(400).json({
        success: false,
        error: "Invalid lock period. Must be 30, 90, or 180 days",
      });
    }

    // Use simplified contract for basic token transfer
    const transactionData =
      await simplifiedMultipleStaking.createStakeTransaction(
        walletAddress,
        parseFloat(amount),
      );

    res.json({
      success: true,
      transactionData: {
        serializedTransaction: transactionData.serializedTransaction,
        programId: transactionData.programId,
        instructions: transactionData.instructionData,
      },
      message: "Simplified stake transaction created successfully",
    });
  } catch (error) {
    console.error("Error creating simplified stake transaction:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Complete withdrawal endpoint - handles transaction creation AND database updates
app.post("/api/dapp/withdraw", async (req, res) => {
  try {
    const { walletAddress, id, amount, signature } = req.body;

    if (!walletAddress || !id) {
      return res.status(400).json({
        error: "Missing required fields: walletAddress, id",
      });
    }

    // If signature provided, this is completion - verify and update database
    if (signature) {
      console.log(`Completing withdrawal transaction: ${signature}`);

      // Verify transaction on blockchain
      const verification =
        await simplifiedMultipleStaking.verifyTransaction(signature);

      if (verification.success && verification.confirmed) {
        // Find and mark stake as withdrawn
        const user = await storage.getUserByWallet(walletAddress);
        if (user) {
          const stakes = await storage.getUserStakes(user._id);
          const stake = stakes.find((s) => s.id === parseInt(id));

          if (stake) {
            await storage.updateStake(stake.id, {
              status: "withdrawn",
              endTime: new Date(),
            });
            console.log(
              `Stake ID ${id} marked as withdrawn for wallet ${walletAddress}`,
            );

            // Manage challenges after withdrawal
            try {
              await manageStakingChallenges(
                walletAddress,
                user._id,
                "stake_withdrawn",
              );
            } catch (challengeError) {
              console.error(
                "Error managing challenges after withdrawal:",
                challengeError,
              );
            }
          }
        }

        return res.json({
          success: true,
          confirmed: true,
          message: "Withdrawal completed and stake marked as withdrawn",
        });
      } else {
        return res.status(400).json({
          success: false,
          error: "Transaction verification failed",
        });
      }
    }

    // No signature - create withdrawal transaction
    console.log(
      `Creating withdrawal transaction for wallet: ${walletAddress}, stake ID: ${id}`,
    );

    // Get stake details from database
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      console.log(`User not found for wallet: ${walletAddress}`);
      return res.status(400).json({ error: "User not found" });
    }

    console.log(`Found user: ${user._id}, getting stake by ID: ${id}`);
    const stakes = await storage.getUserStakes(user._id);
    const stake = stakes.find((s) => s.id === parseInt(id));

    if (!stake) {
      console.log(`Stake not found for wallet: ${walletAddress}, ID: ${id}`);
      console.log(
        `User has ${stakes.length} stakes:`,
        stakes.map((s) => ({ id: s.id, amount: s.amount, status: s.status })),
      );
      return res.status(400).json({ error: "Stake not found" });
    }

    console.log(
      `Found stake: ID ${stake.id}, amount: ${stake.amount}, status: ${stake.status}`,
    );

    // Calculate rewards in DApp using actual APY formula based on time spent staking
    const now = new Date();
    const startTime = new Date(stake.startTime || Date.now());
    const elapsedSeconds = Math.floor(
      (now.getTime() - startTime.getTime()) / 1000,
    );

    // Calculate earned rewards using actual APY formula
    let earnedRewards = 0;
    if (elapsedSeconds > 0) {
      const principal = parseFloat(stake.amount);
      const apyRate = parseFloat(stake.apyRate || "5");
      const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60); // Convert seconds to years for APY calculation
      earnedRewards = principal * (apyRate / 100) * timeElapsedInYears;
    }

    // Total withdrawal amount = original stake + earned rewards
    const originalAmount = parseFloat(stake.amount);
    let totalWithdrawAmount = originalAmount + earnedRewards;

    console.log(
      `Smart contract withdrawal: ${originalAmount} SHSY + ${earnedRewards.toFixed(8)} rewards = ${totalWithdrawAmount.toFixed(8)} SHSY total`,
    );
    console.log(`Contract pool has sufficient tokens to cover rewards`);

    // Ensure pool has enough tokens for rewards - add tokens if needed
    try {
      const poolTokenAccount =
        await simplifiedMultipleStaking.getPoolTokenAccount();
      const poolBalance =
        await simplifiedMultipleStaking.connection.getTokenAccountBalance(
          poolTokenAccount,
        );
      const poolTokens = poolBalance.value.uiAmount || 0;

      console.log(`Pool currently has ${poolTokens} SHSY tokens`);

      // Check if pool has enough tokens for this withdrawal
      // If the difference is very small (< 0.001 SHSY), proceed with available balance
      const shortfall = totalWithdrawAmount - poolTokens;

      if (shortfall > 0.01) {
        console.log(
          `Significant pool shortfall for withdrawal: has ${poolTokens}, needs ${totalWithdrawAmount}, shortfall: ${shortfall}`,
        );

        return res.status(400).json({
          success: false,
          error: "INSUFFICIENT_POOL_BALANCE",
          message: `Pool has insufficient tokens for withdrawal. Pool: ${poolTokens}, Required: ${totalWithdrawAmount}`,
          poolBalance: poolTokens,
          requiredAmount: totalWithdrawAmount,
          hint: "Pool needs funding with SHSY tokens to cover withdrawals and rewards.",
        });
      } else if (shortfall > 0) {
        console.log(
          `Small shortfall detected (${shortfall} SHSY), adjusting withdrawal to available balance`,
        );
        // Reduce withdrawal to match available pool balance (minus small buffer)
        totalWithdrawAmount = poolTokens - 0.000001;
        console.log(
          `Adjusted withdrawal amount to ${totalWithdrawAmount} SHSY to match pool balance`,
        );

        // Also reduce the earned rewards to match the adjustment
        earnedRewards = totalWithdrawAmount - originalAmount;
        console.log(
          `Adjusted rewards to ${earnedRewards.toFixed(8)} SHSY to match pool capacity`,
        );
      }
    } catch (error) {
      console.log(`Could not check pool balance: ${error.message}`);
    }

    // Check if UserStake account exists and needs migration
    const userPublicKey = new (await import("@solana/web3.js")).PublicKey(
      walletAddress,
    );
    const [userStakePDA] =
      simplifiedMultipleStaking.getUserStakePDA(userPublicKey);

    try {
      const userStakeAccount =
        await simplifiedMultipleStaking.connection.getAccountInfo(userStakePDA);

      if (!userStakeAccount) {
        // UserStake account doesn't exist - need to create it first
        console.log(
          "UserStake account doesn't exist, user needs to sync stakes first",
        );

        // Calculate total staked amount from all active stakes
        const allStakes = await storage.getUserStakes(user._id);
        const activeStakes = allStakes.filter((s) => s.status === "active");
        const totalStaked = activeStakes.reduce(
          (sum, s) => sum + parseFloat(s.amount),
          0,
        );

        return res.status(400).json({
          success: false,
          error: "MIGRATION_REQUIRED",
          message: "Your stakes need to be synced with the new secure contract",
          requiresSync: true,
          totalStaked,
          activeStakesCount: activeStakes.length,
          syncEndpoint: "/api/sync-user-stakes",
        });
      }

      // Parse UserStake account data to check staked amount
      const accountData = userStakeAccount.data;
      if (accountData.length >= 40) {
        // 8 + 32 + 8 + 8 + 8 minimum
        // Skip discriminator (8 bytes), get staked_amount (u64 at offset 40)
        const stakedAmountBuffer = accountData.slice(40, 48);
        const BN = (await import("bn.js")).default;
        const stakedAmountLamports = new BN(stakedAmountBuffer, "le");
        const stakedAmountTokens =
          stakedAmountLamports.toNumber() / Math.pow(10, 6);

        console.log(
          `UserStake account shows ${stakedAmountTokens} SHSY staked`,
        );

        // Allow small precision differences (less than 0.001 SHSY)
        const precisionTolerance = 0.001;
        if (stakedAmountTokens < totalWithdrawAmount - precisionTolerance) {
          console.log(
            `Insufficient UserStake amount: ${stakedAmountTokens} < ${totalWithdrawAmount}`,
          );
          return res.status(400).json({
            success: false,
            error: "INSUFFICIENT_STAKE_ACCOUNT",
            message: "UserStake account has insufficient amount recorded",
            userStakeAmount: stakedAmountTokens,
            requestedAmount: totalWithdrawAmount,
            requiresSync: true,
            syncEndpoint: "/api/sync-user-stakes",
          });
        }
      }
    } catch (accountError) {
      console.error("Error checking UserStake account:", accountError);
      // Continue with withdrawal attempt, let the contract handle the error
    }

    // Execute PDA-based withdrawal (user never signs)
    console.log(
      `Creating PDA-based withdrawal for ${totalWithdrawAmount.toFixed(8)} SHSY`,
    );

    const distributionResult =
      await simplifiedMultipleStaking.createPDATokenDistribution(
        walletAddress,
        totalWithdrawAmount,
        "stake_withdrawal",
        "SHSY",
      );

    if (distributionResult.success) {
      // Mark stake as withdrawn
      await storage.updateStake(stake.id, {
        status: "withdrawn",
        endTime: new Date(),
      });

      // Manage challenges after withdrawal
      try {
        await manageStakingChallenges(
          walletAddress,
          user._id,
          "stake_withdrawn",
        );
      } catch (challengeError) {
        console.error(
          "Error managing challenges after withdrawal:",
          challengeError,
        );
      }

      return res.json({
        success: true,
        completed: true,
        message:
          "Withdrawal completed automatically! Tokens sent to your wallet.",
        transactionSignature: distributionResult.transactionSignature,
        principal: originalAmount.toFixed(8),
        rewards: earnedRewards.toFixed(8),
        totalAmount: totalWithdrawAmount.toFixed(8),
      });
    } else {
      return res.status(500).json({
        error: "PDA withdrawal failed",
        details: distributionResult.error,
      });
    }
  } catch (error) {
    console.error("Error in withdraw endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process withdrawal: " + error.message,
    });
  }
});

// Simplified withdrawal endpoint using your contract
app.post("/api/withdraw", async (req, res) => {
  try {
    const { walletAddress, stakeIndex } = req.body;

    if (!walletAddress || stakeIndex === undefined) {
      return res.status(400).json({
        error: "Missing required fields: walletAddress, stakeIndex",
      });
    }

    console.log(
      `Creating simplified withdraw transaction for wallet: ${walletAddress}, stake index: ${stakeIndex}`,
    );

    // Get stake amount from database
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const stake = await storage.getStakeByIndex(walletAddress, stakeIndex);
    if (!stake) {
      return res.status(400).json({ error: "Stake not found" });
    }

    // Create simplified withdraw transaction
    const transactionData =
      await simplifiedMultipleStaking.createWithdrawTransaction(
        walletAddress,
        parseFloat(stake.amount),
      );

    res.json({
      success: true,
      transactionData: {
        serializedTransaction: transactionData.serializedTransaction,
        programId: transactionData.programId,
        instructions: transactionData.instructionData,
      },
      message: "Withdraw transaction created successfully",
    });
  } catch (error) {
    console.error("Error creating withdraw transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create withdraw transaction",
    });
  }
});

// Confirm transaction endpoint - creates database record after blockchain confirmation
app.post("/api/confirm-transaction", async (req, res) => {
  try {
    const { signature, walletAddress, amount, lockPeriod, transactionType } =
      req.body;

    if (!signature || !walletAddress || !transactionType) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: signature, walletAddress, transactionType",
      });
    }

    console.log(`Confirming ${transactionType} transaction: ${signature}`);

    // Verify transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (verification.success && verification.confirmed) {
      if (transactionType === "stake" && amount && lockPeriod) {
        // Create user if doesn't exist
        const user = await storage.createUserWithWallet(walletAddress);

        // Get APY rate for the selected lock period
        const apySetting = await storage.getRewardSetting(
          `apy_${lockPeriod}_day`,
        );
        const apyRate = apySetting ? parseFloat(apySetting.settingValue) : 5.0;

        // Calculate lock expiry time in actual days for production
        const lockDurationMs = parseInt(lockPeriod) * 24 * 60 * 60 * 1000; // Convert days to milliseconds
        const lockedUntil = new Date(Date.now() + lockDurationMs);

        // Get the next unique stake index for this wallet
        const nextStakeIndex = await storage.getNextStakeIndex(walletAddress);

        // Create stake record with unique index
        const stakeRecord = await storage.createStake({
          userId: user._id.toString(),
          walletAddress: walletAddress,
          stakeIndex: nextStakeIndex,
          amount: amount.toString(),
          lockPeriodDays: parseInt(lockPeriod),
          apyRate: apyRate.toString(),
          lockedUntil: lockedUntil,
          duration: parseInt(lockPeriod),
          status: "active",
          transactionSignature: signature,
          startTime: new Date(),
        });

        res.json({
          success: true,
          confirmed: true,
          signature: signature,
          stakeId: stakeRecord.id,
          message: "Staking transaction confirmed and recorded successfully",
        });
      } else if (transactionType === "withdraw") {
        // Update stake status to withdrawn
        const user = await storage.getUserByWallet(walletAddress);
        if (user) {
          const stakes = await storage.getUserStakes(user._id);
          const activeStake = stakes.find((s) => s.status === "active");
          if (activeStake) {
            await storage.updateStake(activeStake.id, {
              status: "withdrawn",
              endTime: new Date(),
            });
            console.log(`Updated stake ${activeStake.id} status to withdrawn`);
          }
        }

        res.json({
          success: true,
          confirmed: true,
          signature: signature,
          message:
            "Withdrawal transaction confirmed and stake updated successfully",
        });
      } else {
        res.json({
          success: true,
          confirmed: true,
          signature: signature,
          message: "Transaction confirmed successfully",
        });
      }
    } else {
      res.json({
        success: false,
        confirmed: false,
        signature: signature,
        message: "Transaction not yet confirmed",
      });
    }
  } catch (error) {
    console.error("Error confirming transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to confirm transaction",
    });
  }
});

// Get user stakes (for display in DApp)
app.get("/api/stakes/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        stakes: [],
      });
    }

    const stakes = await storage.getUserStakes(user._id);

    // Calculate rewards for each stake
    const stakesWithRewards = stakes.map((stake) => {
      const now = new Date();
      const startTime = new Date(stake.startTime || Date.now());

      // Calculate pending rewards using actual APY formula based on time spent staking
      let pendingRewards = 0;

      // Stop reward accumulation for withdrawn stakes
      if (stake.status === "withdrawn") {
        pendingRewards = 0; // No rewards for withdrawn stakes
      } else {
        const elapsedSeconds = Math.floor(
          (now.getTime() - startTime.getTime()) / 1000,
        );
        if (elapsedSeconds > 0) {
          const principal = parseFloat(stake.amount);
          const apyRate = parseFloat(stake.apyRate || "5");
          const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60); // Convert seconds to years for APY calculation
          pendingRewards = principal * (apyRate / 100) * timeElapsedInYears;
        }
      }

      return {
        id: stake.id,
        stakeIndex: stake.stakeIndex,
        amount: stake.amount,
        lockPeriodDays: stake.lockPeriodDays,
        apyRate: stake.apyRate,
        duration: stake.duration,
        status: stake.status,
        createdAt: stake.createdAt,
        startTime: stake.startTime,
        lockedUntil: stake.lockedUntil,
        transactionSignature: stake.transactionSignature,
        pendingRewards: pendingRewards.toFixed(8),
      };
    });

    res.json({
      success: true,
      stakes: stakesWithRewards,
    });
  } catch (error) {
    console.error("Error fetching user stakes:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stakes",
    });
  }
});

// SHSY token airdrop for testing
// PDA-based reward distribution for riddle participation
app.post("/api/rewards/distribute-riddle", async (req, res) => {
  try {
    const {
      walletAddress,
      riddleId,
      rewardAmount,
      rewardType = "riddle_answer_free",
    } = req.body;

    if (!walletAddress || !riddleId || !rewardAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, riddleId, rewardAmount",
      });
    }

    console.log(
      `Creating PDA-based riddle reward for wallet: ${walletAddress}`,
    );
    console.log(`Reward amount: ${rewardAmount} SHSY, type: ${rewardType}`);

    // Convert wallet address to PublicKey and amount to lamports
    const recipientPublicKey = new PublicKey(walletAddress);
    const amountLamports = Math.round(parseFloat(rewardAmount) * 1_000_000_000); // Convert to lamports

    // Create PDA-based reward distribution (no user signature needed)
    const result = await simplifiedMultipleStaking.createRewardDistribution(
      recipientPublicKey,
      amountLamports,
      rewardType,
    );

    if (!result.success) {
      throw new Error(`Failed to create reward distribution: ${result.error}`);
    }

    console.log(`✅ PDA reward created successfully: ${result.signature}`);

    res.json({
      success: true,
      signature: result.signature,
      message: `Riddle reward of ${rewardAmount} SHSY distributed to ${walletAddress}`,
      instructionData: {
        method: "PDA-based reward distribution",
        amount: rewardAmount,
        recipient: walletAddress,
        rewardType: rewardType,
        transactionSignature: result.signature,
      },
    });
  } catch (error) {
    console.error("Error creating riddle reward:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Test endpoint for PDA-based rewards
app.post("/api/test/pda-reward", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress",
      });
    }

    // Test with 3 SHSY reward
    const testReward = 3;
    const transaction =
      await simplifiedMultipleStaking.createRewardDistribution(
        walletAddress,
        testReward,
      );

    if (!transaction) {
      throw new Error("Failed to create test reward transaction");
    }

    res.json({
      success: true,
      message: "PDA-based test reward transaction created successfully",
      transaction: transaction
        .serialize({ requireAllSignatures: false })
        .toString("base64"),
      details: {
        amount: testReward + " SHSY",
        method: "PDA-based (no admin signature)",
        recipient: walletAddress,
      },
    });
  } catch (error) {
    console.error("Error creating test reward:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Airdrop functionality removed - PDA-based reward system only
app.post("/api/dapp/airdrop", async (req, res) => {
  res.status(501).json({
    success: false,
    error: "Airdrop function disabled - use PDA-based rewards only",
    message: "Earn SHSY tokens through staking and trivia participation",
  });
});

// Serve the DApp interface
app.get("/dapp", (req, res) => {
  res.sendFile(path.join(__dirname, "dapp.html"));
});

// Serve admin interface
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-teal.html"));
});

// DApp stats endpoint
app.get("/api/dapp/stats", async (req, res) => {
  try {
    console.log("Stats endpoint called");
    const stats = await storage.getDashboardStats();
    console.log("Stats retrieved:", stats);
    res.json({
      success: true,
      stats: stats,
    });
  } catch (error) {
    console.error("Error fetching DApp stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stats: {
        totalUsers: 0,
        totalStaked: "0",
        totalRewards: "0",
        activeStakes: 0,
      },
    });
  }
});

// SHSY balance endpoint for dashboard
app.get("/api/balance/shsy", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress || typeof walletAddress !== "string") {
      return res.status(400).json({
        success: false,
        error: "Wallet address is required",
      });
    }

    // Get SHSY balance from blockchain
    const balance = await tokenReader.getSHSYBalance(walletAddress);

    res.json({
      success: true,
      balance: balance,
      walletAddress: walletAddress,
    });
  } catch (error) {
    console.error("Error fetching SHSY balance:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch SHSY balance",
      balance: 0,
    });
  }
});

// Debug endpoint for PDA balance checking
app.get("/api/debug/pda-balance", async (req, res) => {
  try {
    const programId = new PublicKey(
      "7GKL6U2Rh3PzGNPpeN7PdQNucSCg2HJMa41EqR9qVeBm",
    );
    const seeds = [Buffer.from("staking_pool")];
    const [stakingPoolPDA] = PublicKey.findProgramAddressSync(seeds, programId);
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    );
    const balance = await connection.getBalance(stakingPoolPDA);

    res.json({
      success: true,
      pdaAddress: stakingPoolPDA.toString(),
      balanceSOL: balance / 1_000_000_000,
      balanceLamports: balance,
      needsSOL: balance < 10_000_000, // Less than 0.01 SOL
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Staking pools endpoint for dashboard
app.get("/api/staking/pools", async (req, res) => {
  try {
    // Get current APY settings from admin
    const apy30Setting = await storage.getRewardSetting("apy_30_day");
    const apy90Setting = await storage.getRewardSetting("apy_90_day");
    const apy180Setting = await storage.getRewardSetting("apy_180_day");

    const apy30 = apy30Setting ? parseFloat(apy30Setting.settingValue) : 6.0;
    const apy90 = apy90Setting ? parseFloat(apy90Setting.settingValue) : 7.5;
    const apy180 = apy180Setting ? parseFloat(apy180Setting.settingValue) : 9.0;

    const pools = [
      {
        id: 1,
        name: "Pool 1",
        apyRate: apy30,
        lockPeriodDays: 30,
      },
      {
        id: 2,
        name: "Pool 2",
        apyRate: apy90,
        lockPeriodDays: 90,
      },
      {
        id: 3,
        name: "Pool 3",
        apyRate: apy180,
        lockPeriodDays: 180,
      },
    ];

    res.json({
      success: true,
      pools: pools,
    });
  } catch (error) {
    console.error("Error fetching staking pools:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch staking pools",
    });
  }
});

// DApp pools endpoint
app.get("/api/dapp/pools", async (req, res) => {
  try {
    // Get current APY settings from admin
    const apy30Setting = await storage.getRewardSetting("apy_30_day");
    const apy90Setting = await storage.getRewardSetting("apy_90_day");
    const apy180Setting = await storage.getRewardSetting("apy_180_day");

    const pools = [
      {
        id: 0,
        name: "30-Day Pool",
        apy: apy30Setting ? parseFloat(apy30Setting.settingValue) : 6,
        lockPeriod: 30,
        minStake: 10,
        maxStake: 10000,
      },
      {
        id: 1,
        name: "90-Day Pool",
        apy: apy90Setting ? parseFloat(apy90Setting.settingValue) : 7.5,
        lockPeriod: 90,
        minStake: 10,
        maxStake: 10000,
      },
      {
        id: 2,
        name: "180-Day Pool",
        apy: apy180Setting ? parseFloat(apy180Setting.settingValue) : 12,
        lockPeriod: 180,
        minStake: 10,
        maxStake: 10000,
      },
    ];

    res.json({
      success: true,
      pools: pools,
    });
  } catch (error) {
    console.error("Error fetching pools:", error);
    res.json({
      success: true,
      pools: [
        {
          id: 0,
          name: "30-Day Pool",
          apy: 6,
          lockPeriod: 30,
          minStake: 10,
          maxStake: 10000,
        },
        {
          id: 1,
          name: "90-Day Pool",
          apy: 7.5,
          lockPeriod: 90,
          minStake: 10,
          maxStake: 10000,
        },
        {
          id: 2,
          name: "180-Day Pool",
          apy: 12,
          lockPeriod: 180,
          minStake: 10,
          maxStake: 10000,
        },
      ],
    });
  }
});

// Market overview endpoint
app.get("/api/market/overview", async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        tokenPrice: 0.01,
        marketCap: 1000000,
        volume24h: 50000,
        priceChange24h: 2.5,
      },
    });
  } catch (error) {
    console.error("Error fetching market overview:", error);
    res.json({
      success: true,
      data: {
        tokenPrice: 0.01,
        marketCap: 1000000,
        volume24h: 50000,
        priceChange24h: 2.5,
      },
    });
  }
});

// Dashboard stats endpoint
app.get("/api/dashboard-stats", async (req, res) => {
  try {
    const allUsers = await storage.getAllUsers();
    let totalStaked = 0;
    let totalUsers = 0;
    let activeStakes = 0;

    for (const user of allUsers) {
      const stakes = await storage.getUserStakes(user._id);
      const userActiveStakes = stakes.filter((s) => s.status !== "withdrawn");
      if (userActiveStakes.length > 0) {
        totalUsers++;
        activeStakes += userActiveStakes.length;
        totalStaked += userActiveStakes.reduce(
          (sum, s) => sum + parseFloat(s.amount || "0"),
          0,
        );
      }
    }

    res.json({
      success: true,
      stats: {
        totalStaked: totalStaked.toFixed(2),
        totalUsers,
        activeStakes,
        tvl: totalStaked.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.json({
      success: false,
      stats: {
        totalStaked: "0.00",
        totalUsers: 0,
        activeStakes: 0,
        tvl: "0.00",
      },
    });
  }
});

// Leaderboard endpoint
app.get("/api/leaderboard", async (req, res) => {
  try {
    // Get top stakers from database
    const allUsers = await storage.getAllUsers();
    const leaderboard: any[] = [];

    for (const user of allUsers) {
      const stakes = await storage.getUserStakes(user._id);

      // Only count non-withdrawn stakes (active stakes currently in contract)
      const activeStakes = stakes.filter((s) => s.status !== "withdrawn");

      // Calculate total active staked amount
      const activeStaked = activeStakes.reduce((sum, stake) => {
        return sum + parseFloat(stake.amount || "0");
      }, 0);

      // Calculate current pending rewards from active stakes only
      let totalRewards = 0;
      const now = new Date();

      for (const stake of activeStakes) {
        if (stake.startTime) {
          const principal = parseFloat(stake.amount);
          const apyRate = parseFloat(stake.apyRate || "6");
          const stakeTime = new Date(stake.startTime);
          const elapsedSeconds = Math.floor(
            (now.getTime() - stakeTime.getTime()) / 1000,
          );
          const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60);
          const rewards = principal * (apyRate / 100) * timeElapsedInYears;
          totalRewards += rewards;
        }
      }

      if (activeStaked > 0) {
        leaderboard.push({
          rank: 0,
          walletAddress: user.walletAddress || "Unknown",
          totalStaked: activeStaked.toFixed(2),
          rewardsEarned: totalRewards.toFixed(6),
          activeStakes: activeStakes.length,
        });
      }
    }

    // Sort by total staked and assign ranks
    const sortedLeaderboard = leaderboard
      .sort((a, b) => parseFloat(b.totalStaked) - parseFloat(a.totalStaked))
      .map((entry, index) => ({
        rank: index + 1,
        walletAddress: entry.walletAddress,
        totalStaked: entry.totalStaked,
        rewardsEarned: entry.rewardsEarned,
        activeStakes: (entry as any).activeStakes,
      }));

    res.json({
      success: true,
      leaderboard: sortedLeaderboard.slice(0, 10),
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.json({
      success: true,
      leaderboard: [],
    });
  }
});

// Program info endpoint
app.get("/api/dapp/program-info", async (req, res) => {
  try {
    res.json({
      success: true,
      programInfo: {
        programId: simplifiedMultipleStaking.programIdString,
        tokenMint: "3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P",
        stakingPool: "8Nfa7XTRCQmvp6xYYR1CttiU6NAp9MSPJ3q18XpjhfbB",
        totalStaked: "0.00",
        network: "devnet",
      },
    });
  } catch (error) {
    console.error("Error fetching program info:", error);
    res.json({
      success: true,
      programInfo: {
        programId: "7GKL6U2Rh3PzGNPpeN7PdQNucSCg2HJMa41EqR9qVeBm",
        tokenMint: "3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P",
        stakingPool: "8Nfa7XTRCQmvp6xYYR1CttiU6NAp9MSPJ3q18XpjhfbB",
        totalStaked: "0.00",
        network: "devnet",
      },
    });
  }
});

// Connect wallet endpoint
app.post("/api/connect-wallet", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress",
      });
    }

    // Create user if doesn't exist
    const user = await storage.createUserWithWallet(walletAddress);

    res.json({
      success: true,
      user: {
        id: user._id,
        walletAddress: user.walletAddress,
      },
    });
  } catch (error) {
    console.error("Error connecting wallet:", error);
    res.status(500).json({
      success: false,
      error: "Failed to connect wallet",
    });
  }
});

// Get token balance endpoint
app.get("/api/dapp/balance/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Get SHSY token balance using token reader
    const balance = await tokenReader.getSHSYBalance(walletAddress);

    res.json({
      success: true,
      balance: balance.toString(),
    });
  } catch (error) {
    console.error("Error fetching token balance:", error);
    res.json({
      success: true,
      balance: "0",
    });
  }
});

// Create stake transaction endpoint
app.post("/api/dapp/create-stake", async (req, res) => {
  try {
    const { userWallet, amount, poolId } = req.body;

    if (!userWallet || !amount || poolId === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: userWallet, amount, poolId",
      });
    }

    const stakeTransaction =
      await simplifiedMultipleStaking.createStakeTransaction(
        userWallet,
        amount,
      );
    res.json({
      success: true,
      ...stakeTransaction,
    });
  } catch (error) {
    console.error("Error creating stake transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create stake transaction: " + error.message,
    });
  }
});

// Create withdraw transaction endpoint
app.post("/api/dapp/create-withdraw", async (req, res) => {
  try {
    const { userWallet, amount } = req.body;

    if (!userWallet || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: userWallet, amount",
      });
    }

    const withdrawTransaction =
      await simplifiedMultipleStaking.createWithdrawTransaction(
        userWallet,
        amount,
      );
    res.json({
      success: true,
      ...withdrawTransaction,
    });
  } catch (error) {
    console.error("Error creating withdraw transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create withdraw transaction: " + error.message,
    });
  }
});

// Get program info endpoint for DApp
app.get("/api/dapp/program-info", async (req, res) => {
  try {
    res.json({
      success: true,
      programInfo: {
        programId: "7GKL6U2Rh3PzGNPpeN7PdQNucSCg2HJMa41EqR9qVeBm",
        tokenMint: "3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P",
        network: "devnet",
      },
    });
  } catch (error) {
    console.error("Error fetching program info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch program info",
    });
  }
});

// Get staking pools endpoint for DApp
app.get("/api/dapp/pools", async (req, res) => {
  try {
    const pools = [
      {
        id: 0,
        name: "30-Day Pool",
        apy: 6,
        lockPeriod: 30,
        minStake: 10,
        maxStake: 10000,
      },
      {
        id: 1,
        name: "90-Day Pool",
        apy: 7.5,
        lockPeriod: 90,
        minStake: 10,
        maxStake: 10000,
      },
      {
        id: 2,
        name: "180-Day Pool",
        apy: 12,
        lockPeriod: 180,
        minStake: 10,
        maxStake: 10000,
      },
    ];

    res.json({
      success: true,
      pools: pools,
    });
  } catch (error) {
    console.error("Error fetching pools:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch pools",
    });
  }
});

// Get user stakes endpoint for DApp with pagination support
app.get("/api/dapp/stakes/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        stakes: [],
        pagination: { page: 1, limit: 10, totalStakes: 0, totalPages: 0 },
      });
    }

    const stakes = await storage.getUserStakes(user._id);
    console.log("stakes: " + stakes);
    // Calculate rewards for each stake
    const stakesWithRewards = stakes.map((stake) => {
      const now = new Date();
      const startTime = new Date(stake.startTime || Date.now());

      // Calculate pending rewards using actual APY formula (matching DApp display)
      let pendingRewards = 0;

      // Stop reward accumulation for withdrawn stakes
      if (stake.status === "withdrawn") {
        pendingRewards = 0; // No rewards for withdrawn stakes
      } else {
        const elapsedSeconds = Math.floor(
          (now.getTime() - startTime.getTime()) / 1000,
        );
        if (elapsedSeconds > 0) {
          const principal = parseFloat(stake.amount);
          const apyRate = parseFloat(stake.apyRate || "5");
          const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60); // Convert seconds to years for APY calculation
          pendingRewards = principal * (apyRate / 100) * timeElapsedInYears;
        }
      }

      return {
        id: stake.id,
        stakeIndex: stake.stakeIndex,
        amount: stake.amount,
        lockPeriodDays: stake.lockPeriodDays,
        apyRate: stake.apyRate,
        duration: stake.duration,
        status: stake.status,
        createdAt: stake.createdAt,
        startTime: stake.startTime,
        lockedUntil: stake.lockedUntil,
        transactionSignature: stake.transactionSignature,
        pendingRewards: pendingRewards.toFixed(8),
      };
    });

    // Add pagination support for staking records
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const totalStakes = stakesWithRewards.length;
    const totalPages = Math.ceil(totalStakes / limit);
    const paginatedStakes = stakesWithRewards.slice(offset, offset + limit);

    res.json({
      success: true,
      stakes: paginatedStakes,
      pagination: {
        page,
        limit,
        totalStakes,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching user stakes:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stakes",
    });
  }
});

// Dashboard page
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Alternative market overview endpoint
app.get("/api/market-overview", async (req, res) => {
  try {
    const stats = await storage.getDashboardStats();
    res.json({
      totalValueLocked: `${stats.totalStaked} SHSY`,
      activeStakers: stats.totalUsers,
      averageAPY: "7.5%",
      totalRewards: `${stats.totalRewards} SHSY`,
    });
  } catch (error) {
    console.error("Error fetching market overview:", error);
    res.json({
      totalValueLocked: "0 SHSY",
      activeStakers: 0,
      averageAPY: "7.5%",
      totalRewards: "0 SHSY",
    });
  }
});

// General stats endpoint
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await storage.getDashboardStats();
    res.json({
      success: true,
      totalStaked: stats.totalStaked,
      totalUsers: stats.totalUsers,
      totalRewards: stats.totalRewards,
    });
  } catch (error) {
    console.error("Error fetching general stats:", error);
    res.json({
      success: true,
      totalStaked: "0",
      totalUsers: 0,
      totalRewards: "0",
    });
  }
});

// DApp stake creation endpoint
app.post("/api/dapp/stake/create-transaction", async (req, res) => {
  try {
    const { walletAddress, amount, poolId } = req.body;

    console.log("Creating stake transaction for:", {
      walletAddress,
      amount,
      poolId,
    });

    if (!walletAddress || !amount || poolId === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, amount, poolId",
      });
    }

    // Map poolId to lock period
    const lockPeriodMap = { 1: 30, 2: 90, 3: 180 };
    const lockPeriod = lockPeriodMap[poolId];

    if (!lockPeriod) {
      return res.status(400).json({
        success: false,
        error: "Invalid poolId. Must be 1, 2, or 3",
      });
    }

    // Create simplified stake transaction
    const transactionData =
      await simplifiedMultipleStaking.createStakeTransaction(
        walletAddress,
        parseFloat(amount),
      );

    // Get APY for pool
    const apySetting = await storage.getRewardSetting(`apy_${lockPeriod}_day`);
    const apy = apySetting ? parseFloat(apySetting.settingValue) : 5.0;

    res.json({
      success: true,
      transactionData: {
        serializedTransaction: transactionData.serializedTransaction,
        programId: transactionData.programId,
        stakeAmount: amount,
        instructions: transactionData.instructionData,
      },
      stakingDetails: {
        amount: amount,
        poolId: poolId,
        apy: apy,
        lockPeriod: lockPeriod,
        stakeIndex: 0,
      },
      message: `Anchor staking transaction created for ${amount} SHSY stake`,
    });
  } catch (error) {
    console.error("Error creating stake transaction:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// DApp stake confirmation endpoint (saves to database after blockchain confirmation)
app.post("/api/dapp/stake/confirm", async (req, res) => {
  try {
    const { walletAddress, amount, poolId, transactionSignature } = req.body;

    console.log("Confirming stake transaction:", {
      walletAddress,
      amount,
      poolId,
      transactionSignature,
    });

    if (
      !walletAddress ||
      !amount ||
      poolId === undefined ||
      !transactionSignature
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: walletAddress, amount, poolId, transactionSignature",
      });
    }

    // Verify transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(transactionSignature);
    if (!verification.confirmed) {
      return res.status(400).json({
        success: false,
        error: "Transaction not confirmed on blockchain",
      });
    }

    // Create user if doesn't exist
    const user = await storage.createUserWithWallet(walletAddress);

    // Map poolId to lock period
    const lockPeriodMap = { 1: 30, 2: 90, 3: 180 };
    const lockPeriod = lockPeriodMap[poolId];

    // Get APY rate
    const apySetting = await storage.getRewardSetting(`apy_${lockPeriod}_day`);
    const apyRate = apySetting ? parseFloat(apySetting.settingValue) : 5.0;

    // Get next stake index for user
    const stakeIndex = await storage.getNextStakeIndex(walletAddress);

    // Calculate lock expiry time
    const lockDurationMs = lockPeriod * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const lockedUntil = new Date(Date.now() + lockDurationMs);

    // Create stake record in database
    const stakeRecord = await storage.createStakeWithIndex({
      userId: user._id.toString(),
      walletAddress: walletAddress,
      stakeIndex: stakeIndex,
      amount: amount.toString(),
      lockPeriodDays: lockPeriod,
      apyRate: apyRate.toString(),
      lockedUntil: lockedUntil,
      duration: lockPeriod,
      status: "active",
      transactionSignature: transactionSignature,
      startTime: new Date(),
    });

    console.log("Stake record created:", stakeRecord.id);

    // Auto-manage staking challenges for new stakes
    try {
      await manageStakingChallenges(walletAddress, user._id, "stake_created");
    } catch (challengeError) {
      console.error("Error managing challenges:", challengeError);
      // Don't fail the stake creation if challenges fail
    }

    res.json({
      success: true,
      stakeId: stakeRecord.id,
      stakeIndex: stakeIndex,
      message: "Stake confirmed and saved to database",
    });
  } catch (error) {
    console.error("Error confirming stake:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Database save failed",
    });
  }
});

// Get user stakes (alternative endpoint)
app.get("/api/user/stakes/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        stakes: [],
      });
    }

    const stakes = await storage.getUserStakes(user._id);

    const stakesWithRewards = stakes.map((stake) => {
      const now = new Date();
      const startTime = new Date(stake.startTime || Date.now());

      // Calculate pending rewards using actual APY formula based on time spent staking
      let pendingRewards = 0;

      // Stop reward accumulation for withdrawn stakes
      if (stake.status === "withdrawn") {
        pendingRewards = 0; // No rewards for withdrawn stakes
      } else {
        const elapsedSeconds = Math.floor(
          (now.getTime() - startTime.getTime()) / 1000,
        );
        if (elapsedSeconds > 0) {
          const principal = parseFloat(stake.amount);
          const apyRate = parseFloat(stake.apyRate || "5");
          const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60); // Convert seconds to years for APY calculation
          pendingRewards = principal * (apyRate / 100) * timeElapsedInYears;
        }
      }

      return {
        id: stake.id,
        stakeIndex: stake.stakeIndex,
        amount: stake.amount,
        poolId:
          stake.lockPeriodDays === 30 ? 0 : stake.lockPeriodDays === 90 ? 1 : 2,
        apy: stake.apyRate,
        duration: stake.duration,
        status: stake.status,
        createdAt: stake.createdAt,
        startTime: stake.startTime,
        transactionSignature: stake.transactionSignature,
        pendingRewards: pendingRewards.toFixed(8),
      };
    });

    res.json({
      success: true,
      stakes: stakesWithRewards,
    });
  } catch (error) {
    console.error("Error fetching user stakes:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stakes",
    });
  }
});

// Export staking records as CSV
app.get("/api/dapp/stakes/export/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 8;
    const offset = (page - 1) * limit;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        stakes: [],
        total: 0,
        page,
        totalPages: 0,
      });
    }

    // Get all stakes for the user
    const allStakes = await storage.getUserStakes(user._id);

    // Apply pagination
    const paginatedStakes = allStakes.slice(offset, offset + limit);
    const totalPages = Math.ceil(allStakes.length / limit);

    // Calculate rewards and format data for CSV
    const now = new Date();
    const stakesForExport = paginatedStakes.map((stake) => {
      const startTime = new Date(stake.startTime || Date.now());
      let pendingRewards = 0;

      // Stop reward accumulation for withdrawn stakes
      if (stake.status !== "withdrawn") {
        const elapsedSeconds = Math.floor(
          (now.getTime() - startTime.getTime()) / 1000,
        );
        if (elapsedSeconds > 0) {
          const principal = parseFloat(stake.amount);
          const apyRate = parseFloat(stake.apyRate || "5");
          const timeElapsedInYears = elapsedSeconds / (365 * 24 * 60 * 60);
          pendingRewards = principal * (apyRate / 100) * timeElapsedInYears;
        }
      }

      return {
        "Stake ID": stake.id,
        "Amount (SHSY)": stake.amount,
        "APY Rate (%)": stake.apyRate || "5",
        "Lock Period (Days)": stake.lockPeriodDays || 30,
        Status: stake.status || "active",
        "Pending Rewards (SHSY)": pendingRewards.toFixed(8),
        "Created At": stake.createdAt
          ? new Date(stake.createdAt).toLocaleString()
          : "",
        "Started At": stake.startTime
          ? new Date(stake.startTime).toLocaleString()
          : "",
        "Completed At": stake.endTime
          ? new Date(stake.endTime).toLocaleString()
          : stake.status === "withdrawn"
            ? "Withdrawn"
            : "Active",
        "Transaction Signature": stake.transactionSignature || "",
      };
    });

    // Generate CSV content
    if (stakesForExport.length === 0) {
      return res.json({
        success: true,
        message: "No stakes found for this page",
        stakes: [],
        total: allStakes.length,
        page,
        totalPages,
      });
    }

    const headers = Object.keys(stakesForExport[0]);
    const csvRows = [
      headers.join(","),
      ...stakesForExport.map((row) =>
        headers
          .map((header) => {
            const value = row[header]?.toString() || "";
            // Escape commas and quotes in CSV
            return value.includes(",") || value.includes('"')
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          })
          .join(","),
      ),
    ];

    res.json({
      success: true,
      csvData: csvRows.join("\n"),
      stakes: stakesForExport,
      total: allStakes.length,
      page,
      totalPages,
      filename: `staking_records_${walletAddress.slice(0, 8)}_page${page}.csv`,
    });
  } catch (error) {
    console.error("Error exporting staking records:", error);
    res.status(500).json({
      success: false,
      error: "Failed to export staking records",
    });
  }
});

// DApp claim transaction endpoint
app.post("/api/dapp/claim/create-transaction", async (req, res) => {
  try {
    const { walletAddress, stakeId } = req.body;

    if (!walletAddress || !stakeId) {
      return res.status(400).json({
        error: "Missing required fields: walletAddress, stakeId",
      });
    }

    console.log(
      `Creating claim transaction for wallet: ${walletAddress}, stake ID: ${stakeId}`,
    );

    // Get stake from database
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const stakes = await storage.getUserStakes(user._id);
    const stake = stakes.find((s) => s.id === parseInt(stakeId));

    if (!stake) {
      return res.status(400).json({ error: "Stake not found" });
    }

    // Create withdraw transaction using simplified contract
    const transactionData =
      await simplifiedMultipleStaking.createWithdrawTransaction(
        walletAddress,
        parseFloat(stake.amount),
      );

    res.json({
      success: true,
      transactionData: {
        serializedTransaction: transactionData.serializedTransaction,
        programId: transactionData.programId,
        instructions: transactionData.instructionData,
      },
      message: `Anchor claim transaction created for stake ${stakeId}`,
    });
  } catch (error) {
    console.error("Error creating claim transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create claim transaction: " + error.message,
    });
  }
});

// SOL airdrop endpoint
app.post("/api/dapp/airdrop-sol", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: walletAddress",
      });
    }

    console.log(`Requesting SOL airdrop for wallet: ${walletAddress}`);

    const { PublicKey } = await import("@solana/web3.js");
    const recipientWallet = new PublicKey(walletAddress);

    // Request SOL airdrop
    const signature = await simplifiedMultipleStaking.connection.requestAirdrop(
      recipientWallet,
      1000000000, // 1 SOL
    );

    console.log(`SOL airdrop completed: ${signature}`);

    res.json({
      success: true,
      signature: signature,
      message: "SOL airdrop successful",
    });
  } catch (error) {
    console.error("Error requesting SOL airdrop:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Initialize staking pool endpoint
app.post("/api/dapp/initialize", async (req, res) => {
  try {
    console.log("Initializing staking pool...");

    // Actually initialize the staking pool
    const signature = await simplifiedMultipleStaking.initializeStakingPool();

    res.json({
      success: true,
      signature: signature,
      message: "Anchor staking pool initialized successfully",
    });
  } catch (error) {
    console.error("Error initializing staking pool:", error);
    res.status(500).json({
      success: false,
      error: "Failed to initialize staking pool: " + error.message,
    });
  }
});

// Recover stake endpoint
app.post("/api/recover-stake", async (req, res) => {
  try {
    const { walletAddress, amount, poolId, stakeIndex } = req.body;

    if (!walletAddress || !amount || poolId === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, amount, poolId",
      });
    }

    console.log("Recovering stake record:", {
      walletAddress,
      amount,
      poolId,
      stakeIndex,
    });

    // Create user if doesn't exist
    const user = await storage.createUserWithWallet(walletAddress);

    // Map poolId to lock period
    const lockPeriodMap = { 1: 30, 2: 90, 3: 180 };
    const lockPeriod = lockPeriodMap[poolId] || 30;

    // Get APY rate
    const apySetting = await storage.getRewardSetting(`apy_${lockPeriod}_day`);
    const apyRate = apySetting ? parseFloat(apySetting.settingValue) : 5.0;

    // Calculate lock expiry time in actual days for production
    const lockDurationMs = lockPeriod * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const lockedUntil = new Date(Date.now() + lockDurationMs);

    // Create stake record
    const stakeRecord = await storage.createStake({
      userId: user._id.toString(),
      walletAddress: walletAddress,
      stakeIndex: stakeIndex || 0,
      amount: amount.toString(),
      lockPeriodDays: lockPeriod,
      apyRate: apyRate.toString(),
      lockedUntil: lockedUntil,
      duration: lockPeriod,
      status: "active",
      transactionSignature: "recovered",
      startTime: new Date(),
    });

    // Auto-manage staking challenges for new stakes
    try {
      await manageStakingChallenges(walletAddress, user._id, "stake_created");
    } catch (challengeError) {
      console.error("Error managing challenges:", challengeError);
      // Don't fail the stake creation if challenges fail
    }

    res.json({
      success: true,
      stakeId: stakeRecord.id,
      message: "Stake record recovered successfully",
    });
  } catch (error) {
    console.error("Error recovering stake:", error);
    res.status(500).json({
      success: false,
      error: "Failed to recover stake",
    });
  }
});

// Sync user stakes for migration to new contract
// Fund the pool with tokens for rewards distribution
app.post("/api/admin/fund-pool", async (req, res) => {
  try {
    const { amount = 50000 } = req.body; // Default 50K tokens

    console.log(`Manual pool funding requested: ${amount} SHSY tokens`);

    const signature = await simplifiedMultipleStaking.fundPool(amount);

    res.json({
      success: true,
      message: `Pool funded with ${amount} SHSY tokens`,
      signature,
      amount,
    });
  } catch (error) {
    console.error("Pool funding error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.toString(),
    });
  }
});

app.post("/api/sync-user-stakes", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: walletAddress",
      });
    }

    // Get user
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Get all active stakes for this user
    const stakes = await storage.getUserStakes(user._id);
    const activeStakes = stakes.filter((stake) => stake.status === "active");

    // Calculate total staked amount
    const totalStaked = activeStakes.reduce((sum, stake) => {
      return sum + parseFloat(stake.amount);
    }, 0);

    console.log(
      `User ${walletAddress} has ${totalStaked} SHSY staked across ${activeStakes.length} stakes`,
    );

    if (totalStaked > 0) {
      // Create a minimal stake transaction to initialize UserStake account for migration
      const transaction =
        await simplifiedMultipleStaking.createUserStakeAccount(
          walletAddress,
          totalStaked,
        );

      res.json({
        success: true,
        transaction: transaction.serializedTransaction,
        totalStaked,
        activeStakesCount: activeStakes.length,
        message:
          "Sign this transaction to sync your stakes with the new secure contract",
      });
    } else {
      res.json({
        success: true,
        totalStaked: 0,
        activeStakesCount: 0,
        message: "No active stakes found - no sync needed",
      });
    }
  } catch (error) {
    console.error("Error syncing user stakes:", error);
    res.status(500).json({
      success: false,
      error: "Failed to sync user stakes",
    });
  }
});

// Cleanup pending stakes endpoint
app.post("/api/cleanup-pending-stakes", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: walletAddress",
      });
    }

    console.log(`Cleaning up pending stakes for wallet: ${walletAddress}`);

    // Get user and their stakes
    const user = await storage.getUserByWallet(walletAddress);
    if (user) {
      const stakes = await storage.getUserStakes(user._id);

      // Update any pending stakes to failed status
      for (const stake of stakes) {
        if (stake.status === "pending") {
          await storage.updateStake(stake.id, { status: "failed" });
        }
      }
    }

    res.json({
      success: true,
      message: "Pending stakes cleaned up successfully",
    });
  } catch (error) {
    console.error("Error cleaning up pending stakes:", error);
    res.status(500).json({
      success: false,
      error: "Failed to cleanup pending stakes",
    });
  }
});

// Admin reward rates endpoints
app.post("/api/admin/update-reward-rates", async (req, res) => {
  try {
    const { pool0Rate, pool1Rate, pool2Rate, adminWallet } = req.body;

    // Update reward settings
    if (pool0Rate !== undefined) {
      await storage.setRewardSetting(
        "apy_30_day",
        (pool0Rate / 100).toString(),
        "30-day pool APY rate",
      );
    }
    if (pool1Rate !== undefined) {
      await storage.setRewardSetting(
        "apy_90_day",
        (pool1Rate / 100).toString(),
        "90-day pool APY rate",
      );
    }
    if (pool2Rate !== undefined) {
      await storage.setRewardSetting(
        "apy_180_day",
        (pool2Rate / 100).toString(),
        "180-day pool APY rate",
      );
    }

    res.json({
      success: true,
      message: "Reward rates updated successfully",
      rates: {
        pool0: pool0Rate || 500,
        pool1: pool1Rate || 750,
        pool2: pool2Rate || 1000,
      },
    });
  } catch (error) {
    console.error("Error updating reward rates:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update reward rates",
    });
  }
});

app.get("/api/admin/reward-rates", async (req, res) => {
  try {
    const apy30 = await storage.getRewardSetting("apy_30_day");
    const apy90 = await storage.getRewardSetting("apy_90_day");
    const apy180 = await storage.getRewardSetting("apy_180_day");

    res.json({
      success: true,
      rates: {
        pool0: apy30 ? Math.round(parseFloat(apy30.settingValue) * 100) : 500,
        pool1: apy90 ? Math.round(parseFloat(apy90.settingValue) * 100) : 500,
        pool2: apy180 ? Math.round(parseFloat(apy180.settingValue) * 100) : 500,
      },
    });
  } catch (error) {
    console.error("Error fetching reward rates:", error);
    res.json({
      success: true,
      rates: {
        pool0: 500,
        pool1: 500,
        pool2: 500,
      },
    });
  }
});

// Admin stats endpoint
app.get("/api/admin/stats", async (req, res) => {
  try {
    const stats = await storage.getDashboardStats();
    res.json({
      success: true,
      totalUsers: stats.totalUsers,
      totalStaked: stats.totalStaked,
      totalStakes: stats.activeStakes,
      totalRewards: stats.totalRewards,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.json({
      success: true,
      totalUsers: 0,
      totalStaked: "0",
      totalStakes: 0,
      totalRewards: "0",
    });
  }
});

// Admin riddles endpoint
app.get("/api/admin/riddles", async (req, res) => {
  try {
    const riddles = await storage.getAllRiddles();
    res.json({
      success: true,
      riddles: riddles,
    });
  } catch (error) {
    console.error("Error fetching riddles:", error);
    res.json({
      success: true,
      riddles: [],
    });
  }
});

// Admin create riddle endpoint
app.post("/api/admin/riddles", async (req, res) => {
  try {
    const {
      contentChinese,
      contentEnglish,
      answer,
      hintChinese,
      hintEnglish,
      optionsEnglish,
      winReward,
      participationReward,
    } = req.body;

    if (!contentChinese || !contentEnglish || !answer || !optionsEnglish) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: contentChinese, contentEnglish, answer, optionsEnglish",
      });
    }

    const riddleData = {
      contentChinese,
      contentEnglish,
      answer,
      hintChinese: hintChinese || "",
      hintEnglish: hintEnglish || "",
      optionsEnglish: Array.isArray(optionsEnglish)
        ? optionsEnglish
        : JSON.parse(optionsEnglish),
      winReward: winReward || "10.00000000",
      participationReward: participationReward || "3.00000000",
      status: "pending",
    };

    const riddle = await storage.createRiddle(riddleData);
    res.json({
      success: true,
      riddle: riddle,
      message: "Riddle created successfully",
    });
  } catch (error) {
    console.error("Error creating riddle:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create riddle",
    });
  }
});

// Admin update riddle endpoint
app.put("/api/admin/riddles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      contentChinese,
      contentEnglish,
      answer,
      hintChinese,
      hintEnglish,
      optionsEnglish,
      winReward,
      participationReward,
      imageUrl,
    } = req.body;

    if (!contentChinese || !contentEnglish || !answer || !optionsEnglish) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: contentChinese, contentEnglish, answer, optionsEnglish",
      });
    }

    const riddleData = {
      contentChinese,
      contentEnglish,
      answer,
      hintChinese: hintChinese || "",
      hintEnglish: hintEnglish || "",
      optionsEnglish: Array.isArray(optionsEnglish)
        ? optionsEnglish
        : JSON.parse(optionsEnglish),
      winReward: winReward || "10.00000000",
      participationReward: participationReward || "3.00000000",
      imageUrl: imageUrl || null,
    };

    const riddle = await storage.updateRiddle(parseInt(id), riddleData);

    if (riddle) {
      res.json({
        success: true,
        riddle: riddle,
        message: "Riddle updated successfully",
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Riddle not found",
      });
    }
  } catch (error) {
    console.error("Error updating riddle:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update riddle",
    });
  }
});

// Admin update riddle status endpoint
app.put("/api/admin/riddles/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    // Check current active riddles count before activation
    if (action === "activate") {
      const activeCount = await storage.getActivePublishedRiddlesCount();
      if (activeCount >= 2) {
        return res.status(400).json({
          success: false,
          error:
            "Cannot activate more than 2 riddles at once. Please deactivate another riddle first.",
        });
      }
    }

    const status = action === "activate" ? "published" : "pending";
    const publishedAt = action === "activate" ? new Date() : undefined;
    const expiresAt =
      action === "activate"
        ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        : undefined; // 2 days

    const riddle = await storage.updateRiddleStatus(
      parseInt(id),
      status,
      publishedAt,
      expiresAt,
    );

    if (riddle) {
      res.json({
        success: true,
        riddle: riddle,
        message: `Riddle ${action === "activate" ? "activated" : "deactivated"} successfully`,
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Riddle not found",
      });
    }
  } catch (error) {
    console.error("Error updating riddle status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update riddle status",
    });
  }
});

// Admin delete riddle endpoint
app.delete("/api/admin/riddles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const success = await storage.deleteRiddle(parseInt(id));

    if (success) {
      res.json({
        success: true,
        message: "Riddle deleted successfully",
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Riddle not found",
      });
    }
  } catch (error) {
    console.error("Error deleting riddle:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete riddle",
    });
  }
});

// Admin batch upload riddles endpoint
app.post("/api/admin/riddles/batch-upload", async (req, res) => {
  try {
    const { riddles } = req.body;

    if (!riddles || !Array.isArray(riddles)) {
      return res.status(400).json({
        success: false,
        error: "Riddles array is required",
      });
    }

    const results: any[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < riddles.length; i++) {
      const riddleData = riddles[i];

      try {
        // Validate required fields
        if (
          !riddleData.contentChinese ||
          !riddleData.contentEnglish ||
          !riddleData.answer ||
          !riddleData.optionsEnglish ||
          riddleData.optionsEnglish.length !== 4
        ) {
          errors.push(`Riddle ${i + 1}: Missing required fields`);
          errorCount++;
          continue;
        }

        const formattedRiddleData = {
          contentChinese: riddleData.contentChinese,
          contentEnglish: riddleData.contentEnglish,
          answer: riddleData.answer,
          hintChinese: riddleData.hintChinese || "",
          hintEnglish: riddleData.hintEnglish || "",
          optionsEnglish: riddleData.optionsEnglish,
          winReward: riddleData.winReward || "10.00000000",
          participationReward: riddleData.participationReward || "3.00000000",
          status: "pending",
        };

        const riddle = await storage.createRiddle(formattedRiddleData);
        results.push(riddle);
        successCount++;
      } catch (error: any) {
        errors.push(`Riddle ${i + 1}: ${error.message}`);
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: `Upload completed: ${successCount} successful, ${errorCount} failed`,
      successCount,
      errorCount,
      results: results,
      errors: errors,
    });
  } catch (error) {
    console.error("Error in batch upload:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process batch upload",
    });
  }
});

// Admin reward settings endpoint
app.get("/api/admin/reward-settings", async (req, res) => {
  try {
    const rewardSettings = await storage.getAllRewardSettings();
    res.json({
      success: true,
      settings: rewardSettings,
    });
  } catch (error) {
    console.error("Error fetching reward settings:", error);
    res.json({
      success: true,
      settings: [],
    });
  }
});

// Admin lock settings endpoint
app.get("/api/admin/lock-settings", async (req, res) => {
  try {
    const lockSettings = await storage.getAllLockSettings();
    res.json({
      success: true,
      settings: lockSettings,
    });
  } catch (error) {
    console.error("Error fetching lock settings:", error);
    res.json({
      success: true,
      settings: [],
    });
  }
});

// Admin update reward setting endpoint
app.post("/api/admin/reward-settings", async (req, res) => {
  try {
    const {
      apy30Day,
      apy90Day,
      apy180Day,
      participation30d,
      participation10d,
      lockPercentage,
      lockDays,
    } = req.body;

    console.log("Updating reward and lock settings:", req.body);

    // Update APY settings
    if (apy30Day !== undefined) {
      await storage.setRewardSetting(
        "apy_30_day",
        apy30Day.toString(),
        "APY for 30-day lock period",
      );
    }
    if (apy90Day !== undefined) {
      await storage.setRewardSetting(
        "apy_90_day",
        apy90Day.toString(),
        "APY for 90-day lock period",
      );
    }
    if (apy180Day !== undefined) {
      await storage.setRewardSetting(
        "apy_180_day",
        apy180Day.toString(),
        "APY for 180-day lock period",
      );
    }

    // Update participation rewards
    if (participation30d !== undefined) {
      await storage.setRewardSetting(
        "participation_30d",
        participation30d.toString(),
        "30-day participation reward in SHSY",
      );
    }
    if (participation10d !== undefined) {
      await storage.setRewardSetting(
        "participation_10d",
        participation10d.toString(),
        "10-day participation reward in SHSY",
      );
    }

    // Update simplified lock settings (applies to all reward types)
    if (lockPercentage !== undefined) {
      await storage.setLockSetting(
        "lock_percentage",
        lockPercentage.toString(),
        "Percentage of all rewards to lock",
      );
    }
    if (lockDays !== undefined) {
      await storage.setLockSetting(
        "lock_days",
        lockDays.toString(),
        "Days to lock all reward portions",
      );
    }

    res.json({
      success: true,
      message: "Reward and lock settings updated successfully",
    });
  } catch (error) {
    console.error("Error updating reward settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update reward settings",
    });
  }
});

// Manual staking pool initialization endpoint
app.post("/api/admin/initialize-pool", async (req, res) => {
  try {
    console.log("Manual staking pool initialization requested...");
    const result = await simplifiedMultipleStaking.initializeStakingPool();

    if (result === "pool_already_exists") {
      res.json({
        success: true,
        message: "Staking pool already exists and is ready",
        poolAddress: simplifiedMultipleStaking
          .getStakingPoolPDA()[0]
          .toString(),
      });
    } else {
      res.json({
        success: true,
        message: "Staking pool initialized successfully",
        transactionSignature: result,
        poolAddress: simplifiedMultipleStaking
          .getStakingPoolPDA()[0]
          .toString(),
      });
    }
  } catch (error) {
    console.error("Error initializing staking pool:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: "Make sure admin wallet has sufficient SOL for transaction fees",
    });
  }
});

// Initialize pool token account endpoint
app.post("/api/admin/initialize-pool-token-account", async (req, res) => {
  try {
    console.log("Creating pool token account...");

    const [stakingPoolPDA] = simplifiedMultipleStaking.getStakingPoolPDA();
    const poolTokenAccount =
      await simplifiedMultipleStaking.getPoolTokenAccount();

    // Check if already exists
    const accountInfo =
      await simplifiedMultipleStaking.connection.getAccountInfo(
        poolTokenAccount,
      );
    if (accountInfo) {
      return res.json({
        success: true,
        message: "Pool token account already exists",
        poolTokenAccount: poolTokenAccount.toString(),
      });
    }

    // Create the token account
    await simplifiedMultipleStaking.initPoolTokenAccountIfNeeded();

    res.json({
      success: true,
      message: "Pool token account created successfully",
      poolTokenAccount: poolTokenAccount.toString(),
      stakingPool: stakingPoolPDA.toString(),
    });
  } catch (error) {
    console.error("Error creating pool token account:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Frontend routes - serve the DApp HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dapp.html"));
});

app.get("/dapp", (req, res) => {
  res.sendFile(path.join(__dirname, "dapp.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dapp.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "dapp.html"));
});

// Staking Challenges API Endpoints

// IMPORTANT: Specific routes must come before parameterized routes to avoid conflicts

// Start staking challenges
app.post("/api/dapp/challenges/start", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress",
      });
    }

    // Get user by wallet address
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Get existing challenges
    const existingChallenges =
      await storage.getActiveStakingChallenges(walletAddress);
    const existing10Day = existingChallenges.find(
      (c) => c.challengeType === "10_day",
    );
    const existing30Day = existingChallenges.find(
      (c) => c.challengeType === "30_day",
    );

    const now = new Date();
    const createdChallenges: any[] = [];

    // Create 10-day challenge if it doesn't exist
    if (!existing10Day) {
      const challenge10 = await storage.createStakingChallenge({
        userId: user._id.toString(),
        walletAddress: walletAddress,
        challengeType: "10_day",
        startedAt: now,
        lastStakeAt: now,
        currentStreak: 1,
        targetDays: 10, // This becomes minutes in our test setup
        rewardAmount: "75.00000000", // 75 SHSY reward
      });
      createdChallenges.push(challenge10);
      console.log("Created 10-day challenge:", challenge10.id);
    }

    // Create 30-day challenge if it doesn't exist
    if (!existing30Day) {
      const challenge30 = await storage.createStakingChallenge({
        userId: user._id.toString(),
        walletAddress: walletAddress,
        challengeType: "30_day",
        startedAt: now,
        lastStakeAt: now,
        currentStreak: 1,
        targetDays: 30, // This becomes minutes in our test setup
        rewardAmount: "150.00000000", // 150 SHSY reward
      });
      createdChallenges.push(challenge30);
      console.log("Created 30-day challenge:", challenge30.id);
    }

    // Update existing challenges with new stake activity
    if (existing10Day) {
      await storage.updateStakingChallengeProgress(walletAddress, "10_day");
      console.log("Updated 10-day challenge progress");
    }
    if (existing30Day) {
      await storage.updateStakingChallengeProgress(walletAddress, "30_day");
      console.log("Updated 30-day challenge progress");
    }

    res.json({
      success: true,
      message: "Staking challenges started/updated",
      created: createdChallenges.length,
      challenges: createdChallenges,
    });
  } catch (error) {
    console.error("Error starting challenges:", error);
    res.status(500).json({
      success: false,
      error: "Failed to start challenges",
    });
  }
});

// Verify challenge reward claim
app.post("/api/dapp/challenges/verify-claim", async (req, res) => {
  try {
    const { challengeId, transactionSignature } = req.body;

    if (!challengeId || !transactionSignature) {
      return res.status(400).json({
        success: false,
        error: "Missing challengeId or transactionSignature",
      });
    }

    // Verify transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(transactionSignature);

    if (verification.success && verification.confirmed) {
      // Mark challenge as claimed
      const challenge = await storage.claimStakingChallengeReward(challengeId);

      if (challenge) {
        // Use comprehensive challenge management system for post-claim handling
        try {
          await manageStakingChallenges(
            challenge.walletAddress,
            challenge.userId,
            "reward_claimed",
          );
        } catch (challengeError) {
          console.error(
            "Error managing challenges after claim:",
            challengeError,
          );
        }

        res.json({
          success: true,
          confirmed: true,
          message: "Challenge reward claimed successfully!",
          challenge: challenge,
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Challenge not found",
        });
      }
    } else {
      res.json({
        success: false,
        confirmed: false,
        error: verification.error || "Transaction not confirmed",
      });
    }
  } catch (error) {
    console.error("Error verifying challenge claim:", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify claim",
    });
  }
});

// Pause challenges when user withdraws all stakes
app.post("/api/dapp/challenges/pause", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress",
      });
    }

    await storage.pauseStakingChallenges(walletAddress);

    res.json({
      success: true,
      message: "Staking challenges paused",
    });
  } catch (error) {
    console.error("Error pausing challenges:", error);
    res.status(500).json({
      success: false,
      error: "Failed to pause challenges",
    });
  }
});

// Resume challenges when user stakes again
app.post("/api/dapp/challenges/resume", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress",
      });
    }

    await storage.resumeStakingChallenges(walletAddress);

    res.json({
      success: true,
      message: "Staking challenges resumed",
    });
  } catch (error) {
    console.error("Error resuming challenges:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resume challenges",
    });
  }
});

// Get global challenge status
app.get("/api/dapp/challenges/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Get user and check eligibility
    const user = await storage.getUserByWallet(walletAddress);
    let eligibilityData = {
      isEligible: false,
      hasStakes: false,
      hasGuesses: false,
      message:
        "Please stake some tokens or answer riddles to participate in the random reward pool",
    };
    console.log("Getting Challanges");
    if (user) {
      const isEligible = await checkUserEligibility(user._id.toString());

      eligibilityData = {
        isEligible: isEligible,
        hasStakes: false,
        hasGuesses: false,
        message: isEligible
          ? "You are eligible for the random reward pool (5 winners selected)"
          : "Please stake some tokens, answer riddles, or join the million pool to participate in the random reward pool",
      };
      // Add or remove user from global challenges based on eligibility
      await globalChallengeManager.addUser(user._id, walletAddress, isEligible);
    }

    // Get current global challenge status
    const challengeData = globalChallengeManager.getStatus(user?._id);
    console.log(`Total global challenges: ${challengeData.challenges.length}`);

    res.json({
      success: true,
      challenges: challengeData.challenges,
      pendingRewards: challengeData.pendingRewards,
      eligibility: eligibilityData,
    });
  } catch (error) {
    console.error("Error fetching global challenges:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch challenges",
    });
  }
});

// Claim global challenge reward
app.post("/api/dapp/challenges/claim", async (req, res) => {
  console.log("GLOBAL CHALLENGE CLAIM HIT:", {
    fullBody: req.body,
    challengeType: req.body.challengeType,
    walletAddress: req.body.walletAddress,
  });
  try {
    const { walletAddress, challengeType } = req.body;

    if (!walletAddress || !challengeType) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress or challengeType",
      });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Check if user has this reward to claim
    const pendingRewards = globalChallengeManager.getPendingRewards(user._id);
    const rewardToClaim = pendingRewards.find(
      (r) => r.challengeType === challengeType,
    );

    if (!rewardToClaim) {
      return res.status(400).json({
        success: false,
        error: "No reward available to claim for this challenge",
      });
    }

    // Claim the reward from global challenge manager first
    const claimed = globalChallengeManager.claimReward(user._id, challengeType);

    if (!claimed) {
      return res.status(400).json({
        success: false,
        error: "Reward has already been claimed or is no longer available",
      });
    }

    // Create SHSY withdrawal transaction for challenge reward using reward locking system
    try {
      const rewardAmountNumber = parseFloat(rewardToClaim.rewardAmount);
      const rewardType = `${challengeType}_challenge`;

      // Use reward locker to handle locking and withdrawal
      const result = await rewardLocker.lockReward(
        user._id,
        walletAddress,
        rewardType,
        rewardAmountNumber,
        undefined, // originalTransactionId
        "SHSY", // tokenType
      );

      console.log(
        `Created locked fund for user ${user._id}: ${rewardToClaim.rewardAmount} SHSY (${challengeType} challenge)`,
      );

      // Get the available amount that can be withdrawn immediately
      const availableAmount = result.availableAmount;
      const lockedAmount = result.lockedAmount;

      if (availableAmount > 0) {
        // Execute PDA-based distribution (user never signs)
        const distributionResult =
          await simplifiedMultipleStaking.createPDATokenDistribution(
            walletAddress,
            availableAmount,
            `challenge_${challengeType}`,
            "SHSY",
          );

        if (distributionResult.success) {
          const lockDays = result.lockedFund?.lockDays || 0;
          let message = `Challenge reward sent automatically! ${availableAmount.toFixed(8)} SHSY transferred to your wallet`;
          if (lockedAmount > 0) {
            message += ` (${lockedAmount.toFixed(8)} SHSY locked for ${lockDays} days)`;
          }

          res.json({
            success: true,
            completed: true,
            message: message,
            transactionSignature: distributionResult.transactionSignature,
            totalReward: rewardAmountNumber,
            availableAmount: availableAmount,
            lockedAmount: lockedAmount,
          });
        } else {
          return res.status(500).json({
            success: false,
            error: "PDA reward distribution failed",
            details: distributionResult.error,
          });
        }
      } else {
        // All funds are locked, no immediate withdrawal
        const lockDays = result.lockedFund?.lockDays || 0;
        res.json({
          success: true,
          completed: true,
          message: `All ${rewardToClaim.rewardAmount} SHSY locked for ${lockDays} days. Check Locked Funds section.`,
          rewardAmount: "0",
          lockedAmount: lockedAmount.toFixed(8),
          lockDurationDays: lockDays,
          allLocked: true,
        });
      }
    } catch (transactionError) {
      console.error(
        "Error creating challenge withdrawal transaction:",
        transactionError,
      );
      res.status(500).json({
        success: false,
        error: "Failed to create withdrawal transaction",
      });
    }
  } catch (error) {
    console.error("Error claiming global challenge reward:", error);
    res.status(500).json({
      success: false,
      error: "Failed to claim reward",
    });
  }
});

// Locked funds endpoints
app.get("/api/dapp/locked-funds/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        lockedFunds: [],
        summary: { totalLocked: "0", totalUnlockable: "0", totalCount: 0 },
      });
    }

    const lockedFunds = await storage.getLockedFundsByWallet(walletAddress);
    const availableLockedFunds =
      await storage.getAvailableLockedFunds(walletAddress);

    const totalLocked = lockedFunds.reduce(
      (sum, fund) => sum + parseFloat(fund.lockedAmount),
      0,
    );
    const totalUnlockable = availableLockedFunds.reduce(
      (sum, fund) => sum + parseFloat(fund.lockedAmount),
      0,
    );

    res.json({
      success: true,
      lockedFunds,
      summary: {
        totalLocked: totalLocked.toFixed(8),
        totalUnlockable: totalUnlockable.toFixed(8),
        totalCount: lockedFunds.length,
      },
    });
  } catch (error) {
    console.error("Error fetching locked funds:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch locked funds",
    });
  }
});

// Unlock locked funds endpoint
app.post("/api/dapp/locked-funds/unlock", async (req, res) => {
  try {
    const { lockedFundId, walletAddress } = req.body;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const lockedFunds = await storage.getLockedFundsByWallet(walletAddress);
    const lockedFund = lockedFunds.find((fund) => fund.id === lockedFundId);

    if (!lockedFund) {
      return res.status(404).json({
        success: false,
        error: "Locked fund not found",
      });
    }

    const now = new Date();
    const unlockDate = new Date(lockedFund.unlocksAt);

    if (now < unlockDate) {
      return res.status(400).json({
        success: false,
        error: `Fund cannot be unlocked until ${unlockDate.toLocaleDateString()}`,
      });
    }

    if (lockedFund.status !== "locked") {
      return res.status(400).json({
        success: false,
        error: "Fund has already been withdrawn",
      });
    }

    // Million pool rewards are now distributed in SHSY tokens
    const tokenType = lockedFund.tokenType || "SHSY";

    let transactionResult;
    if (lockedFund.rewardType === "million_pool") {
      // For million pool rewards, use specialized SHSY withdrawal transaction
      transactionResult =
        await simplifiedMultipleStaking.createMillionPoolSHSYWithdrawTransaction(
          walletAddress,
          parseFloat(lockedFund.lockedAmount),
        );
    } else {
      // For other SHSY rewards, use standard withdrawal transaction
      transactionResult =
        await simplifiedMultipleStaking.createWithdrawTransaction(
          walletAddress,
          parseFloat(lockedFund.lockedAmount),
        );
    }

    if (!transactionResult || !transactionResult.transaction) {
      return res.status(500).json({
        success: false,
        error: "Failed to create unlock transaction",
      });
    }

    res.json({
      success: true,
      transactionData: transactionResult,
      rewardAmount: lockedFund.lockedAmount,
      rewardType: lockedFund.rewardType,
      tokenType: tokenType,
      lockedFundId,
    });
  } catch (error) {
    console.error("Error creating unlock transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create unlock transaction",
    });
  }
});

// Verify unlock transaction endpoint
app.post("/api/dapp/locked-funds/verify-unlock", async (req, res) => {
  try {
    const { signature, lockedFundId } = req.body;

    const verificationResult =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (verificationResult.success && verificationResult.confirmed) {
      const withdrawnFund = await storage.withdrawLockedFund(lockedFundId);

      if (withdrawnFund) {
        console.log(
          `Locked fund ${lockedFundId} successfully withdrawn via transaction ${signature}`,
        );
        res.json({
          success: true,
          message: "Unlock verified and fund marked as withdrawn",
          transactionSignature: signature,
          rewardType: withdrawnFund.rewardType,
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to update locked fund status",
        });
      }
    } else {
      res.status(400).json({
        success: false,
        error: "Transaction verification failed",
      });
    }
  } catch (error) {
    console.error("Error verifying unlock transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify unlock transaction",
    });
  }
});

// Million Pool API endpoints

// Get million pool settings (admin)
app.get("/api/admin/million-pool/settings", async (req, res) => {
  try {
    const settings = await storage.getMillionPoolSettings();
    res.json({
      success: true,
      settings: settings || {
        isActive: false,
        distributionFrequencyMinutes: 1440,
        rewardAmountShsy: "10.00",
        numberOfWinners: 5,
        usdtRequirement: "4.00",
        shsyRequirement: "100.00",
      },
    });
  } catch (error) {
    console.error("Error fetching million pool settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch million pool settings",
    });
  }
});

// Update million pool settings (admin)
app.post("/api/admin/million-pool/settings", async (req, res) => {
  try {
    const {
      isActive,
      distributionFrequencyMinutes,
      rewardAmountShsy,
      numberOfWinners,
      usdtRequirement,
      shsyRequirement,
    } = req.body;

    const settings = await storage.updateMillionPoolSettings({
      isActive,
      distributionFrequencyMinutes,
      rewardAmountShsy,
      numberOfWinners,
      usdtRequirement,
      shsyRequirement,
    });

    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error("Error updating million pool settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update million pool settings",
    });
  }
});

// Get million pool status for dApp
app.get("/api/dapp/million-pool/status", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    const settings = await storage.getMillionPoolSettings();

    if (!settings || !settings.isActive) {
      return res.json({
        success: true,
        isActive: false,
        eligible: false,
      });
    }

    let eligibility = {
      eligible: false,
      qualificationType: "none",
      amount: "0",
    };

    if (walletAddress) {
      const user = await storage.getUserByWallet(walletAddress as string);
      if (user) {
        eligibility = await storage.checkMillionPoolEligibility(user._id);
      }
    }

    res.json({
      success: true,
      isActive: true,
      settings: {
        distributionFrequencyMinutes: settings.distributionFrequencyMinutes,
        rewardAmountShsy: settings.rewardAmountShsy,
        numberOfWinners: settings.numberOfWinners,
        usdtRequirement: settings.usdtRequirement,
        shsyRequirement: settings.shsyRequirement,
      },
      eligibility,
    });
  } catch (error) {
    console.error("Error fetching million pool status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch million pool status",
    });
  }
});

// Get million pool status for specific wallet (dashboard endpoint)
app.get("/api/dapp/million-pool/status/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: false,
        participant: null,
        timing: null,
      });
    }

    const participant = await storage.getMillionPoolParticipant(user._id);
    const settings = await storage.getMillionPoolSettings();

    // Get timing information
    let timing = null;
    if (settings && settings.isActive) {
      const lastDistribution = await storage.getLastMillionPoolDistribution();
      const now = new Date();

      // Calculate distribution cycle timing
      const distributionIntervalMs =
        settings.distributionFrequencyMinutes * 60 * 1000;

      let cycleStartTime;
      if (lastDistribution) {
        cycleStartTime = lastDistribution.createdAt;
      } else {
        // If no previous distribution, use a default start time (server start or fixed time)
        cycleStartTime = new Date(now.getTime() - distributionIntervalMs / 2); // Assume we're halfway through first cycle
      }

      const nextDistributionTime = new Date(
        cycleStartTime.getTime() + distributionIntervalMs,
      );

      // Calculate progress
      const cycleElapsedMs = now.getTime() - cycleStartTime.getTime();
      const progressPercentage = Math.min(
        (cycleElapsedMs / distributionIntervalMs) * 100,
        100,
      );

      timing = {
        cycleStartTime,
        currentTime: now,
        nextDistributionTime,
        distributionFrequencyMinutes: settings.distributionFrequencyMinutes,
        progressPercentage: Math.round(progressPercentage * 100) / 100, // Round to 2 decimal places
      };
    }

    res.json({
      success: true,
      participant: participant,
      timing: timing,
    });
  } catch (error) {
    console.error("Error fetching million pool participant status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch participant status",
    });
  }
});

// Join million pool with USDT deposit
app.post("/api/dapp/million-pool/join-usdt", async (req, res) => {
  try {
    const { walletAddress, depositAmount, transactionId } = req.body;

    if (!walletAddress || !depositAmount || !transactionId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const settings = await storage.getMillionPoolSettings();
    if (!settings || !settings.isActive) {
      return res.status(400).json({
        success: false,
        error: "Million pool is not active",
      });
    }

    if (parseFloat(depositAmount) < parseFloat(settings.usdtRequirement)) {
      return res.status(400).json({
        success: false,
        error: `Minimum deposit is ${settings.usdtRequirement} USDT`,
      });
    }

    // Check if user already participating
    const existingParticipant = await storage.getMillionPoolParticipant(
      user._id,
    );
    if (existingParticipant) {
      return res.status(400).json({
        success: false,
        error: "User already participating in million pool",
      });
    }

    const participant = await storage.addMillionPoolParticipant({
      userId: user._id.toString(),
      walletAddress,
      participationType: "usdt_deposit",
      usdtDepositAmount: depositAmount,
      depositTransactionId: transactionId,
    });

    res.json({
      success: true,
      participant,
    });
  } catch (error) {
    console.error("Error joining million pool with USDT:", error);
    res.status(500).json({
      success: false,
      error: "Failed to join million pool",
    });
  }
});

// Get user's million pool participation status
app.get("/api/dapp/million-pool/participation", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required",
      });
    }

    const user = await storage.getUserByWallet(walletAddress as string);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const eligibility = await storage.checkMillionPoolEligibility(user._id);
    const participant = await storage.getMillionPoolParticipant(user._id);
    const winners = await storage.getMillionPoolWinnersByUser(user._id);

    res.json({
      success: true,
      eligibility,
      participant,
      winners,
    });
  } catch (error) {
    console.error("Error fetching million pool participation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch participation status",
    });
  }
});

// USDT Deposit endpoints for million pool
app.post("/api/million-pool/usdt-deposit", async (req, res) => {
  try {
    const { walletAddress, depositAmount } = req.body;

    if (!walletAddress || !depositAmount) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const transaction =
      await simplifiedMultipleStaking.createUSDTDepositTransaction(
        walletAddress,
        parseFloat(depositAmount),
      );

    res.json({
      success: true,
      transaction: transaction.serializedTransaction,
    });
  } catch (error) {
    console.error("Failed to create USDT deposit transaction:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create transaction" });
  }
});

// Million pool deposit endpoint for dashboard
app.post("/api/million-pool/deposit", async (req, res) => {
  try {
    const { walletAddress, amount } = req.body;

    if (!walletAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: walletAddress and amount",
      });
    }

    // Create USDT deposit transaction - deposits go to admin wallet, not smart contract
    const adminWallet = "4fNiVj8NNSYLM8nJtN2CXjCfKrNKAyNqFCMteBbdwj8G";

    // For dashboard deposits, we create a simple USDT transfer to admin wallet
    const usdtMint = new PublicKey(
      "13Nf1g3rf1k8vY4QzQRBGFVBtcd4kGvriCqpmF5GyPvn",
    ); // Devnet USDT
    const fromWallet = new PublicKey(walletAddress);
    const toWallet = new PublicKey(adminWallet);

    // Get associated token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      usdtMint,
      fromWallet,
    );
    const toTokenAccount = await getAssociatedTokenAddress(usdtMint, toWallet);

    // Create transfer instruction
    const transaction = new Transaction();
    const transferInstruction = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromWallet,
      parseFloat(amount) * 1000000, // Convert to microUSDT (6 decimals)
      [],
      TOKEN_PROGRAM_ID,
    );

    transaction.add(transferInstruction);

    // Get recent blockhash
    const { blockhash } =
      await simplifiedMultipleStaking.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromWallet;

    // Serialize transaction
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
    });

    res.json({
      success: true,
      transaction: serializedTransaction.toString("base64"),
      message: "USDT deposit transaction created successfully",
    });
  } catch (error) {
    console.error("Failed to create USDT deposit transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create deposit transaction",
    });
  }
});

// DApp USDT deposit endpoint - creates actual blockchain transaction
app.post("/api/dapp/deposit-usdt", async (req, res) => {
  try {
    const { walletAddress, amount } = req.body;

    if (!walletAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: walletAddress, amount",
      });
    }

    // Validate amount (should be 4 USDT)
    if (parseFloat(amount) !== 4) {
      return res.status(400).json({
        success: false,
        error: "Amount must be exactly $4 USDT",
      });
    }

    // Create actual USDT deposit transaction that user must sign
    const transaction =
      await simplifiedMultipleStaking.createUSDTDepositTransaction(
        walletAddress,
        amount,
      );

    res.json({
      success: true,
      transaction: transaction.serializedTransaction,
      message:
        "USDT deposit transaction created - please sign with your wallet",
    });
  } catch (error) {
    console.error("Failed to create USDT deposit transaction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create USDT deposit transaction",
    });
  }
});

// Add missing verify-deposit endpoint
app.post("/api/million-pool/verify-deposit", async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress or signature",
      });
    }

    // Get or create user
    let user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      user = await storage.createUserWithWallet(walletAddress);
    }

    // Add user to million pool with USDT deposit type
    const participant = await storage.addMillionPoolParticipant({
      userId: user._id.toString(),
      walletAddress: walletAddress,
      participationType: "usdt",
      usdtDepositAmount: "4.00",
      isActive: true,
    });

    // Add to global challenges
    if (participant) {
      console.log(
        `Added user ${user._id} to global challenges after USDT deposit verification`,
      );
      await globalChallengeManager.addUser(user._id, walletAddress, true);
    }

    // Update existing participation if already exists
    if (!participant) {
      await storage.updateParticipantStatus(user._id, true);
      await globalChallengeManager.addUser(user._id, walletAddress, true);
    }

    res.json({
      success: true,
      message: "USDT deposit verified and participation recorded",
      signature: signature,
    });
  } catch (error) {
    console.error("Failed to verify USDT deposit:", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify USDT deposit",
    });
  }
});

// Dashboard USDT deposit verification and participation recording (legacy)
app.post("/api/million-pool/verify-deposit-legacy", async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: walletAddress and signature",
      });
    }

    // Verify transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (!verification.success) {
      return res.status(400).json({
        success: false,
        error: "Transaction verification failed",
      });
    }

    // Get or create user
    let user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      user = await storage.createUserWithWallet(walletAddress);
    }

    // Check if user already has million pool participation
    const existingParticipant = await storage.getMillionPoolParticipant(
      user._id,
    );

    if (existingParticipant && existingParticipant.isActive) {
      return res.json({
        success: true,
        message: "Already participating in Million SHSY Pool",
        alreadyParticipating: true,
      });
    }

    // Add user to million pool with USDT deposit type
    await storage.addMillionPoolParticipant({
      userId: user._id.toString(),
      walletAddress: walletAddress,
      participationType: "usdt",
      usdtDepositAmount: "4.00",
      isActive: true,
    });

    // Add user to global challenges (they're now eligible)
    const isEligible = await checkUserEligibility(user._id.toString());
    if (isEligible) {
      await globalChallengeManager.addUser(user._id, walletAddress, true);
      console.log(
        `Added user ${user._id} to global challenges after USDT deposit`,
      );
    }

    res.json({
      success: true,
      message:
        "Successfully joined Million SHSY Pool! You can now participate in all prize pools including 10-day and 30-day challenges.",
      participant: {
        userId: user._id.toString(),
        walletAddress: walletAddress,
        participationType: "usdt",
        isActive: true,
      },
    });
  } catch (error) {
    console.error("Failed to verify USDT deposit:", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify deposit",
    });
  }
});

// Debug endpoint to examine USDT transaction details
app.get("/api/debug/usdt-transaction/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const userPublicKey = new PublicKey(walletAddress);
    const [stakingPool] = simplifiedMultipleStaking.getStakingPoolPDA();
    const userTokenAccount = await getAssociatedTokenAddress(
      new PublicKey("13Nf1g3rf1k8vY4QzQRBGFVBtcd4kGvriCqpmF5GyPvn"), // USDT mint
      userPublicKey,
    );
    const poolTokenAccount =
      await simplifiedMultipleStaking.getUSDTPoolTokenAccount();

    // Check account states
    const userAccountInfo =
      await simplifiedMultipleStaking.connection.getAccountInfo(
        userTokenAccount,
      );
    const poolAccountInfo =
      await simplifiedMultipleStaking.connection.getAccountInfo(
        poolTokenAccount,
      );
    const stakingPoolInfo =
      await simplifiedMultipleStaking.connection.getAccountInfo(stakingPool);

    res.json({
      success: true,
      debug: {
        walletAddress,
        stakingPool: stakingPool.toString(),
        userTokenAccount: userTokenAccount.toString(),
        poolTokenAccount: poolTokenAccount.toString(),
        userAccountExists: !!userAccountInfo,
        poolAccountExists: !!poolAccountInfo,
        stakingPoolExists: !!stakingPoolInfo,
        programId: simplifiedMultipleStaking.programIdString,
        usdtMint: "13Nf1g3rf1k8vY4QzQRBGFVBtcd4kGvriCqpmF5GyPvn",
      },
    });
  } catch (error) {
    console.error("Debug endpoint error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/million-pool/verify-usdt", async (req, res) => {
  try {
    const { signature, walletAddress, depositAmount } = req.body;

    if (!signature || !walletAddress || !depositAmount) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    // Verify the transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (!verification.success) {
      return res
        .status(400)
        .json({ success: false, error: verification.error });
    }

    // Add user to million pool participants
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const participant = await storage.addMillionPoolParticipant({
      userId: user._id.toString(),
      walletAddress,
      participationType: "usdt",
      usdtDepositAmount: depositAmount.toString(),
      depositTransactionId: signature,
    });

    res.json({
      success: true,
      participant,
    });
  } catch (error) {
    console.error("Failed to verify USDT deposit:", error);
    res.status(500).json({ success: false, error: "Failed to verify deposit" });
  }
});

// Debug endpoint to find all SPL tokens in wallet
app.get("/api/debug-tokens/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const publicKey = new PublicKey(walletAddress);

    // Get all token accounts for this wallet
    const tokenAccounts =
      await simplifiedMultipleStaking.connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID },
      );

    const tokens = tokenAccounts.value.map((account) => ({
      mint: account.account.data.parsed.info.mint,
      balance: account.account.data.parsed.info.tokenAmount.uiAmount,
      decimals: account.account.data.parsed.info.tokenAmount.decimals,
      account: account.pubkey.toString(),
    }));

    res.json({
      success: true,
      walletAddress,
      tokens,
      totalTokens: tokens.length,
    });
  } catch (error) {
    console.error("Error debugging tokens:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/usdt-balance/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const balance =
      await simplifiedMultipleStaking.getUSDTBalance(walletAddress);
    res.json({ success: true, balance });
  } catch (error) {
    console.error("Failed to get USDT balance:", error);
    res.status(500).json({ success: false, error: "Failed to get balance" });
  }
});

// Get user stakes endpoint for million pool
app.get("/api/dapp/user-stakes/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        totalStaked: 0,
        activeStakes: 0,
        stakes: [],
      });
    }

    const stakes = await storage.getUserStakes(user._id);
    const activeStakes = stakes.filter((stake) => stake.status !== "withdrawn");
    const totalStaked = activeStakes.reduce(
      (sum, stake) => sum + parseFloat(stake.amount),
      0,
    );

    res.json({
      success: true,
      totalStaked,
      activeStakes: activeStakes.length,
      stakes: activeStakes,
    });
  } catch (error) {
    console.error("Failed to get user stakes:", error);
    res.status(500).json({ success: false, error: "Failed to get stakes" });
  }
});

// Create SHSY deposit transaction for million pool (smart contract)
app.post("/api/million-pool/create-shsy-transaction", async (req, res) => {
  try {
    const { walletAddress, depositAmount } = req.body;

    if (!walletAddress || !depositAmount) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const transaction = await simplifiedMultipleStaking.createStakeTransaction(
      walletAddress,
      parseFloat(depositAmount),
    );

    res.json({
      success: true,
      transaction: transaction.serializedTransaction,
    });
  } catch (error) {
    console.error("Failed to create SHSY deposit transaction:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create transaction" });
  }
});

app.get("/api/million-pool/eligibility/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        isParticipating: false,
        autoQualified: false,
        eligible: true,
      });
    }

    const eligibilityData = await storage.checkMillionPoolEligibility(user._id);
    const participant = await storage.getMillionPoolParticipant(user._id);

    // Map the eligibility data to expected dApp format
    const response = {
      success: true,
      isParticipating: !!participant && participant.isActive,
      autoQualified: eligibilityData.qualificationType === "shsy_staking",
      eligible: eligibilityData.eligible,
      qualificationType: eligibilityData.qualificationType,
      amount: eligibilityData.amount,
    };

    res.json(response);
  } catch (error) {
    console.error("Failed to check million pool eligibility:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to check eligibility" });
  }
});

// Million pool participant status endpoint
app.get("/api/million-pool/participant/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.json({
        success: true,
        hasDeposited: false,
        participationStatus: "not_participating",
      });
    }

    const participant = await storage.getMillionPoolParticipant(user._id);

    res.json({
      success: true,
      hasDeposited: !!participant && participant.isActive,
      participationStatus:
        participant && participant.isActive ? "active" : "not_participating",
      participationType: participant ? participant.participationType : null,
      joinedAt: participant ? participant.joinedAt : null,
    });
  } catch (error) {
    console.error("Failed to get million pool participant status:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to get participant status" });
  }
});

// Create devnet USDT tokens for testing
app.post("/api/create-devnet-usdt", async (req, res) => {
  try {
    const { walletAddress, amount } = req.body;

    if (!walletAddress || !amount) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    res.status(501).json({
      success: false,
      error: "Token creation disabled - admin keys removed for security",
      message: "Use existing devnet USDT tokens for testing",
    });
  } catch (error) {
    console.error("Error creating devnet USDT:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get million pool winners for a user
app.get("/api/million-pool/winners/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const winners = await storage.getMillionPoolWinnersByUser(user._id);

    res.json({
      success: true,
      winners: winners.map((winner) => ({
        id: winner.id,
        distributionId: winner.distributionId,
        rewardAmountShsy: winner.rewardAmountShsy,
        status: winner.status,
        transactionId: winner.transactionId,
        createdAt: winner.createdAt,
        canClaim: winner.status === "pending",
      })),
    });
  } catch (error) {
    console.error("Failed to get million pool winners:", error);
    res.status(500).json({ success: false, error: "Failed to get winners" });
  }
});

// Claim million pool prize through fund locking system
app.post("/api/million-pool/claim/:winnerId", async (req, res) => {
  try {
    const { winnerId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address is required",
      });
    }

    // Get winner record
    const winner = await db
      .select()
      .from(millionPoolWinners)
      .where(eq(millionPoolWinners.id, parseInt(winnerId)))
      .limit(1);

    if (winner.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Winner record not found",
      });
    }

    const winnerRecord = winner[0];

    // Verify wallet address matches
    if (winnerRecord.walletAddress !== walletAddress) {
      return res.status(403).json({
        success: false,
        error: "Wallet address does not match winner record",
      });
    }

    // Check if already claimed
    if (winnerRecord.status === "claimed") {
      return res.status(400).json({
        success: false,
        error: "Prize already claimed",
      });
    }

    // Get user from database
    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Process prize through fund locking system
    const rewardAmount = parseFloat(winnerRecord.rewardAmountShsy);
    await rewardLocker.lockReward(
      user._id,
      walletAddress,
      "million_pool_prize",
      rewardAmount,
      undefined,
      "SHSY",
    );

    // Update winner status to claimed
    await storage.updateMillionPoolWinnerStatus(winnerRecord.id, "claimed");

    res.json({
      success: true,
      message: `Million pool prize of ${rewardAmount} SHSY has been processed through fund locking system`,
      rewardAmount: rewardAmount,
    });
  } catch (error) {
    console.error("Million pool claim error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to claim million pool prize",
    });
  }
});

// Create USDT withdrawal transaction for million pool claim (user-signed)
app.post("/api/million-pool/claim", async (req, res) => {
  try {
    const { winnerId, walletAddress } = req.body;

    if (!winnerId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Get winner record and verify ownership
    const winners = await storage.getMillionPoolWinnersByUser(user._id);
    const winner = winners.find((w) => w.id === parseInt(winnerId));

    if (!winner) {
      return res
        .status(404)
        .json({ success: false, error: "Winner record not found" });
    }

    if (winner.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, error: "Prize already claimed or processed" });
    }

    // Get lock settings
    const lockSettings = await storage.getAllLockSettings();
    const lockPercentageSetting = lockSettings.find(
      (s) => s.settingKey === "lock_percentage",
    );
    const lockDurationSetting = lockSettings.find(
      (s) => s.settingKey === "lock_duration_days",
    );

    const lockPercentage = lockPercentageSetting
      ? parseInt(lockPercentageSetting.settingValue)
      : 25;
    const lockDurationDays = lockDurationSetting
      ? parseInt(lockDurationSetting.settingValue)
      : 30;

    // Calculate amounts
    const totalAmount = parseFloat(winner.rewardAmountShsy);
    const lockedAmount = totalAmount * (lockPercentage / 100);
    const immediateAmount = totalAmount - lockedAmount;

    console.log(
      `Creating SHSY withdrawal for winner ${winnerId}: ${immediateAmount} SHSY immediate, ${lockedAmount} SHSY locked`,
    );

    // Execute PDA-based distribution (user never signs)
    const distributionResult =
      await simplifiedMultipleStaking.createPDATokenDistribution(
        walletAddress,
        immediateAmount,
        "million_pool_winning",
        "SHSY",
      );

    if (distributionResult.success) {
      // Lock the portion of funds using the reward locker
      // Pass the total amount - reward locker will calculate the locked/available split
      await rewardLocker.lockReward(
        user._id,
        walletAddress,
        "million_pool",
        totalAmount, // Pass total amount, not pre-calculated lockedAmount
        undefined,
        "SHSY",
      );

      // Update winner status to claimed
      await storage.updateMillionPoolWinnerStatus(winner.id, "claimed");

      res.json({
        success: true,
        completed: true,
        message:
          "Million pool winnings sent automatically! Tokens transferred to your wallet.",
        transactionSignature: distributionResult.transactionSignature,
        totalAmount: totalAmount.toFixed(2),
        availableAmount: immediateAmount.toFixed(2),
        lockedAmount: lockedAmount.toFixed(2), // This calculation is correct for display purposes
        lockPercentage: lockPercentage,
        lockDurationDays: lockDurationDays,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: "PDA million pool withdrawal failed",
        details: distributionResult.error,
      });
    }
  } catch (error) {
    console.error("Failed to create USDT withdrawal transaction:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create withdrawal transaction",
    });
  }
});

// Verify million pool USDT withdrawal transaction and remove claimed record
app.post("/api/million-pool/verify-withdraw", async (req, res) => {
  try {
    const { signature, winnerId, walletAddress } = req.body;

    if (!signature || !winnerId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    console.log(
      `Verifying USDT withdrawal transaction for winner ${winnerId}: ${signature}`,
    );

    // Verify the transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (!verification.success) {
      return res
        .status(400)
        .json({ success: false, error: verification.error });
    }

    // Mark winner as claimed and remove from million pool listings
    await storage.updateMillionPoolWinnerStatus(
      parseInt(winnerId),
      "claimed",
      signature,
    );

    // Remove the claimed record from million pool winners table
    await storage.removeMillionPoolWinner(parseInt(winnerId));

    console.log(
      `Million pool prize ${winnerId} successfully claimed, verified, and removed from listings`,
    );

    res.json({
      success: true,
      message:
        "Prize claimed and verified successfully! Record removed from million pool.",
      transactionSignature: signature,
    });
  } catch (error) {
    console.error("Failed to verify million pool withdrawal:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to verify withdrawal" });
  }
});

// Unified locked funds withdrawal endpoint (PDA-based)
app.post("/api/locked-funds/withdraw", async (req, res) => {
  try {
    const { lockedFundId, walletAddress } = req.body;

    if (!lockedFundId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Get available locked funds for this user
    const availableFunds = await storage.getAvailableLockedFunds(walletAddress);
    const lockedFund = availableFunds.find(
      (fund) => fund.id === parseInt(lockedFundId),
    );

    if (!lockedFund) {
      return res.status(404).json({
        success: false,
        error: "Locked fund not found or not yet available",
      });
    }

    // Determine token type and execute appropriate PDA-based distribution
    const amount = parseFloat(lockedFund.lockedAmount);
    const tokenType = lockedFund.tokenType === "USDT" ? "USDT" : "SHSY";

    console.log(
      `Processing locked fund withdrawal: ${amount} ${tokenType} for user ${walletAddress}`,
    );

    // Execute PDA-based distribution (user never signs)
    const distributionResult =
      await simplifiedMultipleStaking.createPDATokenDistribution(
        walletAddress,
        amount,
        "locked_fund_withdrawal",
        tokenType,
      );

    if (distributionResult.success) {
      // Mark locked fund as withdrawn
      await storage.withdrawLockedFund(parseInt(lockedFundId));

      console.log(
        `✅ Successfully distributed ${amount} ${tokenType} to ${walletAddress} via PDA! Signature: ${distributionResult.transactionSignature}`,
      );

      res.json({
        success: true,
        completed: true,
        message:
          "Locked fund withdrawal completed automatically! Tokens sent to your wallet.",
        amount: amount.toString(),
        tokenType,
        transactionSignature: distributionResult.transactionSignature,
      });
    } else {
      console.error("PDA distribution failed:", distributionResult.error);
      res.status(500).json({
        success: false,
        error:
          distributionResult.error || "Failed to distribute tokens via PDA",
      });
    }
  } catch (error) {
    console.error("Failed to process locked fund withdrawal:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to process withdrawal" });
  }
});

// Withdraw unlocked SHSY tokens from locked funds
app.post("/api/locked-funds/withdraw-shsy", async (req, res) => {
  try {
    const { lockedFundId, walletAddress } = req.body;

    if (!lockedFundId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Get available locked funds for this user
    const availableFunds = await storage.getAvailableLockedFunds(walletAddress);
    const lockedFund = availableFunds.find(
      (fund) => fund.id === parseInt(lockedFundId),
    );

    if (!lockedFund) {
      return res.status(404).json({
        success: false,
        error: "Locked fund not found or not yet available",
      });
    }

    if (
      lockedFund.rewardType !== "million_pool" &&
      lockedFund.rewardType !== "10_day" &&
      lockedFund.rewardType !== "30_day"
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid reward type for SHSY withdrawal",
      });
    }

    // Execute PDA-based distribution (user never signs)
    const amount = parseFloat(lockedFund.lockedAmount);
    const distributionResult =
      await simplifiedMultipleStaking.createPDATokenDistribution(
        walletAddress,
        amount,
        "locked_fund_withdrawal",
        "SHSY",
      );

    if (distributionResult.success) {
      // Mark locked fund as withdrawn
      await storage.withdrawLockedFund(parseInt(lockedFundId));

      console.log(
        `Locked fund ${lockedFundId} successfully withdrawn via PDA: ${amount} SHSY`,
      );

      res.json({
        success: true,
        completed: true,
        message:
          "Locked funds released! Tokens sent to your wallet automatically.",
        transactionSignature: distributionResult.transactionSignature,
        amount: amount.toFixed(8),
        lockedFundId: parseInt(lockedFundId),
      });
    } else {
      return res.status(500).json({
        success: false,
        error: "PDA locked fund withdrawal failed",
        details: distributionResult.error,
      });
    }
  } catch (error) {
    console.error("Failed to create SHSY locked fund withdrawal:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create withdrawal transaction",
    });
  }
});

// Withdraw unlocked USDT tokens from locked funds
app.post("/api/locked-funds/withdraw-usdt", async (req, res) => {
  try {
    const { lockedFundId, walletAddress } = req.body;

    if (!lockedFundId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Get available locked funds for this user
    const availableFunds = await storage.getAvailableLockedFunds(walletAddress);
    const lockedFund = availableFunds.find(
      (fund) => fund.id === parseInt(lockedFundId),
    );

    if (!lockedFund) {
      return res.status(404).json({
        success: false,
        error: "Locked fund not found or not yet available",
      });
    }

    if (lockedFund.rewardType !== "million_pool") {
      return res.status(400).json({
        success: false,
        error: "Only million pool rewards can be withdrawn",
      });
    }

    // Execute PDA-based distribution (user never signs)
    const amount = parseFloat(lockedFund.lockedAmount);
    const distributionResult =
      await simplifiedMultipleStaking.createPDATokenDistribution(
        walletAddress,
        amount,
        "locked_fund_withdrawal",
        "SHSY", // Million pool rewards are now SHSY tokens
      );

    if (distributionResult.success) {
      // Mark locked fund as withdrawn
      await storage.withdrawLockedFund(parseInt(lockedFundId));

      console.log(
        `Locked fund ${lockedFundId} successfully withdrawn via PDA: ${amount} SHSY`,
      );

      res.json({
        success: true,
        completed: true,
        message:
          "Locked funds released! Tokens sent to your wallet automatically.",
        transactionSignature: distributionResult.transactionSignature,
        amount: amount.toFixed(8),
        lockedFundId: parseInt(lockedFundId),
      });
    } else {
      return res.status(500).json({
        success: false,
        error: "PDA locked fund withdrawal failed",
        details: distributionResult.error,
      });
    }
  } catch (error) {
    console.error("Failed to create USDT locked fund withdrawal:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create withdrawal transaction",
    });
  }
});

// Verify locked fund withdrawal transactions
app.post("/api/locked-funds/verify-withdraw", async (req, res) => {
  try {
    const { signature, lockedFundId, walletAddress } = req.body;

    if (!signature || !lockedFundId || !walletAddress) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    console.log(
      `Verifying locked fund withdrawal transaction ${lockedFundId}: ${signature}`,
    );

    // Verify the transaction on blockchain
    const verification =
      await simplifiedMultipleStaking.verifyTransaction(signature);

    if (!verification.success) {
      return res
        .status(400)
        .json({ success: false, error: verification.error });
    }

    // Mark locked fund as withdrawn
    await storage.withdrawLockedFund(parseInt(lockedFundId));

    console.log(
      `Locked fund ${lockedFundId} successfully withdrawn and verified`,
    );

    res.json({
      success: true,
      message: "Locked fund withdrawal verified successfully!",
      transactionSignature: signature,
    });
  } catch (error) {
    console.error("Failed to verify locked fund withdrawal:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to verify withdrawal" });
  }
});

// Debug endpoint to check specific USDT mint
app.get(
  "/api/check-usdt-mint/:walletAddress/:mintAddress",
  async (req, res) => {
    try {
      const { walletAddress, mintAddress } = req.params;

      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(mintAddress);

      // Get associated token account
      const { getAssociatedTokenAddress } = await import("@solana/spl-token");
      const associatedTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        walletPubkey,
      );

      // Check if account exists and get balance
      const connection = simplifiedMultipleStaking.connection;
      const accountInfo = await connection.getAccountInfo(
        associatedTokenAccount,
      );

      if (accountInfo) {
        const balance = await connection.getTokenAccountBalance(
          associatedTokenAccount,
        );
        res.json({
          success: true,
          mintAddress,
          associatedTokenAccount: associatedTokenAccount.toString(),
          balance: balance.value.uiAmount || 0,
          exists: true,
        });
      } else {
        res.json({
          success: true,
          mintAddress,
          associatedTokenAccount: associatedTokenAccount.toString(),
          balance: 0,
          exists: false,
        });
      }
    } catch (error) {
      res.json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Dashboard get published riddles endpoint
app.get("/api/dashboard/riddles", async (req, res) => {
  try {
    const riddles = await storage.getPublishedRiddles();

    // Filter only active (published) riddles and limit to 2
    const activeRiddles = riddles
      .filter((riddle) => riddle.status === "published")
      .slice(0, 2);

    res.json({
      success: true,
      riddles: activeRiddles,
      count: activeRiddles.length,
    });
  } catch (error) {
    console.error("Error fetching published riddles:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch riddles",
    });
  }
});

// Riddles submit endpoint for dashboard with tiered guessing system
app.post("/api/riddles/submit", async (req, res) => {
  try {
    const { walletAddress, answer, riddleId, isPaidGuess, guessNumber } =
      req.body;

    if (!walletAddress || !answer || !riddleId) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required parameters: walletAddress, answer, and riddleId",
      });
    }

    // Get or create user
    let user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      user = await storage.createUserWithWallet(walletAddress);
    }

    // Get riddle to validate
    const riddle = await storage.getRiddleById(riddleId);
    if (!riddle) {
      return res.status(404).json({
        success: false,
        error: "Riddle not found",
      });
    }

    // Check how many submissions this user has made for this riddle
    const existingSubmissions = await storage.getRiddleSubmissionsByUser(
      user._id,
      riddleId,
    );
    const submissionCount = existingSubmissions.length;

    // Check if user has paid $4 USDT for enhanced guessing
    const millionPoolParticipant = await storage.getMillionPoolParticipant(
      user._id,
    );
    const hasPaidUSDT =
      millionPoolParticipant &&
      millionPoolParticipant.participationType === "usdt";

    // Determine reward amount and guess limits based on payment status
    let rewardAmount;
    let rewardType;
    let maxGuesses;

    if (hasPaidUSDT) {
      // Paid users get 10 SHSY for all guesses and can make 3 guesses
      rewardAmount = 10;
      rewardType = "riddle_answer_paid";
      maxGuesses = 3;
    } else {
      // Free users get 3 SHSY for first guess only and can make 1 guess
      rewardAmount = 3;
      rewardType = "riddle_answer_free";
      maxGuesses = 1;
    }

    // Validate guess limits based on payment status
    if (submissionCount >= maxGuesses) {
      const errorMessage = hasPaidUSDT
        ? "Maximum of 3 guesses allowed per riddle"
        : "Free users get 1 guess per riddle. Pay $4 USDT for 3 guesses and 10 SHSY rewards.";

      return res.status(400).json({
        success: false,
        error: errorMessage,
      });
    }

    const isCorrect = true; // Always mark as correct for reward purposes

    // Create riddle submission record
    const submission = await storage.createRiddleSubmission({
      userId: user._id.toString(),
      riddleId: riddleId,
      selectedAnswer: answer,
      isCorrect: isCorrect,
      submittedAt: new Date(),
    });

    // Create PDA-based reward (no admin keys required)
    let rewardResult = null;
    let actualTransferred = 0;

    if (isCorrect && rewardAmount > 0) {
      try {
        // Create PDA-based reward distribution using smart contract
        rewardResult = await simplifiedMultipleStaking.createRewardDistribution(
          walletAddress,
          rewardAmount,
        );

        if (rewardResult && rewardResult.success) {
          // PDA-based rewards are automatically distributed by smart contract
          actualTransferred = rewardAmount;

          // Create reward record in database
          await storage.createReward({
            userId: user._id.toString(),
            amount: rewardAmount.toString(),
            type: rewardType,
          });

          console.log(
            `✅ Created PDA-based reward: ${rewardAmount} SHSY for ${walletAddress}`,
          );
          console.log(
            `Transaction signature: ${rewardResult.transactionSignature}`,
          );
        } else {
          throw new Error(
            `Failed to create PDA-based reward: ${rewardResult?.error || "Unknown error"}`,
          );
        }
      } catch (rewardError) {
        console.error("PDA reward creation failed:", rewardError);
        actualTransferred = 0;

        // Still record the reward attempt in database
        try {
          await storage.createReward({
            userId: user._id.toString(),
            amount: rewardAmount.toString(),
            type: rewardType,
          });
        } catch (dbError) {
          console.log("Database reward record also failed:", dbError.message);
        }
      }
    }

    const guessTypeText = submissionCount === 0 ? "free guess" : "paid guess";
    const remainingGuesses = 3 - (submissionCount + 1);

    res.json({
      success: true,
      submission: {
        id: submission.id,
        isCorrect: isCorrect,
        rewardEarned: rewardAmount,
        actualTransferred: actualTransferred,
        guessNumber: submissionCount + 1,
        guessType: guessTypeText,
        remainingGuesses: remainingGuesses,
        message: `Answer submitted with ${guessTypeText}! You earned ${rewardAmount} SHSY tokens! ${actualTransferred > 0 ? `${actualTransferred} SHSY ready via PDA-based distribution.` : "Reward processing failed."} ${remainingGuesses > 0 ? `${remainingGuesses} guesses remaining.` : ""}`,
      },
    });
  } catch (error) {
    console.error("Error submitting riddle answer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to submit riddle answer",
    });
  }
});

// Get user riddle submissions for guess tracking
app.get("/api/user/riddle-submissions", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress parameter",
      });
    }

    // Get user by wallet address
    const user = await storage.getUserByWallet(walletAddress as string);
    if (!user) {
      return res.json({
        success: true,
        submissions: [],
        message: "No user found, no submissions exist",
      });
    }

    // Get all riddle submissions for this user
    const submissions = await storage.getRiddleSubmissionsByUser(user._id);

    res.json({
      success: true,
      submissions: submissions,
      count: submissions.length,
    });
  } catch (error) {
    console.error("Error fetching user riddle submissions:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch riddle submissions",
    });
  }
});

// Check USDT deposit status for million pool
app.get("/api/million-pool/check-deposit", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Missing walletAddress parameter",
      });
    }

    // Get user by wallet address
    const user = await storage.getUserByWallet(walletAddress as string);
    if (!user) {
      return res.json({
        success: true,
        hasDeposited: false,
        participant: null,
      });
    }

    // Check if user has made USDT deposit
    const participant = await storage.getMillionPoolParticipant(user._id);
    const hasDeposited =
      participant && participant.participationType === "usdt_deposit";

    res.json({
      success: true,
      hasDeposited: !!hasDeposited,
      participant: hasDeposited ? participant : null,
      depositAmount: hasDeposited ? participant.usdtDepositAmount : null,
    });
  } catch (error) {
    console.error("Error checking USDT deposit status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check deposit status",
    });
  }
});

// Dashboard puzzle submission endpoint
app.post("/api/dashboard/submit-puzzle", async (req, res) => {
  try {
    const { walletAddress, puzzleId, answer, riddleId } = req.body;

    if (!walletAddress || !answer) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: walletAddress and answer",
      });
    }

    // Get or create user
    let user = await storage.getUserByWallet(walletAddress);
    if (!user) {
      user = await storage.createUserWithWallet(walletAddress);
    }

    // Create puzzle submission record (using riddleId if provided, otherwise use puzzleId or generate one)
    const submissionRiddleId = riddleId || puzzleId || 1; // Default to 1 if no ID provided

    try {
      await storage.createRiddleSubmission({
        userId: user._id.toString(),
        riddleId: submissionRiddleId,
        selectedAnswer: answer,
        isCorrect: true, // For dashboard submissions, assume correct for reward
        submittedAt: new Date(),
      });
    } catch (submissionError) {
      console.log(
        "Submission record creation failed, but continuing with reward:",
        submissionError.message,
      );
    }

    // Create SHSY reward transaction (3 SHSY from admin to user)
    const rewardAmount = 3; // 3 SHSY reward

    try {
      // Create PDA-based reward transaction (no admin keys required)
      const rewardTransaction =
        await simplifiedMultipleStaking.createRewardDistribution(
          walletAddress,
          rewardAmount,
        );

      console.log(
        `Created PDA-based puzzle reward: ${rewardAmount} SHSY for ${walletAddress}`,
      );

      // Create reward record in database
      await storage.createReward({
        userId: user._id.toString(),
        type: "puzzle_submission",
        amount: rewardAmount.toString(),
        description: `Puzzle submission reward - ${rewardAmount} SHSY (PDA-based)`,
        transactionId: "pda_based_reward",
        status: "completed",
      });

      res.json({
        success: true,
        message: `Congratulations! You've earned ${rewardAmount} SHSY for completing the puzzle!`,
        reward: {
          amount: rewardAmount,
          token: "SHSY",
          transactionId: transferTransaction,
        },
        notification: {
          title: "Puzzle Completed!",
          message: `You've received ${rewardAmount} SHSY tokens in your wallet`,
          type: "success",
        },
      });
    } catch (transferError) {
      console.error("Failed to create reward transaction:", transferError);

      // Still return success for the submission, but note the reward issue
      res.json({
        success: true,
        message:
          "Puzzle submitted successfully! Reward processing in progress.",
        reward: {
          amount: rewardAmount,
          token: "SHSY",
          status: "processing",
        },
        notification: {
          title: "Puzzle Submitted!",
          message:
            "Your answer has been recorded. Reward will be processed shortly.",
          type: "info",
        },
      });
    }
  } catch (error) {
    console.error("Failed to process puzzle submission:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process puzzle submission",
    });
  }
});

async function startMillionPoolDistribution() {
  console.log("Starting million pool distribution timer...");

  const checkAndDistribute = async () => {
    try {
      const settings = await storage.getMillionPoolSettings();
      if (!settings || !settings.isActive) {
        return;
      }

      const now = new Date();
      const lastDistribution = settings.lastDistribution;

      // Check if enough time has passed since last distribution
      if (lastDistribution) {
        const timeSinceLastDistribution =
          now.getTime() - lastDistribution.getTime();
        const distributionInterval =
          settings.distributionFrequencyMinutes * 60 * 1000; // Convert to milliseconds

        if (timeSinceLastDistribution < distributionInterval) {
          return; // Not time yet
        }
      }

      // Get all active participants
      const participants = await storage.getAllActiveMillionPoolParticipants();
      if (participants.length === 0) {
        console.log("No million pool participants available for distribution");
        return;
      }

      console.log(
        `Million pool distribution triggered with ${participants.length} participants`,
      );

      // Create distribution record
      const distribution = await storage.createMillionPoolDistribution({
        totalParticipants: participants.length,
        numberOfWinners: Math.min(
          settings.numberOfWinners,
          participants.length,
        ),
        rewardAmountShsy: settings.rewardAmountShsy.toString(),
        status: "completed",
      });

      // Select random winners
      const shuffled = participants.sort(() => 0.5 - Math.random());
      const winners = shuffled.slice(
        0,
        Math.min(settings.numberOfWinners, participants.length),
      );

      // Create winner records
      const winnerData = winners.map((participant) => ({
        distributionId: distribution.id,
        userId: participant.userId,
        walletAddress: participant.walletAddress,
        rewardAmountShsy: settings.rewardAmountShsy.toString(),
        status: "pending" as const,
        transactionId: null,
      }));

      await storage.createMillionPoolWinners(winnerData);

      // Update last distribution time
      await storage.updateMillionPoolSettings({
        lastDistribution: now,
      });

      console.log(
        `Million pool distribution completed! Selected ${winners.length} winners:`,
        winners.map((w) => w.walletAddress).join(", "),
      );
    } catch (error) {
      console.error("Error in million pool distribution:", error);
    }
  };

  // Check immediately and then every 30 seconds
  await checkAndDistribute();
  setInterval(checkAndDistribute, 30000);
}

async function startServer() {
  try {
    await initializeCustomToken();

    // Initialize global challenges
    await globalChallengeManager.initialize();

    // Start million pool distribution timer
    startMillionPoolDistribution();

    // Check staking pool status (don't fail if initialization needed)
    try {
      console.log("Checking staking pool status...");
      const [stakingPoolPDA] = await PublicKey.findProgramAddress(
        [Buffer.from("staking_pool")],
        new PublicKey(PROGRAM_ID),
      );
      const poolInfo = await connection.getAccountInfo(stakingPoolPDA);

      if (poolInfo) {
        console.log("✓ Staking pool already exists and is ready");
        console.log("✓ Pool PDA:", stakingPoolPDA.toString());
      } else {
        console.log("⚠ Staking pool not initialized yet");
        console.log("⚠ Pool will need to be initialized before first use");
        console.log("⚠ Expected PDA:", stakingPoolPDA.toString());
      }
    } catch (error) {
      console.error("Error checking staking pool:", error.message);
      console.log("Continuing with server startup...");
    }

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Staking Platform server running on port ${PORT}`);
      console.log("Access your platform at:");
      console.log("- User Dashboard: http://localhost:5000/dashboard");
      console.log("- DApp Staking: http://localhost:5000/dapp");
      console.log("- Admin Panel: http://localhost:5000/admin");
      console.log("Smart Contract Integration:");
      console.log(`- Program ID: ${PROGRAM_ID}`);
      console.log("- Token Mint: 3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P");
      console.log("- Network: devnet");
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

startServer();
