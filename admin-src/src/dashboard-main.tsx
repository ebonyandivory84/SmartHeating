import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardApp } from './Dashboard';
import './dashboard.css';

const rawInstance = new URLSearchParams(window.location.search).get('instance') ?? '0';
const instanceMatch = rawInstance.match(/(\d+)$/);
const instance = instanceMatch ? Number(instanceMatch[1]) : 0;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardApp adapterInstance={`smartheating.${instance}`} />
  </React.StrictMode>
);
