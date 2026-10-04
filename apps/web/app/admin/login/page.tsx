import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="container">
      <LoginForm forbidden={error === 'forbidden'} />
    </div>
  );
}
