"use client";

// icpdb-console/components/icpdb-table-editor-panel.tsx
// Supabase-style table editor panel: composes table grid, schema metadata, and row/cell mutation controls.

import { RowEditorPanel } from "@/components/icpdb-row-editor-panel";
import { TableDataPanel } from "@/components/icpdb-table-data-panel";
import { TableOverviewPanel } from "@/components/icpdb-table-overview-panel";
import { TableSchemaPanel } from "@/components/icpdb-table-schema-panel";
import type { RowMutation } from "@/lib/row-mutations";
import type { DatabaseColumn, DatabaseTable, TableDescription, TablePreviewResponse } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";

type TableEditorPanelProps = {
  canEditRows: boolean;
  canMutateSelectedRow: boolean;
  canUpdateCell: boolean;
  cellValue: string;
  editableColumns: DatabaseColumn[];
  loadState: LoadState;
  primaryKeyColumns: DatabaseColumn[];
  rowJson: string;
  selectedCellColumnName: string;
  selectedRowIndex: number | null;
  selectedTable: DatabaseTable | null;
  tableDescription: TableDescription | null;
  tableLimit: number;
  tableOffset: number;
  tablePreview: TablePreviewResponse | null;
  onCellValueChange: (value: string) => void;
  onChangeSelectedCellColumn: (columnName: string) => void;
  onChangeTableLimit: (value: string) => void;
  onLoadTablePage: (offset: number) => void;
  onMutateRow: (mutation: RowMutation) => void;
  onRowJsonChange: (value: string) => void;
  onSelectPreviewCell: (rowIndex: number, columnName: string) => void;
  onSelectPreviewRow: (rowIndex: number) => void;
  onStartNewRow: () => void;
  onUpdateCell: () => void;
};

export function TableEditorPanel(props: TableEditorPanelProps) {
  return (
    <div className="space-y-3">
      <TableDataPanel
        canUpdateCell={props.canUpdateCell}
        cellValue={props.cellValue}
        editableColumns={props.editableColumns}
        loadState={props.loadState}
        selectedCellColumnName={props.selectedCellColumnName}
        selectedRowIndex={props.selectedRowIndex}
        selectedTable={props.selectedTable}
        tableDescription={props.tableDescription}
        tableLimit={props.tableLimit}
        tableOffset={props.tableOffset}
        tablePreview={props.tablePreview}
        onCellValueChange={props.onCellValueChange}
        onChangeTableLimit={props.onChangeTableLimit}
        onLoadTablePage={props.onLoadTablePage}
        onSelectPreviewCell={props.onSelectPreviewCell}
        onSelectPreviewRow={props.onSelectPreviewRow}
        onUpdateCell={props.onUpdateCell}
      />
      <TableOverviewPanel
        selectedCellColumnName={props.selectedCellColumnName}
        selectedRowIndex={props.selectedRowIndex}
        tableDescription={props.tableDescription}
        tablePreview={props.tablePreview}
      />
      <TableSchemaPanel tableDescription={props.tableDescription} />
      <RowEditorPanel
        canEditRows={props.canEditRows}
        canMutateSelectedRow={props.canMutateSelectedRow}
        canUpdateCell={props.canUpdateCell}
        cellValue={props.cellValue}
        editStatus={rowEditorStatus(props)}
        editableColumns={props.editableColumns}
        primaryKeyColumns={props.primaryKeyColumns}
        rowJson={props.rowJson}
        selectedCellColumnName={props.selectedCellColumnName}
        onCellValueChange={props.onCellValueChange}
        onChangeSelectedCellColumn={props.onChangeSelectedCellColumn}
        onMutateRow={props.onMutateRow}
        onRowJsonChange={props.onRowJsonChange}
        onStartNewRow={props.onStartNewRow}
        onUpdateCell={props.onUpdateCell}
      />
    </div>
  );
}

function rowEditorStatus(props: TableEditorPanelProps): string {
  if (!props.selectedTable) return "Select a table to inspect rows.";
  if (!props.tableDescription) return "Load table metadata to inspect rows.";
  if (props.selectedTable.objectType !== "table") return "Views are read-only.";
  if (!props.canEditRows) return "Rows are read-only for this session or database state.";
  if (props.primaryKeyColumns.length === 0) return "Insert is available; update/delete require a primary key.";
  return "Row editing enabled.";
}
