# KYC Backend (MERN + Firebase)

Production-ready backend foundation for a KYC platform:

- **Auth**: Firebase ID token verification + MongoDB user sync
- **Documents**: PDF upload to Cloudinary + async OCR processing (PDF → image → Tesseract)
- **Admin**: User/document management + dashboard stats

## Local setup

1. Clone the repo and enter backend:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` from `.env.example`:

```bash
copy .env.example .env
```

4. Fill environment variables in `.env`.

5. Run the dev server:

```bash
npm run dev
```

Health check: `GET /health`

## Environment variables

- **`PORT`**: Server port (default: `5000`)
- **`MONGO_URI`**: MongoDB connection string
- **`ADMIN_EMAIL`**: Email that should be treated as admin
- **`CLIENT_URL`**: Allowed frontend origin (also allows `http://localhost:5173`)
- **`CLOUDINARY_CLOUD_NAME`**: Cloudinary cloud name
- **`CLOUDINARY_API_KEY`**: Cloudinary API key
- **`CLOUDINARY_API_SECRET`**: Cloudinary API secret
- **`FIREBASE_PROJECT_ID`**: Firebase project id
- **`FIREBASE_CLIENT_EMAIL`**: Firebase service account client email
- **`FIREBASE_PRIVATE_KEY`**: Firebase service account private key (store with escaped newlines `\\n`)

## API routes

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Basic health check |
| POST | `/api/auth/sync` | No | Upsert user by `uid` after registration/login |
| GET | `/api/auth/me` | Yes | Get current user (requires Firebase Bearer token) |
| POST | `/api/documents/upload?type=aadhaar\|pan` | Yes | Upload PDF (field: `document`) and start OCR |
| GET | `/api/documents/my-documents` | Yes | List current user's documents |
| GET | `/api/admin/users?search=&status=&page=` | Admin | List users with documents (search/status/pagination) |
| GET | `/api/admin/users/:userId` | Admin | Get a user and their documents |
| GET | `/api/admin/stats` | Admin | Dashboard counts |

## Request auth (Firebase)

For protected routes, send:

- Header: `Authorization: Bearer <FIREBASE_ID_TOKEN>`

## Deployment (Render)

1. Create a new **Web Service** on Render from your repo.
2. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. Add Environment Variables in Render (same keys as `.env.example`).
4. Ensure MongoDB is reachable from Render (Atlas recommended) and `MONGO_URI` is correct.
5. Deploy. Verify with:
   - `GET /health`

