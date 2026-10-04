import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireStaff } from '@/lib/admin-auth';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

const links = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/articles?status=needs_review', label: 'Review queue' },
  { href: '/admin/articles', label: 'Articles' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/topics', label: 'Topics' },
  { href: '/admin/ads', label: 'Ads' },
  { href: '/admin/runs', label: 'Runs & jobs' },
];

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="Admin">
        <Link className="brand" href="/admin">
          Newsroom<span className="brand__dot">.</span>
        </Link>
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
        {user.role === 'admin' ? <Link href="/admin/users">Users</Link> : null}
        <Link href="/bg" target="_blank">
          View site ↗
        </Link>
        <small>
          {user.email} · {user.role}
        </small>
        <form action={signOut}>
          <button
            className="text-button"
            style={{ color: '#fff', paddingLeft: '0.6rem' }}
            type="submit"
          >
            Sign out
          </button>
        </form>
      </nav>
      <div className="admin__main">{children}</div>
    </div>
  );
}
