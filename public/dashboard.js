const STATUS_OPTIONS = ['new', 'contacted', 'replied', 'booked', 'dead'];

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

// Local (Philadelphia) vs Literary (nationwide directories) -- derived from
// source rather than stored separately, since source already encodes it.
function leadType(lead) {
  return lead.source === 'google_places'
    ? { label: 'Local', className: 'type-local' }
    : { label: 'Literary', className: 'type-literary' };
}

function relativeTime(isoString) {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function patchLead(id, body) {
  try {
    await fetchJSON(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    setJobStatus(`Failed to save: ${err.message}`, true);
  }
}

// -- Tabs ---------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('homeView').hidden = tab !== 'home';
    document.getElementById('libraryView').hidden = tab !== 'library';
    if (tab === 'library') loadLibrary();
  });
});

// -- Status panel ---------------------------------------------------------
function renderStatus({ summary, runs }) {
  const grid = document.getElementById('statGrid');
  grid.innerHTML = `
    <div class="stat"><div class="stat-value">${summary.primeTargets}</div><div class="stat-label">Prime targets</div></div>
    <div class="stat"><div class="stat-value">${summary.pendingEnrichment}</div><div class="stat-label">Being reviewed</div></div>
    <div class="stat"><div class="stat-value">${summary.queued}</div><div class="stat-label">In library</div></div>
    <div class="stat"><div class="stat-value">${summary.totalLeads}</div><div class="stat-label">Total leads</div></div>
  `;

  const lastRunEl = document.getElementById('lastRun');
  const [latest] = runs;
  if (!latest) {
    lastRunEl.textContent = 'Automation hasn’t run yet — the first run starts shortly.';
    return;
  }
  if (latest.status === 'running') {
    lastRunEl.textContent = `Running now — started ${relativeTime(latest.started_at)}.`;
    return;
  }
  const parts = [];
  if (latest.local_scraped_count !== null) parts.push(`${latest.local_scraped_count} local`);
  if (latest.literary_blocked) parts.push('literary source blocked');
  else if (latest.literary_scraped_count) parts.push(`${latest.literary_scraped_count} literary`);
  if (latest.enriched_count !== null) parts.push(`${latest.enriched_count} enriched`);
  const detail = parts.length ? ` — ${parts.join(', ')}` : '';
  const failed = latest.status === 'error' ? ` (failed: ${escapeHtml(latest.error || 'unknown error')})` : '';
  lastRunEl.textContent = `Last run: ${relativeTime(latest.started_at)}${detail}${failed}`;
}

async function loadStatus() {
  const data = await fetchJSON('/api/status');
  renderStatus(data);
}

