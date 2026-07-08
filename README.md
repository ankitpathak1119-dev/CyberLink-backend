# Cyberlink Backend

Production-ready Node.js + Express backend for Cyberlink chat app.

## Stack
- Node.js 20+
- Express
- MongoDB Atlas (Mongoose)
- JWT + bcrypt
- Socket.io
- Firebase Admin (FCM)
- Helmet, CORS, Morgan, dotenv

## Setup
1. Install dependencies:
```bash
cd cyberlink-backend
npm install
```
2. Create env file:
```bash
cp .env.example .env
```
3. Fill `.env` values (`MONGO_URI`, `JWT_SECRET`, and Firebase keys if FCM needed).
4. Run in development:
```bash
npm run dev
```
5. Run in production mode:
```bash
npm start
```

## API Base
- Health: `GET /health`
- Auth: `/api/auth`
- Users: `/api/users`
- Chats: `/api/chats`

## Roadmap Phase A APIs
- Reply message: `POST /api/chats/:chatId/messages` with `{ content, replyToMessageId }`
- Edit own message (15-min window): `PATCH /api/chats/messages/:messageId` with `{ content }`
- React/toggle reaction: `PUT /api/chats/messages/:messageId/reaction` with `{ emoji }`
- Forward message: `POST /api/chats/messages/:messageId/forward` with `{ targetChatIds: [] }`
- Mark delivered: `PUT /api/chats/:chatId/messages/mark-delivered` with optional `{ messageIds: [] }`
- Mark seen: `PUT /api/chats/:chatId/messages/mark-seen` with optional `{ messageIds: [] }`

## PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs cyberlink-backend
pm2 save
pm2 startup
```

## Nginx Reverse Proxy (WebSocket compatible)
Use this inside your server block:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

## Socket Events
- `setup` -> `{ userId }`
- `join chat` -> `chatId`
- `new message` -> message payload
- `message updated` -> message payload
- `message delivered` -> `{ chatId, messageIds, userId, at }`
- `message seen` -> `{ chatId, messageIds, userId, at }`
- `typing` -> `chatId`
- `stop typing` -> `chatId`
- server emits: `connected`, `message received`, `message updated`, `messages delivered`, `messages seen`, `typing`, `stop typing`
