import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthSessionProvider } from "./auth/AuthSession";
import { ApiRecoveryBanner } from "./components/ApiRecoveryBanner";

export function App() {
  return (
    <>
      <ApiRecoveryBanner />
      <AuthSessionProvider>
        <RouterProvider router={router} />
      </AuthSessionProvider>
    </>
  );
}
