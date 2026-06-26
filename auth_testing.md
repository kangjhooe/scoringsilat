# Auth Testing Playbook — Silat Scoring

## Credentials (seeded on startup)
- admin@silat.id / admin123 (role: admin)
- operator@silat.id / password123 (role: operator)
- juri1@silat.id, juri2@silat.id, juri3@silat.id / password123 (role: jury)
- wasit@silat.id / password123 (role: referee)
- ketuajuri@silat.id / password123 (role: head_jury)
- timer@silat.id / password123 (role: timer)

## Auth Type
- JWT Bearer tokens (no cookies). Tokens valid 24h.
- Frontend stores token in localStorage and sends `Authorization: Bearer <token>` header.

## API Test
```
curl -X POST $REACT_APP_BACKEND_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@silat.id","password":"admin123"}'
```
Expected: `{ "token": "...", "user": {...} }`

```
curl $REACT_APP_BACKEND_URL/api/auth/me -H "Authorization: Bearer $TOKEN"
```
Expected: user object with role admin.

## Role-based access
- /api/events POST/PUT/DELETE → admin only
- /api/matches POST → admin or operator
- /api/matches/{id}/actions → jury (score), referee/head_jury (penalty/fall/binaan/absolute_win)
- /api/matches/{id}/timer → timer/operator/admin
- /api/matches/{id}/approve → head_jury/admin
