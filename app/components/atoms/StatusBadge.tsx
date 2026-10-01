import React from "react";

export type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

export interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
  size?: "sm" | "md";
  dot?: boolean;
}

const TONE_STYLES: Record<BadgeTone, { bg: string; text: string; dot: string; border: string }> = {
  success: {
    bg: "#e6f4ea",
    text: "#137333",
    dot: "#1e8e3e",
    border: "#ceead6",
  },
  warning: {
    bg: "#fef7e0",
    text: "#b06000",
    dot: "#f9ab00",
    border: "#feefc3",
  },
  critical: {
    bg: "#fce8e6",
    text: "#c5221f",
    dot: "#d93025",
    border: "#fad2cf",
  },
  info: {
    bg: "#e8f0fe",
    text: "#1967d2",
    dot: "#1a73e8",
    border: "#d2e3fc",
  },
  neutral: {
    bg: "#f1f3f4",
    text: "#3c4043",
    dot: "#5f6368",
    border: "#dadce0",
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  tone = "neutral",
  size = "md",
  dot = false,
}) => {
  const styles = TONE_STYLES[tone];
  const isSm = size === "sm";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: styles.bg,
        color: styles.text,
        border: `1px solid ${styles.border}`,
        borderRadius: "9999px",
        fontSize: isSm ? "11px" : "12px",
        fontWeight: 600,
        padding: isSm ? "2px 8px" : "4px 10px",
        lineHeight: "1.2",
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: styles.dot,
          }}
        />
      )}
      {label}
    </span>
  );
};
