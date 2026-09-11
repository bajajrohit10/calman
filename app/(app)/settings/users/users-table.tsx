"use client";

import { useActionState, useState } from "react";

import { Badge, Button, ErrorNote, Field, Input, Select, cx } from "@/components/ui";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/roles";

import {
  changeRole,
  createUser,
  resetPassword,
  setActive,
  type ActionResult,
} from "./actions";
import type { UserRow } from "./page";

const EMPTY: ActionResult = { error: null };

function roleTone(role: Role) {
  if (role === "super_admin") return "accent" as const;
  if (role === "manager") return "info" as const;
  return "neutral" as const;
}

/** A Manager may not create or edit a Super Admin. Mirrored server-side. */
function canManage(callerRole: Role, targetRole: Role) {
  return callerRole === "super_admin" || targetRole !== "super_admin";
}

function Result({ state }: { state: ActionResult }) {
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  if (state.ok)
    return (
      <p className="rounded-md border border-ok/40 bg-ok-soft px-2.5 py-1.5 text-[12.5px] text-ok">
        {state.ok}
      </p>
    );
  return null;
}

function CreateUserPanel({ callerRole }: { callerRole: Role }) {
  const [state, action] = useActionState(createUser, EMPTY);
  const [open, setOpen] = useState(false);

  const assignable = ROLES.filter((r) => callerRole === "super_admin" || r !== "super_admin");

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add user
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="w-full rounded-lg border border-line bg-surface shadow-card p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-ink">New user</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Field label="Full name">
          <Input name="full_name" required autoFocus placeholder="Asha Menon" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required placeholder="asha@zeroinfy.in" />
        </Field>
        <Field label="Password" hint="At least 6 characters. Tell them directly.">
          <Input name="password" type="text" required minLength={6} />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue="counsellor">
            {assignable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="primary">
          Create account
        </Button>
        <span className="text-[12px] text-ink-3">
          No email is sent. The account works immediately.
        </span>
      </div>

      <div className="mt-3 empty:mt-0">
        <Result state={state} />
      </div>
    </form>
  );
}

function RoleCell({
  user,
  callerRole,
  callerId,
}: {
  user: UserRow;
  callerRole: Role;
  callerId: string;
}) {
  const [state, action] = useActionState(changeRole, EMPTY);
  const editable =
    canManage(callerRole, user.role) && !(user.id === callerId);
  const assignable = ROLES.filter((r) => callerRole === "super_admin" || r !== "super_admin");

  if (!editable) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone={roleTone(user.role)}>{ROLE_LABELS[user.role]}</Badge>
        {user.id === callerId ? (
          <span className="text-[11px] text-ink-3">you</span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1.5">
      <Select
        // The select is uncontrolled, so React keeps whatever the user picked
        // and ignores a changed defaultValue. Keying on the saved role forces a
        // fresh element once the action lands, so the cell shows what is now
        // stored rather than the stale choice.
        key={user.role}
        name="role"
        defaultValue={user.role}
        className="w-[132px]"
        aria-label={`Role for ${user.fullName || user.email}`}
      >
        {assignable.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <input type="hidden" name="user_id" value={user.id} />
      <Button type="submit" size="sm" variant="ghost">
        Save
      </Button>
      {state.error ? (
        <span className="text-[11px] text-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span className="text-[11px] text-ok" role="status">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}

function ResetPasswordCell({ user }: { user: UserRow }) {
  const [state, action] = useActionState(resetPassword, EMPTY);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Reset password
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input type="hidden" name="user_id" value={user.id} />
        <Input
          name="password"
          type="text"
          required
          minLength={6}
          autoFocus
          placeholder="New password"
          className="w-[160px]"
          aria-label={`New password for ${user.fullName || user.email}`}
        />
        <Button type="submit" size="sm" variant="primary">
          Set
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.error ? (
        <span className="text-[11px] text-danger" role="alert">
          {state.error}
        </span>
      ) : null}
      {state.ok ? <span className="text-[11px] text-ok">{state.ok}</span> : null}
    </form>
  );
}

function ActiveCell({
  user,
  callerRole,
  callerId,
}: {
  user: UserRow;
  callerRole: Role;
  callerId: string;
}) {
  const [state, action] = useActionState(setActive, EMPTY);
  const isSelf = user.id === callerId;
  // A Manager may not touch a Super Admin. The server refuses anyway, but
  // offering the button and then refusing is worse than not offering it —
  // and it left this cell contradicting the role and password cells, which
  // both lock a Super Admin row already.
  const locked = !canManage(callerRole, user.role);
  const reason = isSelf
    ? "You cannot deactivate your own account"
    : locked
      ? "Only a Super Admin can change a Super Admin account"
      : undefined;

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={user.id} />
      <input type="hidden" name="active" value={String(!user.isActive)} />
      {user.isActive ? (
        <Badge tone="ok">Active</Badge>
      ) : (
        <Badge tone="danger">Inactive</Badge>
      )}
      <Button
        type="submit"
        size="sm"
        variant={user.isActive ? "ghost" : "secondary"}
        disabled={isSelf || locked}
        title={reason}
      >
        {user.isActive ? "Deactivate" : "Reactivate"}
      </Button>
      {state.error ? (
        <span className="text-[11px] text-danger" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function UsersTable({
  users,
  callerRole,
  callerId,
}: {
  users: UserRow[];
  callerRole: Role;
  callerId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">
            Users <span className="font-normal text-ink-3">({users.length})</span>
          </h2>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-ink-2">
            Accounts are never deleted — deactivate instead, which blocks sign-in and
            denies every query on the next request.
          </p>
        </div>
        <CreateUserPanel callerRole={callerRole} />
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              {["Name", "Email", "Role", "Status", "Last sign-in", "Password"].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-[7px]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className={cx(
                  "border-b border-line last:border-b-0",
                  !user.isActive && "bg-sunk/40 text-ink-3",
                )}
              >
                <td className="px-3 py-[5px] font-medium text-ink">
                  {user.fullName || (
                    <span className="text-danger">No profile row</span>
                  )}
                </td>
                <td className="px-3 py-[5px] text-ink-2">{user.email}</td>
                <td className="px-3 py-[5px]">
                  <RoleCell user={user} callerRole={callerRole} callerId={callerId} />
                </td>
                <td className="px-3 py-[5px]">
                  <ActiveCell user={user} callerRole={callerRole} callerId={callerId} />
                </td>
                <td className="px-3 py-[5px] tabular-nums text-ink-3">
                  {user.lastSignInAt
                    ? new Date(user.lastSignInAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "never"}
                </td>
                <td className="px-3 py-[5px]">
                  {canManage(callerRole, user.role) ? (
                    <ResetPasswordCell user={user} />
                  ) : (
                    <span className="text-[11.5px] text-ink-3">Super Admin only</span>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-3">
                  No accounts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-3">
        There is no email on this project, so there is no self-service password
        reset. Set a password here and pass it to the person directly. A reset
        immediately invalidates their ability to stay signed in beyond their
        current access token; deactivating cuts access off at once.
      </p>
    </div>
  );
}
