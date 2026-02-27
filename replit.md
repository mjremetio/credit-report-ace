# LEXA - FCRA AI Agent

## Overview
AI-powered credit report analysis tool that ingests credit reports (HTML, PDF, TXT) and extracts potential FCRA (Fair Credit Reporting Act) violations using OpenAI's GPT models.

## Architecture
- **Frontend**: React + Vite + TailwindCSS v4 + shadcn/ui + framer-motion
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2 for analysis)
- **File Upload**: Multer (memory storage, 20MB limit)
- **HTML Parsing**: Cheerio

## Key Files
- `shared/schema.ts` - Database schema (reports, findings, accounts + chat models)
- `server/analyzer.ts` - AI analysis engine with FCRA rule definitions
- `server/routes.ts` - API endpoints (upload, reports CRUD)
- `server/storage.ts` - Database operations
- `server/db.ts` - Database connection
- `client/src/pages/Dashboard.tsx` - Main UI
- `client/src/lib/api.ts` - Frontend API helpers

## API Endpoints
- `POST /api/reports/upload` - Upload credit report file (multipart/form-data)
- `GET /api/reports` - List all reports
- `GET /api/reports/:id` - Get report with findings and accounts
- `DELETE /api/reports/:id` - Delete a report

## FCRA Rules Engine
The AI analyzes reports against these rule categories:
- Balance Errors (paid but not zero, cross-bureau mismatch)
- Status Conflicts (open + chargeoff, dispute inconsistency)
- Date/Aging Issues (DOFD inconsistent, obsolete reporting, re-aging)
- Duplicate/Mixed File (duplicate tradelines, name/address mismatch)
- Payment History Issues (grid vs status inconsistency)
- Credit Limit Issues (cross-bureau limit mismatch)
- Inquiry Issues (impermissible inquiries)

## Design
- Dark "Cyber-Legal" theme
- Fonts: Space Grotesk (display), Inter (body), JetBrains Mono (mono)
- Color: Cyan primary (#00bcd4 range), dark backgrounds
