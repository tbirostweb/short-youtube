import { defineStore } from 'pinia';
import { api } from '../lib/api.js';

const PAGE_SIZE = 20;

// Historique des générations. Sans lui, un job dont on a fermé l'onglet est
// définitivement perdu de vue.
export const useLibraryStore = defineStore('library', {
  state: () => ({
    jobs: [],
    total: 0,
    offset: 0,
    loading: false,
    error: null,
    deletingId: null,
  }),

  getters: {
    hasMore: (state) => state.jobs.length < state.total,
    isEmpty: (state) => !state.loading && state.jobs.length === 0,
  },

  actions: {
    async load({ append = false } = {}) {
      this.loading = true;
      this.error = null;
      try {
        const offset = append ? this.jobs.length : 0;
        const data = await api.listJobs({ limit: PAGE_SIZE, offset });
        this.jobs = append ? [...this.jobs, ...data.jobs] : data.jobs;
        this.total = data.total;
        this.offset = offset;
      } catch (err) {
        this.error = { code: err?.code ?? 'INTERNAL', message: err?.message ?? '' };
      } finally {
        this.loading = false;
      }
    },

    async remove(jobId) {
      this.deletingId = jobId;
      this.error = null;
      try {
        await api.deleteJob(jobId);
        this.jobs = this.jobs.filter((job) => job.id !== jobId);
        this.total = Math.max(0, this.total - 1);
        return true;
      } catch (err) {
        this.error = { code: err?.code ?? 'INTERNAL', message: err?.message ?? '' };
        return false;
      } finally {
        this.deletingId = null;
      }
    },
  },
});
