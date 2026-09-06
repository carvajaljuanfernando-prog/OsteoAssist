import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import VerificationScreen from "./ui/VerificationScreen.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <VerificationScreen />
  </React.StrictMode>
);
