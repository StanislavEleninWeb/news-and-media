'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@nm/db';
import { adInputSchema, deleteAd, saveAd, storeAdCreative } from '@nm/services/admin/ads';
import { getStorage } from '@nm/services/storage';
import { requireStaff } from '@/lib/admin-auth';
import type { ActionState } from '../actions';

const str = (form: FormData, key: string) => String(form.get(key) ?? '');

export async function saveAdAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  let id = str(form, 'id') || undefined;
  try {
    let imageUrl = str(form, 'imageUrl');
    const upload = form.get('image');
    if (upload instanceof File && upload.size > 0) {
      if (upload.size > 5 * 1024 * 1024) return { error: 'Image must be under 5 MB.' };
      imageUrl = await storeAdCreative(getStorage(), Buffer.from(await upload.arrayBuffer()));
    }
    const input = adInputSchema.parse({
      name: str(form, 'name'),
      placement: str(form, 'placement'),
      locale: str(form, 'locale'),
      kind: str(form, 'kind'),
      advertiser: str(form, 'advertiser'),
      imageUrl,
      targetUrl: str(form, 'targetUrl'),
      altText: str(form, 'altText'),
      weight: str(form, 'weight') || '1',
      frequencyCapPerDay: str(form, 'frequencyCapPerDay'),
      startsAt: str(form, 'startsAt'),
      endsAt: str(form, 'endsAt'),
      isActive: form.get('isActive') === 'on',
    });
    const row = await saveAd(getDb(), input, id ? z.string().uuid().parse(id) : undefined);
    id = row?.id;
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    return { error: (error as Error).message };
  }
  revalidatePath('/admin/ads');
  redirect(`/admin/ads/${id}?saved=1`);
}

export async function deleteAdAction(form: FormData) {
  await requireStaff();
  await deleteAd(getDb(), z.string().uuid().parse(str(form, 'id')));
  revalidatePath('/admin/ads');
  redirect('/admin/ads');
}
