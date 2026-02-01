/*
 * SHSY-RB-2025-Team1 - MongoDB Version
 */

import { MongoClient, Db } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017");

let db: Db;

// Connect once and reuse
export const connectDB = async () => {
  if (!db) {
    await client.connect();
    db = client.db(process.env.MONGODB_DB_NAME || "shsy");
    console.log("✅ Connected to MongoDB");
  }
  return db;
};

// For compatibility with your old "pool" variable
export const pool = client;

// Export db getter
export { db };
