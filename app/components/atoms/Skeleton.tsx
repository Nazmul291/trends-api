import React from "react";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = "100%",
  height = "16px",
  borderRadius = "6px",
  style,
}) => {
  return (
    <div
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius,
        backgroundColor: "#e8eaed",
        animation: "trends-pulse 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <Skeleton height="180px" borderRadius="8px" />
      <Skeleton width="40%" height="12px" />
      <Skeleton width="80%" height="18px" />
      <Skeleton width="60%" height="14px" />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
        <Skeleton width="30%" height="20px" />
        <Skeleton width="25%" height="20px" borderRadius="12px" />
      </div>
    </div>
  );
};
