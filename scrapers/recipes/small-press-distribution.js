const { BlockedError } = require('../../lib');

// Checked live 2026-07-06: spdbooks.org is inconsistent but effectively unscrapable
// with a plain HTTP fetch. Direct curl requests got a flat 403 (edge/WAF block).
// Node's fetch sometimes gets a 200, but the body is just a consent-manager (CMP)
// shell with no real markup -- the actual site only renders after JS runs and the
// cookie-consent flow completes. Either path means no compliant static-HTML scrape
// is possible here. Per the no-evasion rule (no header spoofing, no headless-browser
// bypass of the consent gate), this recipe detects that shell and reports itself
// blocked rather than pretending to have working selectors.
async function scrape({ fetchPage }) {
  const html = await fetchPage('https://www.spdbooks.org/');

  const looksLikeConsentShell = html.includes('cmp_getsupportedLangs') || !/href="\/[a-z]/i.test(html);
  if (looksLikeConsentShell) {
    throw new BlockedError('spdbooks.org served a JS-only consent-manager shell, not real page content');
  }

  return [];
}

module.exports = { category: 'literary-publisher', scrape };
