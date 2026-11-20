import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder: the real screens arrive in later tasks.
const root = document.getElementById('root');
if (!root) throw new Error('#root ontbreekt in index.html');

createRoot(root).render(
  <StrictMode>
    <h1>Werkplekinspectie</h1>
  </StrictMode>,
);
