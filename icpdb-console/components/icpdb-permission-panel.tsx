"use client";

// icpdb-console/components/icpdb-permission-panel.tsx
// Database member permission grant, search, role filtering, and revoke controls.

import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { parseDatabaseRole } from "@/lib/workbench-state";
import { formatTimestamp } from "@/components/icpdb-token-panel";
import type { DatabaseMember, DatabaseRole } from "@/lib/types";

export function PermissionPanel({
  canGrantMember,
  canMutateMembers,
  memberPrincipal,
  memberRole,
  members,
  principal,
  onGrantMember,
  onMemberPrincipalChange,
  onMemberRoleChange,
  onRevokeMember
}: {
  canGrantMember: boolean;
  canMutateMembers: boolean;
  memberPrincipal: string;
  memberRole: DatabaseRole;
  members: DatabaseMember[];
  principal: string | null;
  onGrantMember: () => void;
  onMemberPrincipalChange: (value: string) => void;
  onMemberRoleChange: (role: DatabaseRole) => void;
  onRevokeMember: (member: DatabaseMember) => void;
}) {
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");
  const memberRoleCounts = useMemo(() => countMemberRoles(members), [members]);
  const visibleMembers = useMemo(() => filterMembers(members, memberSearch, roleFilter), [memberSearch, members, roleFilter]);
  const memberFiltered = memberSearch.trim() || roleFilter !== "all";
  const memberCountLabel = memberFiltered ? `${visibleMembers.length}/${members.length}` : String(members.length);
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Permissions</h3>
        <Users aria-hidden size={16} />
      </div>
      <div className="mt-3 grid gap-2">
        <input className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]" value={memberPrincipal} onChange={(event) => onMemberPrincipalChange(event.target.value)} />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]" value={memberRole} onChange={(event) => onMemberRoleChange(parseDatabaseRole(event.target.value))}>
            <option value="reader">reader</option>
            <option value="writer">writer</option>
            <option value="owner">owner</option>
          </select>
          <button className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canGrantMember} type="button" onClick={onGrantMember}>
            Grant
          </button>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 text-xs text-[#667085]">
          <Search aria-hidden size={14} />
          <input
            aria-label="Search members"
            className="min-w-0 flex-1 bg-transparent font-mono text-[#182230] outline-none"
            placeholder="Search members"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
          />
          <span className="font-mono">{memberCountLabel}</span>
        </label>
        <div className="grid grid-cols-4 overflow-hidden rounded-md border border-[#c9ced8] text-xs">
          {memberRoleFilters.map((filter) => (
            <button
              aria-pressed={roleFilter === filter.value}
              className={roleFilter === filter.value ? activeMemberFilterClass : inactiveMemberFilterClass}
              key={filter.value}
              type="button"
              onClick={() => setRoleFilter(filter.value)}
            >
              <span>{filter.label}</span>
              <span className="font-mono">{memberRoleCountLabel(filter.value, memberRoleCounts)}</span>
            </button>
          ))}
        </div>
        {members.length === 0 ? <p className="text-xs text-[#667085]">No members</p> : null}
        {members.length > 0 && visibleMembers.length === 0 ? <p className="text-xs text-[#667085]">No matching members</p> : null}
        {visibleMembers.map((member) => (
          <div className="rounded-md border border-[#eef1f5] p-2 text-xs" key={member.principal}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono" title={member.principal}>{member.principal}</span>
              <span className="text-[#5f6c7b]">{member.role}</span>
            </div>
            <div className="mt-2 text-[#5f6c7b]">granted {formatTimestamp(member.createdAtMs)}</div>
            <button className="mt-2 rounded-md border border-[#fecdca] px-2 py-1 font-medium text-[#b42318] disabled:opacity-50" disabled={!canMutateMembers || member.principal === principal} type="button" onClick={() => onRevokeMember(member)}>
              Revoke access
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type MemberRoleFilter = "all" | DatabaseRole;

const memberRoleFilters: { label: string; value: MemberRoleFilter }[] = [
  { label: "All", value: "all" },
  { label: "Reader", value: "reader" },
  { label: "Writer", value: "writer" },
  { label: "Owner", value: "owner" }
];

function filterMembers(members: DatabaseMember[], memberSearch: string, roleFilter: MemberRoleFilter): DatabaseMember[] {
  const query = memberSearch.trim().toLowerCase();
  return members.filter((member) => {
    if (roleFilter !== "all" && member.role !== roleFilter) return false;
    if (!query) return true;
    const fields = [
      member.principal,
      member.role,
      formatTimestamp(member.createdAtMs)
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  });
}

function countMemberRoles(members: DatabaseMember[]): Record<MemberRoleFilter, number> {
  return {
    all: members.length,
    reader: members.filter((member) => member.role === "reader").length,
    writer: members.filter((member) => member.role === "writer").length,
    owner: members.filter((member) => member.role === "owner").length
  };
}

function memberRoleCountLabel(filter: MemberRoleFilter, counts: Record<MemberRoleFilter, number>): string {
  return String(counts[filter]);
}

const activeMemberFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-[#182230] px-1 font-medium text-white";
const inactiveMemberFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-white px-1 text-[#5f6c7b] hover:bg-[#f7f8fb]";
