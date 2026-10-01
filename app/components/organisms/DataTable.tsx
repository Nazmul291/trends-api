import React from "react";
import { Skeleton } from "../atoms/Skeleton";

export interface ColumnDef<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  loading = false,
  emptyMessage = "No records found.",
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div
      style={{
        width: "100%",
        overflowX: "auto",
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e1e3e5",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead>
          <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e1e3e5" }}>
            {columns.map((col, idx) => (
              <th
                key={idx}
                style={{
                  padding: "12px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#6d7175",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  width: col.width,
                  textAlign: col.align || "left",
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, rIdx) => (
              <tr key={rIdx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                {columns.map((_, cIdx) => (
                  <td key={cIdx} style={{ padding: "12px 16px" }}>
                    <Skeleton height="16px" width={cIdx === 0 ? "80%" : "60%"} />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: "48px 16px",
                  textAlign: "center",
                  color: "#6d7175",
                  fontSize: "13px",
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, rowIdx) => (
              <tr
                key={rowIdx}
                onClick={() => onRowClick?.(item)}
                style={{
                  borderBottom: "1px solid #f1f2f3",
                  cursor: onRowClick ? "pointer" : "default",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (onRowClick) e.currentTarget.style.backgroundColor = "#f9fafb";
                }}
                onMouseLeave={(e) => {
                  if (onRowClick) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {columns.map((col, cIdx) => (
                  <td
                    key={cIdx}
                    style={{
                      padding: "12px 16px",
                      fontSize: "13px",
                      color: "#202223",
                      textAlign: col.align || "left",
                    }}
                  >
                    {col.cell
                      ? col.cell(item)
                      : col.accessorKey
                      ? String(item[col.accessorKey] ?? "-")
                      : "-"}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
