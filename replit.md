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
1. **File Upload Analysis**: Upload HTML/PDF/TXT credit reports for automated FCRA violation detection
2. **Manual Account Entry**: Paste negative accounts from credit reports into organized scans
3. **Account Classification**: Categorize as Debt Collection, Charge-Off, or Repossession
4. **AI Violation Detection**: GPT-powered scan of each account for FCRA violations
5. **Workflow Tracking**: 4-step workflow (Start → Add Accounts → Classify → Next Steps)
6. **Profile Clarity View**: Summary dashboard of all accounts and violations

**Note**: Letter generation features have been explicitly removed per user request. The `letters` table still exists in the schema/DB but has no active routes, storage methods, or UI.

## Key Files
- `shared/schema.ts` - Database schema (reports, findings, accounts, scans, negative_accounts, violations, letters)
- `server/analyzer.ts` - File-based AI analysis engine with FCRA rule definitions
- `server/ai-services.ts` - Account-level AI services (violation detection only)
- `server/routes.ts` - API endpoints (reports, scans, accounts, violations)
- `server/storage.ts` - Database CRUD operations
- `server/db.ts` - Database connection
- `client/src/pages/Home.tsx` - Landing page with scan list
- `client/src/pages/ScanWizard.tsx` - 4-step guided workflow
- `client/src/pages/ProfileView.tsx` - Profile Clarity View
- `client/src/pages/Dashboard.tsx` - Legacy file upload UI (at /upload)
- `client/src/lib/api.ts` - Frontend API helpers

## API Endpoints
### Reports (file upload flow)
- `POST /api/reports/upload` - Upload credit report file
- `GET /api/reports` - List all reports
- `GET /api/reports/:id` - Get report with findings and accounts
- `DELETE /api/reports/:id` - Delete a report

### Scans (workflow flow)
- `POST /api/scans` - Create new scan
- `GET /api/scans` - List all scans
- `GET /api/scans/:id` - Get scan with accounts and violations
- `PATCH /api/scans/:id` - Update scan step/status
- `DELETE /api/scans/:id` - Delete scan

### Negative Accounts
- `POST /api/scans/:scanId/accounts` - Add negative account
- `PATCH /api/scans/:scanId/accounts/:id` - Update account
- `DELETE /api/scans/:scanId/accounts/:id` - Delete account

### AI Actions
- `POST /api/accounts/:id/scan` - AI violation detection

## Database Tables
- `reports` - Uploaded credit report files
- `findings` - FCRA violations from file analysis
- `accounts` - Parsed accounts from file analysis
- `scans` - Workflow sessions
- `negative_accounts` - Manually entered negative accounts
- `violations` - AI-detected violations per negative account
- `letters` - (dormant) AI-generated dispute letters table, no active code references

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
