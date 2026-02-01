/*
 * SHSY-RB-2025-Team1
 */

import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "./storage";

// Simple global challenge system - just 2 challenges that all users join
export class SimpleGlobalChallenges {
  private static instance: SimpleGlobalChallenges;
  private challenge10Day: any = null;
  private challenge30Day: any = null;
  private participants: Map<string, Set<number>> = new Map(); // challengeType -> Set of userIds
  private pendingRewards: Map<
    number,
    Array<{ challengeType: string; rewardAmount: string; wonAt: Date }>
  > = new Map(); // userId -> pending rewards

  static getInstance(): SimpleGlobalChallenges {
    if (!SimpleGlobalChallenges.instance) {
      SimpleGlobalChallenges.instance = new SimpleGlobalChallenges();
    }
    return SimpleGlobalChallenges.instance;
  }

  // Reload challenge settings from database
  async reloadChallengeSettings() {
    const reward10Setting = await storage.getRewardSetting("participation_10d");
    const reward30Setting = await storage.getRewardSetting("participation_30d");

    if (reward10Setting && this.challenge10Day) {
      this.challenge10Day.rewardAmount = parseFloat(
        reward10Setting.settingValue,
      ).toFixed(8);
    }
    if (reward30Setting && this.challenge30Day) {
      this.challenge30Day.rewardAmount = parseFloat(
        reward30Setting.settingValue,
      ).toFixed(8);
    }
  }

  async initialize() {
    console.log("Initializing simple global challenges...");

    // Load reward amounts from database
    const reward10Setting = await storage.getRewardSetting("participation_10d");
    const reward30Setting = await storage.getRewardSetting("participation_30d");

    const reward10Amount = reward10Setting
      ? reward10Setting.settingValue
      : "20";
    const reward30Amount = reward30Setting
      ? reward30Setting.settingValue
      : "45";

    // Start the 10-day challenge (actual 10 days)
    this.challenge10Day = {
      id: 1,
      type: "10_day",
      startTime: new Date(),
      duration:  10 * 24 * 60 * 60 * 1000, // 10 days in milliseconds (Production)
      rewardAmount: parseFloat(reward10Amount).toFixed(8),
      status: "active",
    };

    // Start the 30-day challenge (actual 30 days)
    this.challenge30Day = {
      id: 2,
      type: "30_day",
      startTime: new Date(),
      duration:  30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds (Production)
      rewardAmount: parseFloat(reward30Amount).toFixed(8),
      status: "active",
    };

    this.participants.set("10_day", new Set());
    this.participants.set("30_day", new Set());

    console.log("Simple global challenges initialized");

    // Start the completion check timer
    this.startCompletionTimer();
  }

  // Add user to both challenges if eligible
  async addUser(userId: number, walletAddress: string, isEligible: boolean) {
    if (!this.challenge10Day || !this.challenge30Day) {
      await this.initialize();
    }

    if (isEligible) {
      // Add to both challenges only if eligible
      this.participants.get("10_day")?.add(userId);
      this.participants.get("30_day")?.add(userId);

      console.log(`Added user ${userId} to both global challenges`);
    } else {
      // Remove from challenges if not eligible
      this.participants.get("10_day")?.delete(userId);
      this.participants.get("30_day")?.delete(userId);

      console.log(`Removed user ${userId} from global challenges`);
    }
  }

  // Get current status of both challenges including pending rewards
  getStatus(userId?: number) {
    const now = new Date();
    const challenges: any[] = [];
    const pendingRewards = userId ? this.pendingRewards.get(userId) || [] : [];

    // 10-day challenge status
    if (this.challenge10Day) {
      const elapsed = now.getTime() - this.challenge10Day.startTime.getTime();
      const elapsedMinutes = Math.floor(elapsed /  (14400 * 1000));
      const isCompleted = elapsed >= this.challenge10Day.duration;
      const participantCount = this.participants.get("10_day")?.size || 0;
      const isParticipating = userId
        ? this.participants.get("10_day")?.has(userId)
        : false;

      challenges.push({
        id: this.challenge10Day.id,
        challengeType: "10_day",
        startedAt: this.challenge10Day.startTime,
        targetMinutes: 14400,
        rewardAmount: this.challenge10Day.rewardAmount,
        status: this.challenge10Day.status,
        progress: {
          elapsedMinutes,
          targetMinutes: 14400,
          progressPercentage: Math.min(
            (elapsedMinutes / 14400) * 100,
            100,
          ),
          isCompleted,
          canClaim: false,
        },
        participantCount,
        isParticipating,
      });
    }

    // 30-day challenge status
    if (this.challenge30Day) {
      const elapsed = now.getTime() - this.challenge30Day.startTime.getTime();
      const elapsedMinutes = Math.floor(elapsed / (43200 * 1000));
      const isCompleted = elapsed >= this.challenge30Day.duration;
      const participantCount = this.participants.get("30_day")?.size || 0;
      const isParticipating = userId
        ? this.participants.get("30_day")?.has(userId)
        : false;

      challenges.push({
        id: this.challenge30Day.id,
        challengeType: "30_day",
        startedAt: this.challenge30Day.startTime,
        targetMinutes: 43200,
        rewardAmount: this.challenge30Day.rewardAmount,
        status: this.challenge30Day.status,
        progress: {
          elapsedMinutes,
          targetMinutes: 43200,
          progressPercentage: Math.min(
            (elapsedMinutes / 43200) * 100,
            100,
          ),
          isCompleted,
          canClaim: false,
        },
        participantCount,
        isParticipating,
      });
    }

    return {
      challenges,
      pendingRewards,
    };
  }

