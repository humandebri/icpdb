// Where: scripts/icpdb-http-table-format.mjs
// What: Shared terminal table and CSV formatting primitives for the ICPDB HTTP CLI.
// Why: Turso-like shell and inspect output should evolve without expanding command execution code.

export function formatRecordTable(records) {
  if (records.length === 0) return "(empty)";
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return formatTable(columns, records.map((record) => columns.map((column) => valueToDisplay(record[column]))));
}

export function formatTable(columns, rows) {
  const widths = columns.map((column, index) =>
    Math.max(String(column).length, ...rows.map((row) => String(row[index] ?? "").length))
  );
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  const header = columns.map((column, index) => String(column).padEnd(widths[index], " ")).join(" | ");
  const body = rows.map((row) =>
    row.map((cell, index) => String(cell ?? "").padEnd(widths[index], " ")).join(" | ")
  );
  return [header, separator, ...body].join("\n");
}

export function formatCsvRecords(records) {
  if (records.length === 0) return "";
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return formatCsvRows(columns, records.map((record) => columns.map((column) => valueToDisplay(record[column]))));
}

export function formatCsvRows(columns, rows) {
  return [
    columns.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map((cell) => escapeCsvField(String(cell ?? ""))).join(","))
  ].join("\n");
}

export function escapeCsvField(value) {
  const escaped = value.replaceAll("\"", "\"\"");
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function valueToDisplay(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function sqlValueToDisplay(value) {
  if (value === null || value === "null") return "NULL";
  if (typeof value !== "object") return String(value);
  if (Object.hasOwn(value, "integer")) return String(value.integer);
  if (Object.hasOwn(value, "Integer")) return String(value.Integer);
  if (Object.hasOwn(value, "real")) return String(value.real);
  if (Object.hasOwn(value, "Real")) return String(value.Real);
  if (Object.hasOwn(value, "text")) return String(value.text);
  if (Object.hasOwn(value, "Text")) return String(value.Text);
  if (Object.hasOwn(value, "blob")) return `<${value.blob.length} bytes>`;
  if (Object.hasOwn(value, "Blob")) return `<${value.Blob.length} bytes>`;
  return JSON.stringify(value);
}
