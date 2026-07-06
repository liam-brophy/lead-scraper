const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreSite, detectBuilder, extractCopyrightYear } = require('../scrapers/siteAnalyzer');

test('scoreSite: solid modern site scores low', () => {
  const score = scoreSite({
    hasSSL: true,
    mobileFriendly: true,
    builder: null,
    staleCopyrightYear: false,
    responseTimeMs: 400,
  });
  assert.equal(score, 0);
});

test('scoreSite: no SSL adds 20', () => {
  assert.equal(scoreSite({ hasSSL: false }), 20);
});

test('scoreSite: not mobile friendly adds 25', () => {
  assert.equal(scoreSite({ mobileFriendly: false }), 25);
});

test('scoreSite: builder fingerprints score by platform', () => {
  assert.equal(scoreSite({ builder: 'wix' }), 15);
  assert.equal(scoreSite({ builder: 'squarespace' }), 15);
  assert.equal(scoreSite({ builder: 'weebly' }), 15);
  assert.equal(scoreSite({ builder: 'wordpress' }), 5);
  assert.equal(scoreSite({ builder: null }), 0);
});

test('scoreSite: stale copyright year adds 20', () => {
  assert.equal(scoreSite({ staleCopyrightYear: true }), 20);
  assert.equal(scoreSite({ staleCopyrightYear: false }), 0);
});

test('scoreSite: slow response over threshold adds 10', () => {
  assert.equal(scoreSite({ responseTimeMs: 5000 }), 10);
  assert.equal(scoreSite({ responseTimeMs: 1000 }), 0);
});

test('scoreSite: fetchFailed or blocked adds 10', () => {
  assert.equal(scoreSite({ fetchFailed: true }), 10);
  assert.equal(scoreSite({ blocked: true }), 10);
});

test('scoreSite: worst-case site clamps at 100', () => {
  const score = scoreSite({
    hasSSL: false,
    mobileFriendly: false,
    builder: 'wix',
    staleCopyrightYear: true,
    responseTimeMs: 9000,
    fetchFailed: true,
  });
  assert.equal(score, 100);
});

test('scoreSite: missing signals default to no penalty', () => {
  assert.equal(scoreSite({}), 0);
  assert.equal(scoreSite(), 0);
});

test('detectBuilder: recognizes known platforms', () => {
  assert.equal(detectBuilder('<html>powered by wixstatic.com</html>'), 'wix');
  assert.equal(detectBuilder('<link href="static1.squarespace.com/x.css">'), 'squarespace');
  assert.equal(detectBuilder('<script src="weeblycloud.com/x.js">'), 'weebly');
  assert.equal(detectBuilder('<link href="/wp-content/themes/foo/style.css">'), 'wordpress');
  assert.equal(detectBuilder('<html>hand rolled</html>'), null);
});

test('extractCopyrightYear: finds a year near a copyright mark', () => {
  assert.equal(extractCopyrightYear('© 2019 Acme Inc.'), 2019);
  assert.equal(extractCopyrightYear('Copyright 2021 Acme Inc. All rights reserved.'), 2021);
  assert.equal(extractCopyrightYear('© Acme Inc, all rights reserved since 1997'), null); // year too far from the mark
  assert.equal(extractCopyrightYear('No date info here'), null);
});
