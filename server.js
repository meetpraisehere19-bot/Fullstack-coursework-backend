const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Simple logger middleware --------------------------------------
// Logs every request to the server console and keeps an in-memory
// history (useful for inspecting recent activity during development).
const MAX_LOGS = 200;
const LOGS = [];

app.use((req, res, next) => {
  const start = process.hrtime();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '-';
  const { method, originalUrl } = req;

  // When response finishes, compute duration and record the entry
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3) + (diff[1] / 1e6);
    const entry = {
      id: randomUUID(),
      time: new Date().toISOString(),
      method,
      url: originalUrl,
      ip,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      // Request body may be undefined for GET requests
      reqBody: req.body
    };

    // Push to in-memory buffer (FIFO)
    LOGS.push(entry);
    if (LOGS.length > MAX_LOGS) LOGS.shift();

    // Human-readable console output
    console.log(`[${entry.time}] ${entry.ip} ${entry.method} ${entry.url} -> ${entry.status} ${entry.durationMs}ms`);
    if (entry.reqBody && Object.keys(entry.reqBody).length) {
      // Print small request bodies inline, larger ones as JSON
      try {
        const s = JSON.stringify(entry.reqBody);
        console.log('  Request body:', s.length > 500 ? s.slice(0, 500) + '... (truncated)' : s);
      } catch (e) {
        console.log('  Request body: [unserializable]');
      }
    }
  });

  next();
});

// Simple in-memory users (NOT to use in production)
const USERS = [
  { username: 'admin', password: '12345' },
  { username: 'user', password: '12345' }
];

// Create 10 lessons
let LESSONS = [
  { id: 1, title: 'Math Explorers', location: 'Room 1', price: 12.5, spaces: 10, icon: 'fa-calculator' },
  { id: 2, title: 'Science Lab', location: 'Lab 3', price: 15.0, spaces: 8, icon: 'fa-flask' },
  { id: 3, title: 'Creative Writing', location: 'Studio C', price: 10.0, spaces: 12, icon: 'fa-pen-fancy' },
  { id: 4, title: 'Chess Club', location: 'Room 2', price: 9.5, spaces: 6, icon: 'fa-chess' },
  { id: 5, title: 'Robotics', location: 'Lab 2', price: 18.0, spaces: 5, icon: 'fa-robot' },
  { id: 6, title: 'Art & Design', location: 'Studio A', price: 11.0, spaces: 9, icon: 'fa-paint-brush' },
  { id: 7, title: 'Drama Workshop', location: 'Theatre 2', price: 13.0, spaces: 7, icon: 'fa-theater-masks' },
  { id: 8, title: 'Music Makers', location: 'Studio B', price: 14.0, spaces: 10, icon: 'fa-music' },
  { id: 9, title: 'Coding for Kids', location: 'Lab 1', price: 16.0, spaces: 5, icon: 'fa-laptop-code' },
  { id: 10, title: 'Language Club', location: 'Theatre 1', price: 8.0, spaces: 11, icon: 'fa-language' }
];

// Simple auth endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  // return a fake token
  res.json({ token: 'token-' + username });
});

app.get('/api/lessons', (req, res) => {
  // GET /api/lessons
  // Returns the full list of lessons. Used by the frontend to populate the shop.
  res.json(LESSONS);
});

// NOTE: The legacy POST /api/adjust-spaces endpoint was removed.
// Space updates are now performed via the RESTful PUT
// /api/lessons/:id/spaces endpoint when an order is submitted.

// PUT /api/lessons/:id/spaces
// RESTful endpoint to update the available spaces for a lesson.
// Body: { delta: number }  (negative to decrement, positive to increment)
// This is suitable for updating availability after an order is submitted.
app.put('/api/lessons/:id/spaces', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { delta } = req.body;
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) return res.status(404).json({ message: 'Lesson not found' });
  if (typeof delta !== 'number') return res.status(400).json({ message: 'Invalid delta' });
  if (lesson.spaces + delta < 0) return res.status(400).json({ message: 'Not enough spaces' });
  lesson.spaces += delta;
  res.json({ lesson });
});

// Checkout endpoint (no real payment) — verify name & phone server-side too
app.post('/api/checkout', (req, res) => {
  const { name, phone, items } = req.body;
  // Sync validation with the frontend rules:
  // Name: letters and spaces only, minimum 2 chars
  // Phone: digits only, 7-20 digits
  const nameValid = /^[A-Za-z ]{2,}$/.test((name || '').trim());
  const phoneValid = /^\d{7,20}$/.test((phone || '').replace(/\D/g, ''));
  if (!nameValid || !phoneValid) return res.status(400).json({ message: 'Invalid name or phone' });
  // In a real app you'd create an order. Here return success and echo order id.
  // Generate a random, hard-to-guess order id using Node's crypto API
  res.json({ success: true, orderId: 'ORD-' + randomUUID() });
});

// Endpoints to inspect server logs collected by the logger middleware
app.get('/api/logs', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_LOGS);
  res.json(LOGS.slice(-limit).reverse());
});

app.get('/api/logs/:id', (req, res) => {
  const entry = LOGS.find(l => l.id === req.params.id);
  if (!entry) return res.status(404).json({ message: 'Log not found' });
  res.json(entry);
});

// Image serving endpoint: returns images from `public/images/{name}`.
// If the file doesn't exist, returns a JSON 404 response.
app.get('/images/:name', (req, res) => {
  const name = req.params.name || '';
  const safeName = path.basename(name); // prevent path traversal
  const imagesDir = path.join(__dirname, '..', 'public', 'images');
  const filePath = path.join(imagesDir, safeName);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.sendFile(filePath);
  });
});

// existing image (should return 200 and the SVG)
// http://localhost:3000/images/sample.svg

//  missing image (should return 404 and JSON body)
//  http://localhost:3000/images/does-not-exist.png

// Serve other static frontend assets from the repository-level `public/`
// (the `public` folder is a sibling of `backend/`, so move up one level)
app.use(express.static(path.join(__dirname, '..', 'public')));

// open on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));