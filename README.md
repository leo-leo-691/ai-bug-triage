# AI-Assisted Software Bug Reporting and Triage System

An academic research prototype designed for automated bug intake, few-shot severity classification, semantic duplicate detection via high-dimensional vector embeddings (`pgvector`), and human-in-the-loop triage management.

---

## 1. System Architecture

The system follows a strict 4-layer separation of concerns to maximize defensibility, fault tolerance, and modularity:

```
┌──────────────────────────────────────────────────────────┐
│                   Layer 1: Client (Browser)              │
│       /report (Intake) │ /bugs (Queue) │ /admin (Triage) │
└────────────────────────────┬─────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────┐
│            Layer 2: Next.js App Layer (Vercel)           │
│       App Router (Server Components & Next.js API Routes)│
└────────────────────────────┬─────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────┐
│        Layer 3: AI Orchestration Layer (lib/ai-*)        │
│   Input Validation ➔ Few-Shot Classification ➔ Tagging │
│    1536-dim Embeddings ➔ Cosine Similarity ➔ Thresholds │
└───────────────────────┬──────────────────┬───────────────┘
                        ▼                  ▼
┌──────────────────────────────┐  ┌────────────────────────┐
│  Layer 4: Supabase Postgres  │  │   External LLM Engine  │
│  - pgvector (1536-dim vectors│  │  - Gemini / OpenAI     │
│  - Row Level Security (RLS)  │  │  - Few-shot prompt     │
│  - Audit log append-only     │  │  - Deterministic fallbk│
└──────────────────────────────┘  └────────────────────────┘
```

### Layer Responsibilities
1. **Client Layer (UI)**: Built with Next.js 14+ (App Router, Tailwind CSS, Lucide icons). Provides distinct interfaces for bug reporters (`/report`), engineering queue views (`/bugs`, `/bugs/[id]`), and triage commanders (`/admin`).
2. **Next.js App Layer**: Restful API routes (`/api/bugs`, `/api/bugs/[id]`, `/api/admin/triage`) and Supabase SSR authentication middleware ensuring secure session management.
3. **AI Orchestration Service Layer (`lib/ai-orchestrator.ts`)**:
   - **Input Sanitation**: Validates text length and structure before initiating model calls.
   - **Few-Shot Classification**: Analyzes symptom descriptions against 4 curated few-shot exemplars to categorize severity (`Critical`, `High`, `Medium`, `Low`) with an explanatory reason and calibrated confidence score ($0.0 \le c \le 1.0$).
   - **Multi-Label Tag Suggestion**: Suggests 1–3 tags constrained to standard domains (`ui`, `backend`, `auth`, `payment`, `performance`, `crash`, `data-loss`) or generates domain-specific extensions.
   - **Semantic Duplicate Detection**: Generates 1536-dimensional embeddings and queries Postgres `pgvector` using cosine distance ($1 - \text{cosine\_distance}$). Matches exceeding $\ge 0.85$ are flagged in `duplicate_links`.
   - **Confidence Thresholding**: If model confidence is $< 0.6$, the bug report is safely routed to `pending_review` instead of auto-applying severity.
   - **Graceful Degradation**: Any external API failure (rate limit, quota exhaustion, network timeout) is trapped without blocking bug creation; the report is persisted with status `pending_triage`.
4. **Data Layer (Supabase PostgreSQL)**:
   - Native `pgvector` extension storing 1536-dim vector embeddings.
   - Row Level Security (RLS) scoping reporters to their submitted records, and granting admins/developers full visibility.
   - Append-only `audit_log` recording every automated triage event and human override.

---

## 2. Theoretical & Design Decisions (For Viva & Paper Defense)

### A. Why Vector Similarity for Duplicate Detection?
Traditional text matching (e.g. Levenshtein or BM25 keyword matching) fails when users describe identical defects using different terminology (e.g., *"Crash when clicking Checkout"* vs. *"Null pointer exception during final payment dispatch"*). 
By computing normalized vector embeddings:
$$\text{Similarity}(u, v) = \frac{u \cdot v}{\|u\|_2 \|v\|_2} = 1 - \text{cosine\_distance}(u, v)$$
Supabase `pgvector` indexes these vectors to quickly retrieve semantically identical defects above our empirical $0.85$ threshold.

