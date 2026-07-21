import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthSessionProvider } from "./auth/AuthSession";

export function App() {
  return (
    <AuthSessionProvider>
      <RouterProvider router={router} />
    </AuthSessionProvider>
  );
}
