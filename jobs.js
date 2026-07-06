const crypto = require('crypto');

// In-memory only -- fine for a solo-user tool checked a few times a day; a restart
// (e.g. a redeploy) losing an in-flight job's status is an acceptable trade-off
// against the complexity of a real job queue for this volume.
const jobs = new Map();

function createJob(type) {
  const job = {
    id: crypto.randomUUID(),
    type,
    status: 'running',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  return job;
}

// Kicks off an async task in the background and returns its job record immediately.
function runJob(type, taskFn) {
  const job = createJob(type);
  Promise.resolve()
    .then(taskFn)
    .then((result) => {
      job.status = 'done';
      job.result = result;
      job.finishedAt = new Date().toISOString();
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message || String(err);
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

module.exports = { runJob, getJob };
