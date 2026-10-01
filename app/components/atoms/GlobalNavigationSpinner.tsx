import React from "react";
import { useNavigation } from "react-router";

export interface GlobalNavigationSpinnerProps {
  /** Optional custom loading message */
  message?: string;
}

export const GlobalNavigationSpinner: React.FC<GlobalNavigationSpinnerProps> = ({
  message = "Loading...",
}) => {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading" || navigation.state === "submitting";

  if (!isNavigating) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page content"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "14px",
        backgroundColor: "rgba(255, 255, 255, 0.65)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        pointerEvents: "auto",
        cursor: "wait",
        animation: "trends-fade-in 0.15s ease-out forwards",
      }}
    >
      <style>{`
        @keyframes trends-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes trends-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* Polaris styled spinner container */}
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "16px",
          backgroundColor: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)",
          border: "1px solid rgba(225, 227, 229, 0.8)",
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            animation: "trends-spin 0.75s cubic-bezier(0.4, 0, 0.2, 1) infinite",
          }}
        >
          {/* Background Track */}
          <circle
            cx="16"
            cy="16"
            r="12"
            stroke="#e1e3e5"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Active Spinning Arc (Shopify Green) */}
          <circle
            cx="16"
            cy="16"
            r="12"
            stroke="#008060"
            strokeWidth="3.5"
            strokeDasharray="75.398"
            strokeDashoffset="52"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {message && (
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "#202223",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            padding: "4px 12px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
            border: "1px solid #e1e3e5",
            letterSpacing: "0.01em",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
};
