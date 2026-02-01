#!/usr/bin/env node

/*
 * SHSY-RB-2025-Team1
 * Production startup script for deployment
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting SHSY Staking Platform...');
console.log('📍 Environment: Production');
console.log('🔗 Network: Solana Devnet');

// Start the server using tsx
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  stdio: 'inherit',
  cwd: process.cwd()
});

server.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`🛑 Server exited with code ${code}`);
  process.exit(code || 0);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  server.kill('SIGINT');
});