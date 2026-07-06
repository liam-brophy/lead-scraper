const db = require('./db');
const emailFinder = require('./scrapers/emailFinder');
const siteAnalyzer = require('./scrapers/siteAnalyzer');

// Shared by server.js (POST /api/enrich) and cli.js (enrich command) so the two
// entry points can't drift on how a lead gets its email/score.
async function enrichLead(lead) {
  if (!lead.site_url) {
    // No website at all is itself a strong signal -- flag it as a high-priority
    // "build them one from scratch" prospect rather than skipping enrichment.
    await db.applyEnrichment(lead.id, { signals: { noWebsite: true }, fit_score: 75 });
    return;
  }

  const [emailResult, analysis] = await Promise.all([
    emailFinder.findEmail(lead.site_url),
    siteAnalyzer.analyzeSite(lead.site_url),
  ]);

  await db.applyEnrichment(lead.id, {
    email: emailResult.email,
    email_confidence: emailResult.email_confidence,
    signals: analysis.signals,
    fit_score: analysis.fitScore,
  });
}

module.exports = { enrichLead };
