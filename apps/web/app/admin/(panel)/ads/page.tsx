import Link from 'next/link';
import { getDb } from '@nm/db';
import { listAds, placementSizes } from '@nm/services/admin/ads';
import { getAdServerConfig } from '@nm/services/content/ads';
import { gamAdUnitPath } from '@nm/contracts';

export const metadata = { title: 'Ads' };

const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone: 'Europe/Sofia' });

export default async function AdsPage() {
  const ads = await listAds(getDb());
  const server = getAdServerConfig();
  const now = new Date();
  return (
    <>
      <h1>Ads</h1>
      <div className="admin-toolbar">
        <Link className="button" href="/admin/ads/new">
          + New ad
        </Link>
        <span className="hint">
          Direct-sold ads win over house ads in the same placement. Impressions and clicks are
          counted only for readers who accepted cookies.
        </span>
      </div>
      <div className="panel">
        {server.provider === 'gam' && server.gam ? (
          <>
            <p>
              <strong>Ad server: Google Ad Manager</strong> (network {server.gam.networkCode}).
              Campaigns, programmatic demand, frequency caps and reporting are managed in Ad
              Manager. The creatives below are shown only when Ad Manager returns nothing.
            </p>
            <p className="hint">
              Consent: {server.gam.cmpScriptUrl ? 'Google CMP (TCF)' : 'none — limited ads only'} ·
              Header bidding: {server.prebid ? 'Prebid on' : 'off'} · Ad units:{' '}
              {Object.keys(placementSizes)
                .map((p) => gamAdUnitPath(server.gam!, p))
                .join(', ')}
            </p>
          </>
        ) : (
          <p>
            <strong>Ad server: built-in</strong> — the creatives below are all that is served. Set{' '}
            <code>ADS_PROVIDER=gam</code> to switch to Google Ad Manager.
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ad</th>
              <th>Placement</th>
              <th>Schedule</th>
              <th>Impressions</th>
              <th>Clicks</th>
              <th>CTR</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const live =
                ad.isActive &&
                (!ad.startsAt || ad.startsAt <= now) &&
                (!ad.endsAt || ad.endsAt >= now);
              return (
                <tr key={ad.id}>
                  <td>
                    <Link href={`/admin/ads/${ad.id}`}>{ad.name}</Link>{' '}
                    <span className={`status status--${live ? 'ok' : 'pending'}`}>
                      {live ? 'live' : 'not live'}
                    </span>
                    <div className="hint">
                      {ad.kind} · {ad.advertiser ?? '—'} · {ad.locale ?? 'bg + en'}
                    </div>
                  </td>
                  <td>{placementSizes[ad.placement].label}</td>
                  <td>
                    {ad.startsAt ? fmt.format(ad.startsAt) : '…'} →{' '}
                    {ad.endsAt ? fmt.format(ad.endsAt) : '…'}
                  </td>
                  <td>{ad.impressions.toLocaleString('en-GB')}</td>
                  <td>{ad.clicks.toLocaleString('en-GB')}</td>
                  <td>
                    {ad.impressions ? `${((ad.clicks / ad.impressions) * 100).toFixed(2)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
