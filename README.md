# LEXA - FCRA AI Agent & Dispute Workflow Platform

AI-powered credit report analysis and dispute workflow platform built with React, Express, and OpenAI. Upload credit reports for automated analysis, or manually enter negative accounts and walk through a guided workflow with AI-powered FCRA violation detection.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)

## Overview

LEXA is an intelligent credit repair assistant that leverages AI to analyze credit reports for Fair Credit Reporting Act (FCRA) violations. It provides two main workflows:

1. **Automated Analysis** — Upload a credit report file (HTML, PDF, or TXT) and let AI extract negative accounts, classify them, and detect potential FCRA violations automatically.
2. **Manual Workflow** — Enter negative accounts manually, classify them by type, and run AI-powered violation detection on each account individually.

## Features

- **Credit Report Upload** — Upload HTML, PDF, or TXT credit reports (up to 20MB). AI auto-extracts negative accounts, classifies them, and detects FCRA violations.
- **Manual Account Entry** — Paste negative account details from credit reports into organized scans for structured review.
- **Account Classification** — Categorize accounts as Debt Collection, Charge-Off, or Repossession for targeted analysis.
- **AI Violation Detection** — GPT-powered scan of each account against FCRA rules and regulations to identify potential violations.
- **4-Step Guided Workflow** — Walk through Start → Add Accounts → Classify → Next Steps with progress tracking.
- **Profile Clarity View** — Summary dashboard showing all accounts and their detected violations at a glance.
- **Dark Cyber-Legal Theme** — Sleek dark interface with cyan accents designed for professional credit analysis.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TailwindCSS v4, shadcn/ui, Framer Motion, Wouter |
| Backend | Express.js, TypeScript, Node.js |
| Database | PostgreSQL with Drizzle ORM |
| AI Engine | OpenAI GPT with structured JSON output |
| File Parsing | Multer (uploads), Cheerio (HTML), pdf-parse (PDF) |
| Validation | Zod, drizzle-zod |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- OpenAI API key

### Installation

```bash
# Clone the repository
git clone https://github.com/mjremetio/credit-report-ace.git
cd credit-report-ace

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and OpenAI API key

# Push database schema
npm run db:push

# Start development server
npm run dev
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key for AI-powered analysis |
| `SESSION_SECRET` | Secret for session management |

## Project Structure

```
credit-report-ace/
├── client/                      # Frontend React application
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   │   ├── Layout.tsx       # Persistent sidebar layout
│   │   │   └── ui/              # shadcn/ui components
│   │   ├── pages/               # Route pages
│   │   │   ├── Home.tsx         # Landing page with scan list
│   │   │   ├── Upload.tsx       # Credit report file upload
│   │   │   ├── ScanWizard.tsx   # 4-step guided workflow
│   │   │   └── ProfileView.tsx  # Profile clarity dashboard
│   │   ├── hooks/               # Custom React hooks
│   │   └── lib/                 # API helpers and utilities
│   └── index.html               # Entry HTML
├── server/                      # Backend Express server
│   ├── routes.ts                # API route definitions
│   ├── storage.ts               # Database CRUD operations (Drizzle)
│   ├── analyzer.ts              # AI analysis engine with FCRA rules
│   ├── ai-services.ts           # Account-level AI violation detection
│   └── db.ts                    # Database connection setup
├── shared/                      # Shared between frontend & backend
│   └── schema.ts                # Drizzle ORM database schema & types
├── drizzle.config.ts            # Drizzle ORM configuration
├── vite.config.ts               # Vite build configuration
├── tailwind.config.ts           # TailwindCSS configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

## API Reference

### Scans
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scans` | Create a new scan |
| `GET` | `/api/scans` | List all scans |
| `GET` | `/api/scans/:id` | Get scan with accounts and violations |
| `PATCH` | `/api/scans/:id` | Update scan step/status |
| `DELETE` | `/api/scans/:id` | Delete a scan |
| `POST` | `/api/scans/upload` | Upload file for AI analysis |

### Negative Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scans/:scanId/accounts` | Add a negative account |
| `PATCH` | `/api/scans/:scanId/accounts/:id` | Update an account |
| `DELETE` | `/api/scans/:scanId/accounts/:id` | Delete an account |

### AI Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/accounts/:id/scan` | Run AI violation detection |

## Database Schema

- **scans** — Workflow sessions with step tracking
- **negative_accounts** — Negative accounts (manual entry or AI-extracted)
- **violations** — AI-detected FCRA violations per account

## Design System

| Element | Value |
|---------|-------|
| Theme | Dark "Cyber-Legal" |
| Primary Color | Cyan (#00bcd4) |
| Display Font | Space Grotesk |
| Body Font | Inter |
| Mono Font | JetBrains Mono |
| Account Types | Debt Collection, Charge-Off, Repossession |

## Workflow States

```
pending → classified → scanned
```

1. **Pending** — Scan created, accounts being added
2. **Classified** — Accounts categorized by type
3. **Scanned** — AI violation detection complete

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

All rights reserved.

---

Built with AI-powered intelligence for credit report analysis and FCRA compliance.
