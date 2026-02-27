# LEXA - FCRA AI Agent & Dispute Workflow Platform

## Overview
AI-powered credit report analysis and dispute workflow platform. Users can upload credit reports for automated analysis, or manually enter negative accounts and walk through a 4-step guided workflow with AI-powered FCRA violation detection.

## Architecture
- **Frontend**: React + Vite + TailwindCSS v4 + shadcn/ui + framer-motion + wouter (routing)
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2)
- **File Upload**: Multer (memory storage, 20MB limit)
- **HTML Parsing**: Cheerio
- **PDF Parsing**: pdf-parse (v2.4.5, named export `PDFParse`)

## Key Features
1. **File Upload Analysis**: Upload HTML/PDF/TXT credit reports — AI auto-extracts negative accounts, classifies them, and detects FCRA violations
2. **Manual Account Entry**: Paste negative accounts from credit reports into organized scans
3. **Account Classification**: Categorize as Debt Collection, Charge-Off, or Repossession
4. **AI Violation Detection**: GPT-powered scan of each account for FCRA violations
5. **Workflow Tracking**: 4-step workflow (Start → Add Accounts → Classify → Next Steps)
6. **Profile Clarity View**: Summary dashboard of all accounts and violations
7. **Persistent Sidebar**: Left sidebar navigation with Upload, Manual Workflow, Profile Clarity modes

**Note**: Letter generation features have been explicitly removed per user request. The `letters` table still exists in the schema/DB but has no active routes, storage methods, or UI.

## Layout & Navigation
- Persistent left sidebar (`client/src/components/Layout.tsx`) wraps all pages
- Three nav modes: Upload (`/upload`), Manual Workflow (`/`), Profile Clarity (`/profile`)
- `/` and `/scan/:id` both highlight "Manual Workflow" in sidebar
- ENGINE: ONLINE status badge at bottom of sidebar

## Key Files
- `shared/schema.ts` - Database schema (scans, negative_accounts, violations, letters [dormant], reports, findings, accounts)
- `server/analyzer.ts` - File-based AI analysis engine with FCRA rule definitions
- `server/ai-services.ts` - Account-level AI services (violation detection only)
- `server/routes.ts` - API endpoints (scans, accounts, violations, upload)
- `server/storage.ts` - Database CRUD operations
- `server/db.ts` - Database connection
- `client/src/components/Layout.tsx` - Persistent sidebar layout
- `client/src/pages/Home.tsx` - Landing page with scan list (Manual Workflow)
- `client/src/pages/Upload.tsx` - File upload with AI analysis
- `client/src/pages/ScanWizard.tsx` - 4-step guided workflow
- `client/src/pages/ProfileView.tsx` - Profile Clarity View
- `client/src/lib/api.ts` - Frontend API helpers

## API Endpoints
### Scans (workflow flow)
- `POST /api/scans` - Create new scan
- `GET /api/scans` - List all scans
- `GET /api/scans/:id` - Get scan with accounts and violations
- `PATCH /api/scans/:id` - Update scan step/status
- `DELETE /api/scans/:id` - Delete scan
- `POST /api/scans/upload` - Upload file, AI extracts accounts + detects violations, creates scan

### Negative Accounts
- `POST /api/scans/:scanId/accounts` - Add negative account
- `PATCH /api/scans/:scanId/accounts/:id` - Update account
- `DELETE /api/scans/:scanId/accounts/:id` - Delete account

### AI Actions
- `POST /api/accounts/:id/scan` - AI violation detection

## Database Tables
- `scans` - Workflow sessions
- `negative_accounts` - Negative accounts (manual or extracted from upload)
- `violations` - AI-detected violations per negative account
- `letters` - (dormant) AI-generated dispute letters table, no active code references
- `reports` - Legacy uploaded credit report files (tables kept, routes removed)
- `findings` - Legacy FCRA violations from file analysis
- `accounts` - Legacy parsed accounts from file analysis

## Design
- Dark "Cyber-Legal" theme
- Fonts: Space Grotesk (display), Inter (body), JetBrains Mono (mono)
- Color: Cyan primary (#00bcd4 range), dark backgrounds
- Account types: debt_collection, charge_off, repossession
- Workflow steps: pending → classified → scanned (3 active states)

## Important Notes
- OpenAI env vars: `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`
- Model: `gpt-5.2` with `response_format: { type: "json_object" }` for structured output
- No `temperature` param for gpt-5+
- PDF parse: use `import { PDFParse } from "pdf-parse"` (named export, ESM)
- Letter generation was removed — do NOT re-add unless explicitly requested
- Legacy report routes were removed from both server and client API
