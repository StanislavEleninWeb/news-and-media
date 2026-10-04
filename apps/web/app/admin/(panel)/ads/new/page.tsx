import Link from 'next/link';
import { AdForm } from '@/components/admin/AdForm';

export const metadata = { title: 'New ad' };

export default function NewAdPage() {
  return (
    <>
      <p className="hint">
        <Link href="/admin/ads">← Ads</Link>
      </p>
      <h1>New ad</h1>
      <section className="panel" style={{ maxWidth: 860 }}>
        <AdForm />
      </section>
    </>
  );
}
