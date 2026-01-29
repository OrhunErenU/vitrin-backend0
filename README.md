# Outfit Backend

Node.js/Express + PostgreSQL + Prisma backend scaffold.

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- Prisma ORM
- bcrypt
- jsonwebtoken

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment file and configure:
```bash
cp .env.example .env
```

3. Update `.env` with your PostgreSQL connection string and JWT secret.

4. Generate Prisma client:
```bash
npm run prisma:generate
```

5. Run database migrations:
```bash
npm run prisma:migrate
```

## Development

Start the development server:
```bash
npm run dev
```

Server runs on `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Protected Routes
- `GET /api/protected` - Example protected route (requires Bearer token)

### Health Check
- `GET /health` - Server health check

## Database Models

- **User** - User accounts with style preferences
- **Outfit** - User outfits with products and status
- **Like** - Outfit likes (unique per user/outfit)
- **DailyQuota** - Daily upload limit tracking (3 per day)
- **ProductLink** - Product links associated with outfits
