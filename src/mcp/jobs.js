// In-memory extraction jobs for the MCP server. An extraction takes 5–30s,
// longer than many clients will wait on one tool call, so extract_design
// returns a job id at once and the other tools read the finished design by id.

import { randomUUID } from 'crypto';

export function createJobStore({ extract, maxJobs = 20 } = {}) {
  const jobs = new Map();

  function view(job) {
    const { id, url, status, startedAt, finishedAt, error } = job;
    return { job_id: id, url, status, startedAt, ...(finishedAt && { finishedAt }), ...(error && { error }) };
  }

  function evictOldestFinished() {
    for (const [id, j] of jobs) {
      if (j.status !== 'running') { jobs.delete(id); return; }
    }
  }

  return {
    start(url, options = {}) {
      const job = { id: randomUUID(), url, status: 'running', startedAt: new Date().toISOString() };
      jobs.set(job.id, job);
      // Keep a long session from holding every design it ever extracted.
      if (jobs.size > maxJobs) evictOldestFinished();
      job.promise = Promise.resolve()
        .then(() => extract(url, options))
        .then(
          (design) => { if (job.status === 'running') { job.status = 'done'; job.design = design; } },
          (err) => { if (job.status === 'running') { job.status = 'failed'; job.error = err?.message || String(err); } },
        )
        .finally(() => { job.finishedAt ||= new Date().toISOString(); });
      return view(job);
    },
    get(id) {
      return jobs.get(id) || null;
    },
    view,
    list() {
      return [...jobs.values()].map(view);
    },
    // Playwright work can't be interrupted mid-page; a cancelled job's result
    // is discarded when it lands.
    cancel(id) {
      const job = jobs.get(id);
      if (!job) return null;
      if (job.status === 'running') {
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
      }
      return view(job);
    },
  };
}
