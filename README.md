# LEXA - FCRA AI Agent & Dispute Workflow Platform

AI-powered credit report analysis and dispute workflow platform. Upload credit reports for automated analysis, or manually enter negative accounts and walk through a guided workflow with AI-powered FCRA violation detection.

## Features

- **Credit Report Upload** — Upload HTML, PDF, or TXT credit reports. AI automatically extracts negative accounts, classifies them, and detects FCRA violations.
- **Manual Account Entry** — Paste negative accounts from credit reports into organized scans for review.
- **Account Classification** — Categorize accounts as Debt Collection, Charge-Off, or Repossession.
- **AI Violation Detection** — GPT-powered analysis of each account for FCRA (Fair Credit Reporting Act) violations.
- **Workflow Tracking** — 4-step guided workflow: Start → Add Accounts → Classify → Next Steps.
- **Profile Clarity View** — Summary dashboard of all accounts and detected violations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, TailwindCSS v4, shadcn/ui, Framer Motion, Wouter |
| Backend | Express.js, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| AI | OpenAI GPT |
| File Parsing | Multer, Cheerio (HTML), pdf-parse (PDF) |

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
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI API base URL |

## Project Structure

```
├── client/                  # Frontend React application
│   └── src/
│       ├── components/      # UI components (Layout, shadcn/ui)
│       ├── pages/           # Route pages (Home, Upload, ScanWizard, ProfileView)
│       ├── hooks/           # Custom React hooks
│       └── lib/             # API helpers and utilities
├── server/                  # Backend Express server
│   ├── routes.ts            # API endpoints
│   ├── storage.ts           # Database CRUD operations
│   ├── analyzer.ts          # AI analysis engine with FCRA rules
│   ├── ai-services.ts       # Account-level AI violation detection
│   └── db.ts                # Database connection
├── shared/                  # Shared types and schema
│   └── schema.ts            # Drizzle ORM database schema
└── drizzle.config.ts        # Drizzle configuration
```

## API Endpoints

### Scans
- `POST /api/scans` — Create a new scan
- `GET /api/scans` — List all scans
- `GET /api/scans/:id` — Get scan with accounts and violations
- `PATCH /api/scans/:id` — Update scan step/status
- `DELETE /api/scans/:id` — Delete a scan
- `POST /api/scans/upload` — Upload file for AI analysis

### Negative Accounts
- `POST /api/scans/:scanId/accounts` — Add a negative account
- `PATCH /api/scans/:scanId/accounts/:id` — Update an account
- `DELETE /api/scans/:scanId/accounts/:id` — Delete an account

### AI Actions
- `POST /api/accounts/:id/scan` — Run AI violation detection on an account

## Design

Dark "Cyber-Legal" theme with cyan accent colors. Uses Space Grotesk for display text, Inter for body, and JetBrains Mono for monospace elements.

## License

All rights reserved.
