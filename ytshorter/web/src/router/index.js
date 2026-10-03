import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import { applyPageMeta } from '../i18n/index.js';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  {
    path: '/jobs',
    name: 'library',
    component: () => import('../views/LibraryView.vue'),
  },
  {
    path: '/jobs/:id',
    name: 'job',
    component: () => import('../views/JobView.vue'),
    props: true,
  },
  {
    path: '/jobs/:id/clips',
    name: 'results',
    component: () => import('../views/ResultsView.vue'),
    props: true,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notFound',
    component: () => import('../views/NotFoundView.vue'),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  applyPageMeta(to.name ?? 'home');
});
