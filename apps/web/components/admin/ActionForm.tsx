'use client';

import { useActionState, type ReactNode } from 'react';
import type { ActionState } from '@/app/admin/(panel)/actions';

/** Form bound to a server action that reports `{ ok | error }` inline. */
export function ActionForm({
  action,
  children,
  className = 'admin-form',
  confirm,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      className={className}
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      aria-busy={pending}
    >
      {children}
      {state?.error ? (
        <p className="notice notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="notice" role="status">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