### B. Why Calibrate with a $0.6$ Confidence Threshold?
Automated systems that blindly trust probabilistic LLM outputs degrade developer trust due to hallucinations and false positives. By introducing a guardrail threshold:
$$\text{Status} = \begin{cases} \text{triaged} & \text{if } \text{confidence} \ge 0.6 \\ \text{pending\_review} & \text{if } \text{confidence} < 0.6 \end{cases}$$
The system enforces human-in-the-loop oversight on ambiguous reports while automating routine triage on clear, high-confidence issues.

### C. Graceful Degradation vs. Hard Dependency
Bug reporting is mission-critical. If an external AI provider experiences an outage (e.g., HTTP 429 quota exhaustion or network timeout), crashing the submission form causes irreversible user data loss. The orchestrator isolates AI execution: bug creation is atomic, and AI failures simply mark the ticket as `pending_triage` with an audit log entry.

---

## 3. Database Schema

```sql
users (
  id uuid primary key default gen_random_uuid(),
  name text, email text unique,
  role text check (role in ('reporter','admin','developer')),
  created_at timestamptz default now()
)

bug_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  steps_to_reproduce text,
  reporter_id uuid references users(id),
  status text default 'new' check (status in
    ('new','pending_triage','pending_review','triaged','in_progress','resolved','closed')),
  ai_severity text,
  ai_confidence float,
  human_severity text,
  assigned_to uuid references users(id),
  embedding vector(1536),
  created_at timestamptz default now()
)

tags (id uuid primary key default gen_random_uuid(), name text unique)

bug_tags (
  bug_id uuid references bug_reports(id),
  tag_id uuid references tags(id),
  source text check (source in ('ai','human')),
  primary key (bug_id, tag_id)
)

duplicate_links (
  bug_id uuid references bug_reports(id),
  duplicate_of_bug_id uuid references bug_reports(id),
  similarity_score float,
  confirmed boolean default null,
  primary key (bug_id, duplicate_of_bug_id)
)

audit_log (
  id uuid primary key default gen_random_uuid(),
  bug_id uuid references bug_reports(id),
  action text,
  actor uuid references users(id),
  created_at timestamptz default now()
)
```

---

## 4. Setup and Local Execution

### Prerequisites
- Node.js 18+ (tested on Node 20 / 24)
- Supabase account ([supabase.com](https://supabase.com))
- Gemini API key ([aistudio.google.com](https://aistudio.google.com/)) or OpenAI API key

### Installation
```bash
npm install
```

### Environment Configuration (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# AI Keys (Gemini or OpenAI)
GEMINI_API_KEY=
OPENAI_API_KEY=
```

### Database Migration
1. Log into your Supabase Dashboard &rarr; **SQL Editor**.
2. Paste the contents of `supabase/schema.sql` and run the script.

### Verification Test Scripts
```bash
# 1. Verify Database and pgvector connection
npm run test:db

# 2. Verify Core CRUD (Phase 2)
node --env-file=.env.local scripts/test-crud.mjs

# 3. Verify AI Orchestrator, Confidence Thresholds & pgvector Duplicates (Phase 3)
npx tsx --env-file=.env.local scripts/test-ai-orchestrator.mjs

# 4. Verify Admin Triage & Audit Logs (Phase 4)
node --env-file=.env.local scripts/test-admin-triage.mjs

# 5. Run Full AI Evaluation Benchmark (Accuracy, Confusion Matrix, Precision/Recall)
npm run eval
```

Results are printed as console tables and exported to `scripts/evaluation-results.json` for inclusion in research papers.

### Run Web Application
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Deployment on Vercel

1. Push this repository to GitHub / GitLab.
2. Go to [Vercel Dashboard](https://vercel.com) &rarr; **Add New Project**.
3. Import the repository.
4. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY` or `OPENAI_API_KEY`
5. Click **Deploy**.
