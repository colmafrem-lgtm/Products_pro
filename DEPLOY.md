# Deploy to Railway

## Step 1 — Push to GitHub
Make sure your project is pushed to a GitHub repo (you will share the link).

## Step 2 — Create Railway project
1. Go to https://railway.app and sign in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your repository → select **main** branch

## Step 3 — Set Environment Variables
In Railway dashboard → your service → **Variables** tab, add:

| Key | Value |
|-----|-------|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | (any long random string) |
| `ADMIN_JWT_SECRET` | (any long random string) |
| `DB_PATH` | `/data/investpro.db` |

## Step 4 — Add Persistent Volume (IMPORTANT for database)
1. In Railway dashboard → your service → **Volumes** tab
2. Click **Add Volume**
3. Mount path: `/data`
4. This keeps your SQLite database across restarts

## Step 5 — Deploy
Railway auto-deploys on every GitHub push.
Your app URL will be shown in the dashboard (e.g. `https://yourapp.up.railway.app`).

## Notes
- First deploy auto-creates a fresh database with all tables + seed data
- All frontend + admin files are served from the same Node.js server
- Free tier: 500 hours/month (enough for testing)
