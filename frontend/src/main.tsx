import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import { StoreProvider } from "./store";
import { ApprovalProvider } from "./components/Approval";
import Shell from "./components/Shell";
import HomePage from "./pages/Home";
import HelpersPage from "./pages/Helpers";
import HelperPage from "./pages/Helper";
import NewHelperPage from "./pages/NewHelper";
import WaitingPage from "./pages/Waiting";
import ActivityPage from "./pages/Activity";
import SendPage from "./pages/Send";
import YouPage from "./pages/You";
import WelcomePage from "./pages/Welcome";
import LoginPage from "./pages/Login";

const router = createBrowserRouter([
  { path: "/welcome", element: <WelcomePage /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/", element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "helpers", element: <HelpersPage /> },
      { path: "helpers/new", element: <NewHelperPage /> },
      { path: "helpers/:id", element: <HelperPage /> },
      { path: "waiting", element: <WaitingPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "send", element: <SendPage /> },
      { path: "you", element: <YouPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <ApprovalProvider>
        <RouterProvider router={router} />
      </ApprovalProvider>
    </StoreProvider>
  </StrictMode>,
);
