require('dotenv').config();

const path = require('path');
const express = require('express');
const pLimit = require('p-limit');

const db = require('./db');
const auth = require('./auth');
const { runJob, getJob } = require('./jobs');
const googlePlaces = require('./scrapers/googlePlaces');
const directoryScraper = require('./scrapers/directoryScraper');
const { enrichLead } = require('./enrich');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway terminates TLS in front of the app; needed for req.secure to be accurate

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// -- Unauthenticated routes --------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', auth.handleLogin);
app.post('/logout', auth.handleLogout);

// -- Everything below requires the dashboard password ------------------------
app.use(auth.requireAuth);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/leads', async (req, res, next) => {
  try {
    const { status, source, minScore, search, queued } = req.query;
    const leads = await db.listLeads({ status, source, minScore, search, queued });
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/leads/:id', async (req, res, next) => {
  try {
    const { status, notes, queued } = req.body;
    const lead = await db.patchLead(req.params.id, { status, notes, queued });
    if (!lead) return res.status(404).json({ error: 'not found' });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

app.get('/api/recipes', (req, res) => {
  res.json(directoryScraper.listRecipes());
});

app.post('/api/scrape/local', (req, res) => {
  const { query, city, maxPages } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const job = runJob('scrape-local', async () => {
    const leads = await googlePlaces.scrapeLocal({ query, city, maxPages });
    for (const lead of leads) await db.upsertLead(lead);
    return { count: leads.length };
  });
  res.status(202).json(job);
});

app.post('/api/scrape/directory', (req, res) => {
  const { recipe } = req.body;
  if (!recipe) return res.status(400).json({ error: 'recipe is required' });

  const job = runJob(`scrape-directory:${recipe}`, async () => {
    const { leads, blocked, reason } = await directoryScraper.scrapeDirectory(recipe);
    if (blocked) return { blocked: true, reason };
    for (const lead of leads) await db.upsertLead(lead);
    return { count: leads.length };
  });
  res.status(202).json(job);
});

app.post('/api/enrich', (req, res) => {
  const limit = Number(req.body.limit) || 50;

  const job = runJob('enrich', async () => {
    const leads = await db.getLeadsPendingEnrichment(limit);
    const limiter = pLimit(5);
    let count = 0;
    await Promise.all(
      leads.map((lead) =>
        limiter(async () => {
          await enrichLead(lead);
          count += 1;
        })
      )
    );
    return { count };
  });
  res.status(202).json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function start() {
  await db.migrate();
  app.listen(PORT, () => console.log(`Lead pipeline listening on :${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
