import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Register Progressive Web App Service Worker for offline capability
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] ServiceWorker registration failed:', err);
    });
  });
}

export default app;
