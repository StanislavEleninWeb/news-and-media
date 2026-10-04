import Link from 'next/link';

// Rendered inside the locale layout; the language is not known here, so both are shown.
export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: 'center', padding: '4rem 0' }}>
      <h1 className="page-title">404</h1>
      <p>Страницата не е намерена · Page not found</p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link className="button" href="/bg">
          Начало
        </Link>{' '}
        <Link className="button button--ghost" href="/en">
          Home
        </Link>
      </p>
    </div>
  );
}