  // Check for completed challenges and restart them
  private startCompletionTimer() {
    setInterval(() => {
      this.checkAndProcessCompletedChallenges();
    }, 30000); // Check every 30 seconds
  }

  private async checkAndProcessCompletedChallenges() {
    const now = new Date();

    // Check 10-day challenge
    if (this.challenge10Day && this.challenge10Day.status === "active") {
      const elapsed = now.getTime() - this.challenge10Day.startTime.getTime();
      if (elapsed >= this.challenge10Day.duration) {
        await this.processCompletedChallenge("10_day");
      }
    }

    // Check 30-day challenge
    if (this.challenge30Day && this.challenge30Day.status === "active") {
      const elapsed = now.getTime() - this.challenge30Day.startTime.getTime();
      if (elapsed >= this.challenge30Day.duration) {
        await this.processCompletedChallenge("30_day");
      }
    }
  }

  private async processCompletedChallenge(challengeType: "10_day" | "30_day") {
    const participants = Array.from(this.participants.get(challengeType) || []);
    console.log(
      `Processing completed ${challengeType} challenge with ${participants.length} participants`,
    );

    if (participants.length > 0) {
      // Select random winners (max 5)
      const winnerCount = Math.min(5, participants.length);
      const shuffled = [...participants].sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, winnerCount);

      console.log(
        `Selected ${winners.length} random winners for ${challengeType}: ${winners.join(", ")}`,
      );

      // Add rewards to winners' pending rewards - use current challenge reward amount
      const rewardAmount =
        challengeType === "10_day"
          ? this.challenge10Day.rewardAmount
          : this.challenge30Day.rewardAmount;
      winners.forEach((userId) => {
        if (!this.pendingRewards.has(userId)) {
          this.pendingRewards.set(userId, []);
        }
        this.pendingRewards.get(userId)!.push({
          challengeType,
          rewardAmount,
          wonAt: new Date(),
        });
      });
    }

    // Restart the challenge immediately with updated database values
    await this.reloadChallengeSettings();

    if (challengeType === "10_day") {
      this.challenge10Day = {
        id: this.challenge10Day.id + 1,
        type: "10_day",
        startTime: new Date(),
        duration:  10 * 24 * 60 * 60 * 1000, // 10 days
        rewardAmount: this.challenge10Day.rewardAmount, // Keep current reward amount
        status: "active",
      };
      // Keep existing participants in the new challenge
      console.log(
        `Restarted 10-day challenge with ${this.participants.get("10_day")?.size} existing participants`,
      );
    } else {
      this.challenge30Day = {
        id: this.challenge30Day.id + 1,
        type: "30_day",
        startTime: new Date(),
        duration:  30 * 24 * 60 * 60 * 1000, // 30 days
        rewardAmount: this.challenge30Day.rewardAmount, // Keep current reward amount
        status: "active",
      };
      // Keep existing participants in the new challenge
      console.log(
        `Restarted 30-day challenge with ${this.participants.get("30_day")?.size} existing participants`,
      );
    }
  }

  // Claim a specific reward
  claimReward(userId: number, challengeType: string): boolean {
    const userRewards = this.pendingRewards.get(userId);
    if (!userRewards) return false;

    const rewardIndex = userRewards.findIndex(
      (r) => r.challengeType === challengeType,
    );
    if (rewardIndex === -1) return false;

    // Remove the claimed reward
    userRewards.splice(rewardIndex, 1);

    // If no more rewards, remove the user entry
    if (userRewards.length === 0) {
      this.pendingRewards.delete(userId);
    }

    console.log(`User ${userId} claimed ${challengeType} reward`);
    return true;
  }

  // Get user's pending rewards
  getPendingRewards(userId: number) {
    return this.pendingRewards.get(userId) || [];
  }

  // Remove user from challenges (when they have no stakes/guesses)
  removeUser(userId: number) {
    this.participants.get("10_day")?.delete(userId);
    this.participants.get("30_day")?.delete(userId);
    console.log(`Removed user ${userId} from global challenges`);
  }
}

export const globalChallengeManager = SimpleGlobalChallenges.getInstance();