// -- Prime targets (Home) --------------------------------------------------
function renderPrimeTargets(leads) {
  const tbody = document.getElementById('primeBody');
  tbody.innerHTML = '';
  document.getElementById('primeEmpty').hidden = leads.length > 0;

  for (const lead of leads) {
    const type = leadType(lead);
    const tr = document.createElement('tr');
    const siteCell = lead.site_url
      ? `<a href="${escapeHtml(lead.site_url)}" target="_blank" rel="noopener">visit</a>`
      : '<span class="muted">none</span>';
    const emailCell = lead.email
      ? `${escapeHtml(lead.email)} <span class="badge badge-${escapeHtml(lead.email_confidence)}">${escapeHtml(lead.email_confidence)}</span>`
      : '<span class="muted">—</span>';

    tr.innerHTML = `
      <td><span class="type-badge ${type.className}">${type.label}</span></td>
      <td class="score">${lead.fit_score ?? '—'}</td>
      <td>${escapeHtml(lead.name)}</td>
      <td>${escapeHtml(lead.category)}</td>
      <td>${escapeHtml(lead.city)}</td>
      <td>${siteCell}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${emailCell}</td>
      <td class="actions">
        <button class="add-to-library" data-id="${lead.id}">+ Library</button>
        <button class="link-button not-a-fit" data-id="${lead.id}">Not a fit</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.add-to-library').forEach((el) => {
    el.addEventListener('click', async () => {
      await patchLead(el.dataset.id, { queued: true });
      loadPrimeTargets();
      loadStatus();
    });
  });
  tbody.querySelectorAll('.not-a-fit').forEach((el) => {
    el.addEventListener('click', async () => {
      await patchLead(el.dataset.id, { status: 'dead' });
      loadPrimeTargets();
      loadStatus();
    });
  });
}

async function loadPrimeTargets() {
  const leads = await fetchJSON('/api/prime-targets');
  renderPrimeTargets(leads);
}

// -- Library ---------------------------------------------------------------
function renderLibrary(leads) {
  const tbody = document.getElementById('libraryBody');
  tbody.innerHTML = '';
  document.getElementById('libraryEmpty').hidden = leads.length > 0;

  for (const lead of leads) {
    const type = leadType(lead);
    const tr = document.createElement('tr');
    const siteCell = lead.site_url
      ? `<a href="${escapeHtml(lead.site_url)}" target="_blank" rel="noopener">visit</a>`
      : '<span class="muted">none</span>';
    const emailCell = lead.email
      ? `${escapeHtml(lead.email)} <span class="badge badge-${escapeHtml(lead.email_confidence)}">${escapeHtml(lead.email_confidence)}</span>`
      : '<span class="muted">—</span>';

    tr.innerHTML = `
      <td><button class="queue-toggle queued" data-id="${lead.id}" title="Remove from library">★</button></td>
      <td><span class="type-badge ${type.className}">${type.label}</span></td>
      <td class="score">${lead.fit_score ?? '—'}</td>
      <td>${escapeHtml(lead.name)}</td>
      <td>${escapeHtml(lead.category)}</td>
      <td>${escapeHtml(lead.city)}</td>
      <td>${siteCell}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${emailCell}</td>
      <td>
        <select class="status-select" data-id="${lead.id}">
          ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === lead.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input class="notes-input" data-id="${lead.id}" value="${escapeHtml(lead.notes)}" /></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.status-select').forEach((el) => {
    el.addEventListener('change', () => patchLead(el.dataset.id, { status: el.value }));
  });
  tbody.querySelectorAll('.notes-input').forEach((el) => {
    el.addEventListener('blur', () => patchLead(el.dataset.id, { notes: el.value }));
  });
  tbody.querySelectorAll('.queue-toggle').forEach((el) => {
    el.addEventListener('click', async () => {
      await patchLead(el.dataset.id, { queued: false });
      loadLibrary();
      loadStatus();
    });
  });
}

async function loadLibrary() {
  const params = new URLSearchParams({ queued: 'true' });
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('filterSearch').value.trim();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const leads = await fetchJSON(`/api/leads?${params.toString()}`);
  renderLibrary(leads);
}

document.getElementById('applyLibraryFiltersBtn').addEventListener('click', loadLibrary);

// -- Manual scrape (advanced) -----------------------------------------------
async function loadRecipes() {
  const recipes = await fetchJSON('/api/recipes');
  const select = document.getElementById('directoryRecipe');
  select.innerHTML = recipes.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
}

function setJobStatus(text, isError) {
  const el = document.getElementById('jobStatus');
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function refreshHome() {
  loadStatus();
  loadPrimeTargets();
}

async function pollJob(jobId) {
  while (true) {
    const job = await fetchJSON(`/api/jobs/${jobId}`);
    if (job.status === 'running') {
      setJobStatus(`${job.type}: running…`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    if (job.status === 'done') {
      const result = job.result || {};
      const msg = result.blocked
        ? `${job.type}: blocked (${result.reason})`
        : `${job.type}: done, ${result.count ?? 0} leads`;
      setJobStatus(msg, !!result.blocked);
      refreshHome();
      return;
    }
    setJobStatus(`${job.type}: failed — ${job.error}`, true);
    return;
  }
}

async function startJob(url, body) {
  try {
    const job = await fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setJobStatus(`${job.type}: started…`);
    pollJob(job.id);
  } catch (err) {
    setJobStatus(`Failed to start: ${err.message}`, true);
  }
}

document.getElementById('runPlacesBtn').addEventListener('click', () => {
  const query = document.getElementById('placesQuery').value.trim();
  if (!query) return setJobStatus('Enter a category to search for (e.g. "bakery").', true);
  startJob('/api/scrape/local', {
    query,
    city: document.getElementById('placesCity').value.trim() || undefined,
  });
});

document.getElementById('runDirectoryBtn').addEventListener('click', () => {
  startJob('/api/scrape/directory', { recipe: document.getElementById('directoryRecipe').value });
});

document.getElementById('runEnrichBtn').addEventListener('click', () => {
  startJob('/api/enrich', { limit: Number(document.getElementById('enrichLimit').value) || 50 });
});

loadRecipes();
refreshHome();
