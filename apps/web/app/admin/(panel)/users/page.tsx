import { getDb } from '@nm/db';
import { listUsers } from '@nm/services/admin/dashboard';
import { requireStaff } from '@/lib/admin-auth';
import { changeRole } from '../actions';

export const metadata = { title: 'Users' };

const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone: 'Europe/Sofia' });

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await requireStaff('admin');
  const { q } = await searchParams;
  const users = await listUsers(getDb(), q);
  return (
    <>
      <h1>Users</h1>
      <form className="admin-toolbar">
        <input className="input" name="q" defaultValue={q} placeholder="Search by email…" />
        <button className="button" type="submit">
          Search
        </button>
      </form>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Email</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.email}
                  {user.name ? <div className="hint">{user.name}</div> : null}
                </td>
                <td>{fmt.format(user.createdAt)}</td>
                <td>{user.lastLoginAt ? fmt.format(user.lastLoginAt) : '—'}</td>
                <td>
                  {user.id === me.id ? (
                    user.role
                  ) : (
                    <form action={changeRole} className="admin-toolbar" style={{ margin: 0 }}>
                      <input type="hidden" name="userId" value={user.id} />
                      <select className="select" name="role" defaultValue={user.role}>
                        <option value="reader">reader</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                      </select>
                      <button className="button button--ghost" type="submit">
                        Set
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
