# InvestPro - Commission Platform

Full-stack investment/commission platform for learning purposes.

## Project Structure

```
grap_order/
├── backend/          Node.js + Express API
├── frontend/         User-facing web app
├── admin/            Admin control panel
└── database/         MySQL schema
```

## Quick Start

### 1. Setup Database
```sql
-- In MySQL, run:
source database/schema.sql
```

### 2. Setup Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your MySQL credentials
npm install
npm run dev
```

### 3. Open Frontend
Open `frontend/index.html` in browser (or use Live Server in VS Code)

### 4. Open Admin Panel
Open `admin/index.html` in browser
- Username: `admin`
- Password: `Admin@123`

## API Endpoints

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`

### User (requires JWT)
- `GET  /api/user/dashboard`
- `GET  /api/user/profile`
- `PUT  /api/user/profile`
- `GET  /api/user/transactions`
- `POST /api/user/deposit`
- `POST /api/user/withdraw`

### Tasks (requires JWT)
- `GET  /api/tasks/available`
- `POST /api/tasks/:id/submit`
- `GET  /api/tasks/history`
- `GET  /api/tasks/products`

### Admin (requires Admin JWT)
- `POST /api/admin/login`
- `GET  /api/admin/dashboard`
- `GET  /api/admin/users`
- `PUT  /api/admin/users/:id/status`
- `PUT  /api/admin/users/:id/balance`
- `GET  /api/admin/deposits`
- `PUT  /api/admin/deposits/:id/process`
- `GET  /api/admin/withdrawals`
- `PUT  /api/admin/withdrawals/:id/process`
- `GET/POST/PUT/DELETE /api/admin/products`
- `GET/PUT /api/admin/settings`
