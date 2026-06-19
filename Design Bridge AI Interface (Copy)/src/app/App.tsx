import { RouterProvider } from 'react-router';
import { router } from './routes';

// AuthGate now wraps only the private app branch (see routes.tsx). Public Helpdesk pages
// (/help/:slug) render outside the gate — no Bridge account required.
export default function App() {
  return <RouterProvider router={router} />;
}
