/*
 * SHSY-RB-2025-Team1
 */

import { storage } from "./storage";
import type { LockedFund, InsertLockedFund } from "../shared/schema";

export class RewardLocker {
  // Calculate locked and available amounts based on admin settings
  async calculateRewardSplit(
    rewardType: string,
    totalAmount: number,
  ): Promise<{
    lockedAmount: number;
    availableAmount: number;
    lockPercentage: number;
    lockDays: number;
  }> {
    // Use simplified lock settings (same for all reward types)
    const percentageSetting = await storage.getLockSetting("lock_percentage");
    const daysSetting = await storage.getLockSetting("lock_days");

    const lockPercentage = percentageSetting
      ? parseInt(percentageSetting.settingValue)
      : 25;
    const lockDays = daysSetting ? parseInt(daysSetting.settingValue) : 30;

    const lockedAmount = (totalAmount * lockPercentage) / 100;
    const availableAmount = totalAmount - lockedAmount;

    return {
      lockedAmount,
      availableAmount,
      lockPercentage,
      lockDays,
    };
  }

  // Lock a portion of reward and return the available amount for immediate withdrawal
  async lockReward(
    userId: number,
    walletAddress: string,
    rewardType: string,
    totalRewardAmount: number,
    originalTransactionId?: string,
    tokenType: string = "SHSY",
  ): Promise<{
    lockedFund?: LockedFund;
    availableAmount: number;
    lockedAmount: number;
  }> {
    const split = await this.calculateRewardSplit(
      rewardType,
      totalRewardAmount,
    );

    // If no locking is configured, return full amount as available
    if (split.lockPercentage === 0 || split.lockedAmount === 0) {
      return {
        availableAmount: totalRewardAmount,
        lockedAmount: 0,
      };
    }

    // Calculate unlock date
    const unlocksAt = new Date();
    unlocksAt.setDate(unlocksAt.getDate() + split.lockDays);

    // Create locked fund record
    const lockedFundData: InsertLockedFund = {
      userId,
      walletAddress,
      rewardType,
      tokenType,
      totalRewardAmount: totalRewardAmount.toString(),
      lockedAmount: split.lockedAmount.toString(),
      availableAmount: split.availableAmount.toString(),
      lockPercentage: split.lockPercentage,
      lockDays: split.lockDays,
      unlocksAt,
      status: "locked",
      originalTransactionId,
    };

    const lockedFund = await storage.createLockedFund(lockedFundData);

    return {
      lockedFund,
      availableAmount: split.availableAmount,
      lockedAmount: split.lockedAmount,
    };
  }

  // Get all locked funds for a wallet that are ready to be unlocked
  async getUnlockableRewards(walletAddress: string): Promise<LockedFund[]> {
    return await storage.getAvailableLockedFunds(walletAddress);
  }

  // Get all locked funds for a wallet (both locked and unlocked)
  async getAllLockedFunds(walletAddress: string): Promise<LockedFund[]> {
    return await storage.getLockedFundsByWallet(walletAddress);
  }

  // Process unlocking of a specific locked fund
  async unlockReward(lockedFundId: number): Promise<LockedFund | undefined> {
    return await storage.withdrawLockedFund(lockedFundId);
  }
}

export const rewardLocker = new RewardLocker();
