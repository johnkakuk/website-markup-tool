# Website Markup Tool

A tool for website annotation and client feedback.

## Apps

- `apps/frontend`: React + Vite app for auth, dashboards, canvases, pins, replies, and screenshot-backed comments.
- `apps/proxy`: Express proxy exposed under `/proxy` so iframe DOM access works from the frontend origin.
- `supabase/migrations`: Postgres schema, RLS policies, and storage bucket setup.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `apps/frontend/.env.local`:

   ```bash
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=your-local-anon-key
   ```

3. Create `apps/proxy/.env`:

   ```bash
   PORT=8787
   CORS_ORIGIN=http://localhost:5173
   ```

4. Apply the Supabase migration in `supabase/migrations/0001_initial_schema.sql`.

5. Run both apps:

   ```bash
   npm run dev
   ```

The frontend runs at `http://localhost:5173`. It proxies `/proxy/*` to the Express service at `http://localhost:8787`, keeping the iframe same-origin for DOM inspection and screenshots.

## Production Notes

- Vercel should serve the frontend and rewrite `/proxy/:path*` to the Railway proxy service.
- The browser must see the proxied site under the frontend origin, otherwise `iframe.contentDocument` is blocked.
- `comment-screenshots` is created by the migration and comments expect authenticated users to upload there.
- Follow `DEPLOYMENT.md` for the hosted Supabase, Railway, and Vercel deployment sequence.

## Future Features

- Optional name and email fields for attribution on replies.
- Responsive preview controls for simulating common viewport widths.
