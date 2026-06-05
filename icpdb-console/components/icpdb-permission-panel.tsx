"use client";

// icpdb-console/components/icpdb-permission-panel.tsx
// Database member permission grant, search, role filtering, and revoke controls.

import { ClipboardPaste, Copy, Search, Users } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { isValidPrincipalText, normalizeMemberPrincipalInput, parseDatabaseRole } from "@/lib/workbench-state";
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
  const [copiedCallerPrincipal, setCopiedCallerPrincipal] = useState(false);
  const [copiedMemberPrincipal, setCopiedMemberPrincipal] = useState<string | null>(null);
  const [pastedMemberPrincipal, setPastedMemberPrincipal] = useState(false);
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");
  const memberPrincipalInputId = useId();
  const memberPrincipalFeedbackId = `${memberPrincipalInputId}-feedback`;
  const memberRoleCounts = useMemo(() => countMemberRoles(members), [members]);
  const ownerMemberCount = memberRoleCounts.owner;
  const existingMember = useMemo(() => findMemberByPrincipal(members, memberPrincipal), [memberPrincipal, members]);
  const visibleMembers = useMemo(() => filterMembers(members, memberSearch, roleFilter), [memberSearch, members, roleFilter]);
  const memberFiltered = memberSearch.trim() || roleFilter !== "all";
  const memberCountLabel = memberFiltered ? `${visibleMembers.length}/${members.length}` : String(members.length);
  const grantMemberTitle = grantTitle(canMutateMembers, canGrantMember, memberPrincipal, memberRole, principal, existingMember, ownerMemberCount);
  const showMemberPrincipalFeedback = !canGrantMember && (!canMutateMembers || normalizeMemberPrincipalInput(memberPrincipal).length > 0);
  async function copyCallerPrincipal(nextPrincipal: string) {
    await navigator.clipboard.writeText(nextPrincipal);
    setCopiedCallerPrincipal(true);
    window.setTimeout(() => setCopiedCallerPrincipal(false), 1200);
  }
  async function copyMemberPrincipal(nextPrincipal: string) {
    await navigator.clipboard.writeText(nextPrincipal);
    setCopiedMemberPrincipal(nextPrincipal);
    window.setTimeout(() => setCopiedMemberPrincipal((current) => current === nextPrincipal ? null : current), 1200);
  }
  async function pasteMemberPrincipal() {
    const nextPrincipal = await navigator.clipboard.readText();
    onMemberPrincipalChange(normalizeMemberPrincipalInput(nextPrincipal));
    setPastedMemberPrincipal(true);
    window.setTimeout(() => setPastedMemberPrincipal(false), 1200);
  }
  return (
    <div className="mt-4 rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Permissions</h3>
        <Users aria-hidden size={16} />
      </div>
      {principal ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[#eef1f5] bg-[#f7f8fb] px-2 py-1.5 text-xs text-[#5f6c7b]">
          <span>Current caller</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[#182230]" title={principal}>{principal}</span>
          <button
            aria-label="Copy current caller principal"
            className="inline-flex size-7 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#344054]"
            title={copiedCallerPrincipal ? "Copied" : "Copy current caller principal"}
            type="button"
            onClick={() => void copyCallerPrincipal(principal)}
          >
            <Copy aria-hidden size={14} />
          </button>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            aria-label="Member principal"
            aria-describedby={showMemberPrincipalFeedback ? memberPrincipalFeedbackId : undefined}
            aria-invalid={showMemberPrincipalFeedback ? true : undefined}
            className="min-w-0 rounded-md border border-[#c9ced8] bg-white px-3 py-2 font-mono text-sm text-[#182230]"
            placeholder="service-principal"
            title="Member principal"
            value={memberPrincipal}
            onChange={(event) => onMemberPrincipalChange(event.target.value)}
            onPaste={(event) => {
              event.preventDefault();
              onMemberPrincipalChange(normalizeMemberPrincipalInput(event.clipboardData.getData("text")));
            }}
          />
          <button
            aria-label="Paste member principal"
            className="inline-flex size-10 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#344054]"
            title={pastedMemberPrincipal ? "Pasted" : "Paste member principal"}
            type="button"
            onClick={() => void pasteMemberPrincipal()}
          >
            <ClipboardPaste aria-hidden size={16} />
          </button>
        </div>
        {showMemberPrincipalFeedback ? (
          <p className="text-xs text-[#b42318]" id={memberPrincipalFeedbackId}>
            {grantMemberTitle}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            aria-label="Member role"
            className="rounded-md border border-[#c9ced8] bg-white px-3 py-2 text-sm text-[#182230]"
            title="Member role"
            value={memberRole}
            onChange={(event) => onMemberRoleChange(parseDatabaseRole(event.target.value))}
          >
            <option value="reader">reader</option>
            <option value="writer">writer</option>
            <option value="owner">owner</option>
          </select>
          <button
            aria-label="Grant member access"
            className="rounded-md border border-[#2f6fed] bg-[#2f6fed] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!canGrantMember}
            title={grantMemberTitle}
            type="button"
            onClick={onGrantMember}
          >
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
              aria-label={filter.value === "all" ? "Filter members by all roles" : `Filter members by ${filter.label} role`}
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
          <MemberRow
            canMutateMembers={canMutateMembers}
            copiedMemberPrincipal={copiedMemberPrincipal}
            key={member.principal}
            member={member}
            ownerMemberCount={ownerMemberCount}
            principal={principal}
            onCopyMemberPrincipal={copyMemberPrincipal}
            onRevokeMember={onRevokeMember}
          />
        ))}
      </div>
    </div>
  );
}

function MemberRow({
  canMutateMembers,
  copiedMemberPrincipal,
  member,
  ownerMemberCount,
  principal,
  onCopyMemberPrincipal,
  onRevokeMember
}: {
  canMutateMembers: boolean;
  copiedMemberPrincipal: string | null;
  member: DatabaseMember;
  ownerMemberCount: number;
  principal: string | null;
  onCopyMemberPrincipal: (principal: string) => Promise<void>;
  onRevokeMember: (member: DatabaseMember) => void;
}) {
  const isCurrentCaller = member.principal === principal;
  const isLastOwner = member.role === "owner" && ownerMemberCount <= 1;
  const revokeDisabled = !canMutateMembers || isCurrentCaller || isLastOwner;
  const revokeTitle = revokeMemberTitle(canMutateMembers, isCurrentCaller, isLastOwner);
  return (
    <div className="rounded-md border border-[#eef1f5] p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono" title={member.principal}>{member.principal}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label={`Copy member principal ${member.principal}`}
            className="inline-flex size-7 items-center justify-center rounded-md border border-[#c9ced8] bg-white text-[#344054]"
            title={copiedMemberPrincipal === member.principal ? "Copied" : "Copy member principal"}
            type="button"
            onClick={() => void onCopyMemberPrincipal(member.principal)}
          >
            <Copy aria-hidden size={14} />
          </button>
          <span className="text-[#5f6c7b]">{member.role}</span>
        </div>
      </div>
      <div className="mt-2 text-[#5f6c7b]">granted {formatTimestamp(member.createdAtMs)}</div>
      <button
        aria-label={`Revoke access for ${member.principal}`}
        className="mt-2 rounded-md border border-[#fecdca] px-2 py-1 font-medium text-[#b42318] disabled:opacity-50"
        disabled={revokeDisabled}
        title={revokeTitle}
        type="button"
        onClick={() => onRevokeMember(member)}
      >
        Revoke access
      </button>
    </div>
  );
}

function revokeMemberTitle(canMutateMembers: boolean, isCurrentCaller: boolean, isLastOwner: boolean): string {
  if (!canMutateMembers) return "Owner role on a hot database is required";
  if (isCurrentCaller) return "Current caller cannot revoke itself";
  if (isLastOwner) return "Cannot revoke the last owner";
  return "Revoke member access";
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

function findMemberByPrincipal(members: DatabaseMember[], principal: string): DatabaseMember | null {
  const value = normalizeMemberPrincipalInput(principal);
  return members.find((member) => member.principal === value) ?? null;
}

function grantTitle(
  canMutateMembers: boolean,
  canGrantMember: boolean,
  memberPrincipal: string,
  memberRole: DatabaseRole,
  principal: string | null,
  existingMember: DatabaseMember | null,
  ownerMemberCount: number
): string {
  if (canGrantMember) return existingMember ? `Update member role from ${existingMember.role} to ${memberRole}` : "Grant member access";
  const value = normalizeMemberPrincipalInput(memberPrincipal);
  if (!canMutateMembers) return "Owner role on a hot database is required";
  if (!value) return "Member principal is required";
  if (value === "2vxsx-fae") return "Anonymous principal cannot be granted database access";
  if (!isValidPrincipalText(value)) return "Member principal must be a valid principal";
  if (principal === value && memberRole !== "owner") return "Current caller cannot downgrade itself";
  if (existingMember?.role === "owner" && memberRole !== "owner" && ownerMemberCount <= 1) return "Cannot downgrade the last owner";
  if (existingMember?.role === memberRole) return "Member already has this role";
  return "Grant member access";
}

const activeMemberFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-[#182230] px-1 font-medium text-white";
const inactiveMemberFilterClass = "flex h-8 min-w-0 items-center justify-center gap-1 bg-white px-1 text-[#5f6c7b] hover:bg-[#f7f8fb]";
