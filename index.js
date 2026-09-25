require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { Server } = require('socket.io');

const User = require('./models/User');
const Message = require('./models/Message');

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_WEB_CLIENT_ID || !process.env.MONGODB_URI) {
  console.error('Missing env: MONGODB_URI, GOOGLE_WEB_CLIENT_ID, JWT_SECRET');
  process.exit(1);
}

const googleClient = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);
const app = express();
app.use(cors());
app.use(express.json());

const DEFAULT_ROOMS = [
  { id: 'general', name: 'General' },
  { id: 'random', name: 'Random' },
  { id: 'vietnam', name: 'Việt Nam' },
];

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_WEB_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email,
        photo: payload.picture || null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      token: signToken(user),
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        photo: user.photo,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Google verification failed' });
  }
});

app.get('/rooms', authMiddleware, (_req, res) => {
  res.json(DEFAULT_ROOMS);
});

app.get('/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  const messages = await Message.find({ roomId: req.params.roomId })
    .sort({ createdAt: 1 })
    .limit(100);
  res.json(messages);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  socket.on('join', async (roomId) => {
    if (typeof roomId !== 'string') return;
    socket.join(roomId);
    const history = await Message.find({ roomId }).sort({ createdAt: 1 }).limit(100);
    socket.emit('history', history);
  });

  socket.on('leave', (roomId) => {
    if (typeof roomId === 'string') socket.leave(roomId);
  });

  socket.on('message', async ({ roomId, text }) => {
    if (typeof roomId !== 'string' || typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) return;

    const dbUser = await User.findById(socket.user.sub);
    if (!dbUser) return;

    const saved = await Message.create({
      roomId,
      text: trimmed,
      user: {
        id: String(dbUser._id),
        name: dbUser.name,
        photo: dbUser.photo,
      },
    });

    io.to(roomId).emit('message', saved);
  });
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log('chat server on :' + PORT);
    });
  })
  .catch((err) => {
    console.error('Mongo connect failed', err);
    process.exit(1);
  });