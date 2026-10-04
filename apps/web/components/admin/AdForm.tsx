import type { adSlots } from '@nm/db/schema';
import { placementSizes } from '@nm/services/admin/ads';
import { saveAdAction } from '@/app/admin/(panel)/ads/actions';
import { ActionForm } from './ActionForm';

type Ad = typeof adSlots.$inferSelect;
const toLocalInput = (date: Date | null | undefined) =>
  date
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : '';

export function AdForm({ ad }: { ad?: Ad }) {
  return (
    <ActionForm action={saveAdAction}>
      {ad ? <input type="hidden" name="id" value={ad.id} /> : null}
      <div className="form-grid">
        <label className="field">
          Internal name
          <input className="input" name="name" defaultValue={ad?.name} required />
        </label>
        <label className="field">
          Placement
          <select className="select" name="placement" defaultValue={ad?.placement ?? 'feed_inline'}>
            {Object.entries(placementSizes).map(([key, size]) => (
              <option key={key} value={key}>
                {size.label} ({size.width}×{size.height})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Language
          <select className="select" name="locale" defaultValue={ad?.locale ?? ''}>
            <option value="">Both</option>
            <option value="bg">Bulgarian pages</option>
            <option value="en">English pages</option>
          </select>
        </label>
        <label className="field">
          Type
          <select className="select" name="kind" defaultValue={ad?.kind ?? 'direct'}>
            <option value="direct">Direct-sold (wins over house ads)</option>
            <option value="house">House ad (fallback)</option>
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label className="field">
          Advertiser
          <input className="input" name="advertiser" defaultValue={ad?.advertiser ?? ''} />
        </label>
        <label className="field">
          Weight (rotation share)
          <input
            className="input"
            name="weight"
            type="number"
            min={1}
            max={100}
            defaultValue={ad?.weight ?? 1}
          />
        </label>
        <label className="field">
          Starts (optional)
          <input
            className="input"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(ad?.startsAt)}
          />
        </label>
        <label className="field">
          Ends (optional)
          <input
            className="input"
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocalInput(ad?.endsAt)}
          />
        </label>
      </div>
      <label className="field">
        Creative — upload (JPG/PNG/WebP, max 5 MB; re-encoded to WebP)
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp" />
      </label>
      <label className="field">
        …or image URL (https)
        <input
          className="input"
          name="imageUrl"
          defaultValue={ad?.imageUrl ?? ''}
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        Click-through URL
        <input
          className="input"
          name="targetUrl"
          type="url"
          defaultValue={ad?.targetUrl}
          required
          style={{ width: '100%' }}
        />
      </label>
      <label className="field">
        Alt text (describes the ad for screen readers)
        <input
          className="input"
          name="altText"
          defaultValue={ad?.altText}
          required
          style={{ width: '100%' }}
        />
      </label>
      <label className="check">
        <input type="checkbox" name="isActive" defaultChecked={ad?.isActive ?? true} /> Active
      </label>
      <div>
        <button className="button" type="submit">
          {ad ? 'Save ad' : 'Create ad'}
        </button>
      </div>
    </ActionForm>
  );
}
