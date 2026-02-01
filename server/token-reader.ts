/*
 * SHSY Token Reader Service - Read-only operations
 * No admin keys required - only public data access
 */

import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import {
  getMint,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

export class TokenReader {
  public connection: Connection;

  constructor() {
    // Force devnet endpoint
    const rpcUrl = 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    console.log(`Token Reader initialized - read-only mode`);
  }

  // Check SOL balance for any wallet
  async getSOLBalance(walletAddress: string): Promise<number> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(publicKey);
      const balanceSOL = balance / 1_000_000_000; // Convert from lamports to SOL
      return balanceSOL;
    } catch (error) {
      console.error('Error checking SOL balance:', error);
      return 0;
    }
  }

  // Get token info for any mint
  async getTokenInfo(mintAddress: string): Promise<{
    supply: number;
    decimals: number;
    mintAuthority: string | null;
    freezeAuthority: string | null;
  } | null> {
    try {
      const mintPublicKey = new PublicKey(mintAddress);
      const mintInfo = await getMint(this.connection, mintPublicKey);
      
      return {
        supply: Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals),
        decimals: mintInfo.decimals,
        mintAuthority: mintInfo.mintAuthority?.toString() || null,
        freezeAuthority: mintInfo.freezeAuthority?.toString() || null,
      };
    } catch (error) {
      console.error('Error getting token info:', error);
      return null;
    }
  }

  // Get token balance for any wallet and mint combination
  async getTokenBalance(walletAddress: string, mintAddress: string): Promise<number> {
    try {
      const walletPublicKey = new PublicKey(walletAddress);
      const mintPublicKey = new PublicKey(mintAddress);
      
      // Get the associated token account
      const tokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        walletPublicKey
      );
      
      // Check if the token account exists
      const accountInfo = await this.connection.getAccountInfo(tokenAccount);
      if (!accountInfo) {
        return 0; // Account doesn't exist, balance is 0
      }
      
      // Get the balance from the token account
      const tokenAccountInfo = await getAccount(this.connection, tokenAccount);
      const rawBalance = Number(tokenAccountInfo.amount);
      const balance = rawBalance / Math.pow(10, 6); // 6 decimals for SHSY
      
      return balance;
    } catch (error) {
      console.error('Error getting wallet token balance:', error);
      return 0;
    }
  }

  // Get USDT balance for any wallet
  async getUSDTBalance(walletAddress: string): Promise<number> {
    const usdtMintAddress = "13Nf1g3rf1k8vY4QzQRBGFVBtcd4kGvriCqpmF5GyPvn"; // Devnet USDT
    return await this.getTokenBalance(walletAddress, usdtMintAddress);
  }

  // Get SHSY balance for any wallet  
  async getSHSYBalance(walletAddress: string): Promise<number> {
    const shsyMintAddress = "3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P"; // SHSY token
    return await this.getTokenBalance(walletAddress, shsyMintAddress);
  }
}

export const tokenReader = new TokenReader();