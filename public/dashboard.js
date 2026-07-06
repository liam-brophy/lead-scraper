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

function currentFilters() {
  return {
    search: document.getElementById('filterSearch').value.trim(),
    status: document.getElementById('filterStatus').value,
    source: document.getElementById('filterSource').value,
    minScore: document.getElementById('filterMinScore').value,
  };
}

function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  return usp.toString();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function renderLeads(leads) {
  const tbody = document.getElementById('leadsBody');
  tbody.innerHTML = '';

  const sources = new Set();

  for (const lead of leads) {
    sources.add(lead.source);
    const tr = document.createElement('tr');

    const siteCell = lead.site_url
      ? `<a href="${escapeHtml(lead.site_url)}" target="_blank" rel="noopener">visit</a>`
      : '<span class="muted">none</span>';

    const emailCell = lead.email
      ? `${escapeHtml(lead.email)} <span class="badge badge-${escapeHtml(lead.email_confidence)}">${escapeHtml(lead.email_confidence)}</span>`
      : '<span class="muted">—</span>';

    tr.innerHTML = `
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

  const sourceSelect = document.getElementById('filterSource');
  const selectedSource = sourceSelect.value;
  sourceSelect.innerHTML =
    '<option value="">All sources</option>' +
    [...sources].sort().map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sourceSelect.value = selectedSource;

  tbody.querySelectorAll('.status-select').forEach((el) => {
    el.addEventListener('change', () => patchLead(el.dataset.id, { status: el.value }));
  });
  tbody.querySelectorAll('.notes-input').forEach((el) => {
    el.addEventListener('blur', () => patchLead(el.dataset.id, { notes: el.value }));
  });
}

async function patchLead(id, body) {
  try {
    await fetchJSON(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

async function loadLeads() {
  const qs = buildQuery(currentFilters());
  const leads = await fetchJSON(`/api/leads${qs ? '?' + qs : ''}`);
  renderLeads(leads);
}

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
      loadLeads();
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
  if (!query) return alert('Enter a category to search for.');
  startJob('/api/scrape/local', {
    query,
    city: document.getElementById('placesCity').value.trim(),
  });
});

document.getElementById('runDirectoryBtn').addEventListener('click', () => {
  startJob('/api/scrape/directory', { recipe: document.getElementById('directoryRecipe').value });
});

document.getElementById('runEnrichBtn').addEventListener('click', () => {
  startJob('/api/enrich', { limit: Number(document.getElementById('enrichLimit').value) || 50 });
});

document.getElementById('applyFiltersBtn').addEventListener('click', loadLeads);

loadRecipes();
loadLeads();
