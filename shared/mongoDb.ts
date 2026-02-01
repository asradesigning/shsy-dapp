// mongoDb.ts
import { connectDB } from "../server/db";
import { Db, Collection } from "mongodb";

// placeholders for collections
let db: Db;
let usersCollection: Collection;
let stakesCollection: Collection;
let rewardsCollection: Collection;
let settingsCollection: Collection;
let riddlesCollection: Collection;
let riddleSubmissionsCollection: Collection;
let rewardSettingsCollection: Collection;
let challengeParticipationsCollection: Collection;
let globalChallengesCollection: Collection;
let stakingChallengesCollection: Collection;
let lockedFundsCollection: Collection;
let lockSettingsCollection: Collection;
let millionPoolSettingsCollection: Collection;
let millionPoolParticipantsCollection: Collection;
let millionPoolDistributionsCollection: Collection;
let millionPoolWinnersCollection: Collection;

// async initializer
export const initMongo = async () => {
  db = await connectDB();

  usersCollection = db.collection("users");
  stakesCollection = db.collection("stakes");
  rewardsCollection = db.collection("rewards");
  settingsCollection = db.collection("settings");
  riddlesCollection = db.collection("riddlesWithOptions");
  riddleSubmissionsCollection = db.collection("riddleSubmissions");
  rewardSettingsCollection = db.collection("rewardSettings");
  challengeParticipationsCollection = db.collection("challengeParticipations");
  globalChallengesCollection = db.collection("globalChallengesCollection");
  stakingChallengesCollection = db.collection("stakingChallenges");
  lockedFundsCollection = db.collection("lockedFunds");
  lockSettingsCollection = db.collection("lockSettings");
  millionPoolSettingsCollection = db.collection("millionPoolSettings");
  millionPoolParticipantsCollection = db.collection("millionPoolParticipants");
  millionPoolDistributionsCollection = db.collection("millionPoolDistributions");
  millionPoolWinnersCollection = db.collection("millionPoolWinners");

  console.log("✅ MongoDB collections initialized");
};

// getters for safe access
export const getUsersCollection = () => usersCollection;
export const getStakesCollection = () => stakesCollection;
export const getRewardsCollection = () => rewardsCollection;
export const getSettingsCollection = () => settingsCollection;
export const getRiddlesCollection = () => riddlesCollection;
export const getRiddleSubmissionsCollection = () => riddleSubmissionsCollection;
export const getRewardSettingsCollection = () => rewardSettingsCollection;
export const getChallengeParticipationsCollection = () => challengeParticipationsCollection;
export const getGlobalChallengesCollection = () => globalChallengesCollection;
export const getStakingChallengesCollection = () => stakingChallengesCollection;
export const getLockedFundsCollection = () => lockedFundsCollection;
export const getLockSettingsCollection = () => lockSettingsCollection;
export const getMillionPoolSettingsCollection = () => millionPoolSettingsCollection;
export const getMillionPoolParticipantsCollection = () => millionPoolParticipantsCollection;
export const getMillionPoolDistributionsCollection = () => millionPoolDistributionsCollection;
export const getMillionPoolWinnersCollection = () => millionPoolWinnersCollection;
