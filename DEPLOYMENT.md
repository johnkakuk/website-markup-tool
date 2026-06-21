# Deployment

Deploy in this order: Supabase, Railway, then Vercel.

## 1. Hosted Supabase

1. Create a Supabase project in the dashboard.
2. Authenticate and link this repo:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

3. Review and apply every migration:

   ```bash
   npx supabase db push --dry-run
   npx supabase db push
   ```

4. Record these project values:

   - Project URL
   - Publishable key (`sb_publishable_...`)
   - Secret key (`sb_secret_...`)

The secret key is server-only. Never add it to a Vite variable or Vercel frontend environment.

## 2. Railway Proxy

1. Create a Railway service from the GitHub repository.
2. Keep the service root at the repository root so `railway.toml` is used.
3. Add these Railway variables:

   ```text
   NODE_ENV=production
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_YOUR_SECRET_KEY
   CORS_ORIGIN=https://YOUR_VERCEL_DOMAIN
   ```

4. Do not set `PROXY_ALLOW_INSECURE_TLS` in production.
5. Generate a Railway public domain and verify:

   ```text
   https://YOUR_RAILWAY_DOMAIN/health
   ```

The production proxy only accepts GET/HEAD requests, blocks private and reserved network targets,
and only proxies origins registered in the hosted `canvases` table.

## 3. Configure the Vercel Rewrite

Replace the placeholder Railway hostname in `vercel.json`:

```json
"destination": "https://YOUR_RAILWAY_DOMAIN/proxy/:path*"
```

Commit and push that change before creating the Vercel production deployment.

## 4. Vercel Frontend

1. Import the same GitHub repository into Vercel.
2. Keep the project root at the repository root. `vercel.json` supplies the build and output settings.
3. Add these Vercel variables for Production and Preview:

   ```text
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_YOUR_PUBLISHABLE_KEY
   ```

4. Deploy and record the final Vercel URL.
5. Update Railway's `CORS_ORIGIN` to that exact URL and redeploy Railway if the value changed.

## 5. Supabase Auth URLs

In Supabase Authentication URL settings:

- Set Site URL to the production Vercel URL.
- Add the production Vercel URL to allowed redirect URLs.
- Add preview domains only when they need working authentication.

The frontend also passes its current origin as the signup email redirect. Supabase must list that origin
as an allowed redirect URL or it will fall back to the configured Site URL.

## 6. Create the Production Admin

Local users are not copied to hosted Supabase. Sign up once through the deployed app, then run this
in the hosted Supabase SQL editor:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_EMAIL';
```

Sign out and back in, then create the first production canvas.

## 7. Client-Test Checklist

- Admin can create a canvas and link a client email.
- Client sees only the assigned canvas.
- Proxied page CSS, JavaScript, fonts, images, navigation, and scrolling work.
- New comments create pins, focused screenshots, replies, and attachments.
- Resolved comments lose their pins and remain in the resolved list.
- Comment deletion removes replies, screenshots, and attachments.
- Browser console has no blocked mixed-content, CORS, or missing proxy asset errors.
