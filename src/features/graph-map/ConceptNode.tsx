import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { VariableRole } from "@/types/contracts";

export interface ConceptNodeData extends Record<string, unknown> {
  variable_id: string;
  label: string;
  paper_count: number;
  roles_seen: VariableRole[];
  degree_centrality: number;
  is_gap_endpoint: boolean;
}

export type ConceptFlowNode = Node<ConceptNodeData, "concept">;

const ROLE_SHORT: Record<VariableRole, string> = {
  independent: "IV",
  dependent: "DV",
  mediator: "Med",
  moderator: "Mod",
  control: "Ctrl",
  outcome: "Out",
};

function ConceptNodeComponent({ data, selected }: NodeProps<ConceptFlowNode>) {
  const scaleRing =
    selected
      ? "border-indigo-600 ring-2 ring-indigo-300 shadow-md"
      : data.is_gap_endpoint
        ? "border-sky-500 ring-2 ring-sky-200 shadow-sm"
        : "border-slate-300 hover:border-slate-400 shadow-xs";

  return (
    <div
      className={`min-w-[196px] max-w-[230px] rounded-xl border bg-white px-3.5 py-2.5 transition ${scaleRing}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-slate-400" />
      <div className="flex items-start justify-between gap-2">
        <div className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">{data.label}</div>
        <span
          className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 tabular-nums"
          title={`${data.paper_count} makalede çalışıldı`}
        >
          {data.paper_count} makale
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {data.roles_seen.map((role) => (
          <span
            key={role}
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.2 text-[10px] font-medium text-slate-600"
          >
            {ROLE_SHORT[role]}
          </span>
        ))}
        {data.is_gap_endpoint && (
          <span className="rounded bg-sky-100 px-1.5 py-0.2 text-[10px] font-semibold text-sky-800">
            Boşluk Adayı
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-indigo-500" />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeComponent);
