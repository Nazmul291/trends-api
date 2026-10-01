import React from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "variant"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: "#008060",
    color: "#ffffff",
    border: "1px solid #008060",
  },
  secondary: {
    backgroundColor: "#f6f6f7",
    color: "#202223",
    border: "1px solid #c9cccf",
  },
  outline: {
    backgroundColor: "transparent",
    color: "#202223",
    border: "1px solid #babfc3",
  },
  ghost: {
    backgroundColor: "transparent",
    color: "#202223",
    border: "none",
  },
  destructive: {
    backgroundColor: "#d82c0d",
    color: "#ffffff",
    border: "1px solid #d82c0d",
  },
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  style,
  ...rest
}) => {
  const isSm = size === "sm";
  const isLg = size === "lg";

  const padding = isSm ? "6px 12px" : isLg ? "12px 24px" : "8px 16px";
  const fontSize = isSm ? "12px" : isLg ? "15px" : "13px";

  return (
    <button
      disabled={disabled || loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: "8px",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        transition: "all 0.15s ease-in-out",
        boxShadow: variant === "primary" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
        ...VARIANT_STYLES[variant],
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <span
          style={{
            width: "14px",
            height: "14px",
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "trends-spin 0.6s linear infinite",
          }}
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
};
