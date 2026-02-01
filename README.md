<!--
 * SHSY-RB-2025-Team1
-->


# SHSY Staking Platform

A comprehensive blockchain staking platform built on Solana devnet that combines cryptocurrency staking with trivia/puzzle challenges. Users can stake SHSY tokens across multiple pools with different reward rates and lock periods while earning additional rewards through daily trivia questions.

## 🚀 Features

### Staking System
- **Multiple Staking Pools**: 30-day (5% APY), 90-day (6% APY), and 180-day (7% APY)
- **Flexible Staking**: Support for multiple simultaneous stakes per user
- **Real-time Rewards**: Automatic APY-based reward calculations
- **Smart Contract Integration**: Deployed on Solana devnet with simplified contract handling
- **Global Challenge System**: 10-day and 30-day challenges with random winner selection
- **Million SHSY Pool**: $4 USDT entry, SHSY token rewards with automatic distributions
- **Fund Locking System**: Configurable reward locking (default: 25% locked for 30 days)

### Trivia System
- **Input-based Questions**: Text input trivia challenges with dynamic content
- **Pagination Support**: Navigation arrows for multiple active riddles
- **Admin Management**: Complete riddle creation, editing, and management system
- **Reward Distribution**: Automatic SHSY token rewards for correct answers
- **Wallet Integration**: Requires wallet connection for participation

### Admin Panel
- **Riddle Management**: Create, edit, activate, deactivate, and delete riddles
- **CSV Batch Upload**: Import multiple riddles from CSV files
- **Reward Settings**: Configure APY rates and participation rewards
- **Statistics Dashboard**: Track users, stakes, and platform metrics
- **Real-time Monitoring**: Live statistics and leaderboard management

## 🏗️ Architecture

### Technology Stack
- **Frontend**: Server-side HTML with Tailwind CSS and vanilla JavaScript
- **Backend**: Node.js with Express, TypeScript runtime (TSX)
- **Database**: PostgreSQL with Drizzle ORM
- **Blockchain**: Solana devnet with @solana/web3.js
- **Smart Contract**: Anchor framework (Rust)

