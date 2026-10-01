import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  prefixIcon?: React.ReactNode;
  onClear?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  prefixIcon,
  onClear,
  value,
  style,
  ...rest
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
      {label && (
        <label style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
        {prefixIcon && (
          <span
            style={{
              position: "absolute",
              left: "12px",
              color: "#6d7175",
              display: "flex",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            {prefixIcon}
          </span>
        )}
        <input
          value={value}
          style={{
            width: "100%",
            padding: prefixIcon ? "8px 36px 8px 36px" : "8px 12px",
            fontSize: "13px",
            color: "#202223",
            backgroundColor: "#ffffff",
            border: `1px solid ${error ? "#d82c0d" : "#babfc3"}`,
            borderRadius: "8px",
            outline: "none",
            transition: "border-color 0.15s ease",
            ...style,
          }}
          {...rest}
        />
        {onClear && value && (
          <button
            type="button"
            onClick={onClear}
            style={{
              position: "absolute",
              right: "10px",
              background: "none",
              border: "none",
              color: "#8c9196",
              cursor: "pointer",
              fontSize: "14px",
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        )}
      </div>
      {error && <span style={{ fontSize: "12px", color: "#d82c0d" }}>{error}</span>}
    </div>
  );
};