### UI Design System
- **Color Scheme**: Cyan (#00ddeb) and Blue (#046bd2) primary colors
- **Background**: Linear gradient from #e0f7fa to #e9fdff
- **Typography**: System fonts with responsive sizing
- **Interactive Elements**: Hover effects with scale transformations
- **Layout**: Mobile-first responsive grid design

### Key Components
```
server/
├── admin-teal.html               # Admin panel interface
├── dapp.html                     # Main staking DApp
├── dashboard.html                # User dashboard
├── db.ts                         # Database connection
├── index.ts                      # Main server with all APIs
├── anchor-staking-updated.ts     # Smart contract interface
├── storage.ts                    # Database operations
├── token-creator.ts              # Token management
├── simple-global-challenges.ts   # Global challenge system
└── reward-locker.ts              # Fund locking system

shared/
└── schema.ts                     # Database schema definitions

multiple-staking-final.rs         # Deployed smart contract
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Solana CLI (for smart contract deployment)

### Installation

1. **Clone and Setup**
```bash
git clone <repository-url>
cd shsy-staking-platform
npm install
```

2. **Environment Configuration**
Create `.env` file:
```env
DATABASE_URL=postgresql://username:password@host:port/database
ADMIN_PRIVATE_KEY=your_solana_admin_private_key
TOKEN_MINT_ADDRESS=3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P
PROGRAM_ID=7GKL6U2Rh3PzGNPpeN7PdQNucSCg2HJMa41EqR9qVeBm
NODE_ENV=development
```

3. **Database Setup**
```bash
npm run db:push  # Push schema to database
```

4. **Start Development Server**
```bash
npm run dev
```

### Access Points
- **User Dashboard**: `http://localhost:5000/dashboard`
- **Staking DApp**: `http://localhost:5000/dapp`
- **Admin Panel**: `http://localhost:5000/admin`

## 📱 User Interfaces

### User Dashboard (`/dashboard`)
- Portfolio overview and staking statistics
- Challenge progress tracking
- Transaction history
- Leaderboard display

### Staking DApp (`/dapp`)
- Wallet connection (Phantom, Solflare)
- Multi-pool staking interface
- Real-time reward calculations
- Stake management (create/withdraw)
- Challenge participation

### Admin Panel (`/admin`)
- Complete riddle management system
- CSV batch upload for riddles
- Reward settings configuration
- Platform statistics monitoring
- User management tools

## 🔗 Smart Contract Integration

### Contract Details
- **Program ID**: `7GKL6U2Rh3PzGNPpeN7PdQNucSCg2HJMa41EqR9qVeBm`
- **Token Mint**: `3pbRHwFCQbLYoqmvWqkwUV4Vn1mnmqHvfGMhwPaxcL7P`
- **Network**: Solana Devnet
- **Staking Pool**: `HEwjGawpfikVr5hTG9kTimGGhWNvKVcHj7GSJU1awStW`

### Key Operations
- **Stake**: Lock SHSY tokens in pools with specified lock periods
- **Withdraw**: Claim principal + APY rewards after lock period
- **Reward Calculation**: Time-based APY using formula: `principal × (APY/100) × timeElapsedInYears`

## 📊 Database Schema

### Core Tables
- **users**: User profiles and wallet addresses
- **stakes**: Individual staking records with pool selection
- **riddles_with_options**: Trivia questions and answers
- **riddle_submissions**: User responses and scoring
- **staking_challenges**: 10d/30d participation challenges
- **reward_settings**: Configurable platform parameters

## 🎯 Challenge System

### Participation Challenges
- **10-day Challenge**: 20 SHSY reward for maintaining stakes
- **30-day Challenge**: 45 SHSY reward for long-term staking
- **Automatic Management**: Challenges start with first stake, pause/resume based on active stakes

### Challenge Lifecycle
1. **Start**: Automatically when user creates first stake
2. **Progress**: Daily increments while stakes are active
3. **Complete**: Ready to claim when time requirement met
4. **Claim**: User receives SHSY reward, challenge restarts if stakes remain
5. **Cleanup**: Challenges deleted when no active stakes remain

## 🔧 API Endpoints

### Staking Operations
- `GET /api/dapp/balance/:wallet` - Get token balance
- `POST /api/dapp/stake` - Create stake transaction
- `POST /api/dapp/withdraw` - Create withdrawal transaction
- `GET /api/dapp/stakes/:wallet` - Get user stakes
- `GET /api/dapp/leaderboard` - Get staking leaderboard

### Challenge Management
- `GET /api/dapp/challenges/:wallet` - Get active challenges
- `POST /api/dapp/challenges/claim` - Claim challenge rewards

### Admin Operations
- `GET /api/admin/riddles` - List all riddles
- `POST /api/admin/riddles` - Create new riddle
- `PUT /api/admin/riddles/:id` - Update riddle
- `PUT /api/admin/riddles/:id/status` - Activate/deactivate riddle
- `DELETE /api/admin/riddles/:id` - Delete riddle
- `POST /api/admin/riddles/batch-upload` - CSV batch import

### Statistics
- `GET /api/stats` - Platform statistics
- `GET /api/admin/stats` - Admin dashboard statistics

## 🚀 Deployment

### Production Deployment
1. **Prepare for Deployment**
   - Ensure all environment variables are set
   - Verify database connection
   - Test all endpoints

2. **Deploy to Production**
   - Build the application if needed
   - Upload files to your hosting platform
   - Configure environment variables on your hosting service
   - Start the server with `npm run dev`

3. **Post-Deployment**
   - Verify all interfaces are accessible
   - Test wallet connections on production
   - Monitor smart contract interactions

### Production Considerations
- **Environment Variables**: Set production values for all secrets
- **Database**: Use production PostgreSQL instance
- **CORS**: Configure for production domains
- **SSL/TLS**: Configure SSL certificates for secure connections

## 📈 Monitoring & Analytics

### Key Metrics
- **Total Users**: Platform registration count
- **Active Stakes**: Currently locked stakes
- **Total Staked**: Sum of all active stake amounts
- **Challenge Participation**: User engagement metrics

### Admin Dashboard Features
- Real-time platform statistics
- User activity monitoring
- Stake distribution analysis
- Challenge completion rates

## 🛠️ Development

### Database Migrations
```bash
npm run db:push  # Push schema changes to database
```

### Testing
```bash
# Test API endpoints
curl -X GET http://localhost:5000/api/stats

# Test staking operations
curl -X POST http://localhost:5000/api/dapp/stake \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"...","amount":100,"poolId":0}'
```

### Common Commands
```bash
npm run dev          # Start development server
npm run db:push      # Update database schema
npm run build        # Build for production
```

## 🔒 Security Features

- **Wallet Authentication**: Secure Solana wallet integration
- **Input Validation**: Server-side validation for all endpoints
- **CORS Protection**: Configured cross-origin request handling
- **Private Key Security**: Secure admin keypair management
- **Transaction Verification**: Blockchain transaction confirmation

## 📚 Additional Resources

- [API Documentation](./API-GUIDE.md) - Complete API reference
- [Smart Contract Source](./multiple-staking-final.rs) - Deployed contract code
- [Database Schema](./shared/schema.ts) - Complete schema definitions

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with proper testing
4. Update documentation
5. Submit pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
- Check the API documentation
- Review console logs for errors
- Verify environment variables
- Test database connectivity

---

**SHSY Staking Platform** - Transforming blockchain staking through gamification and user engagement.