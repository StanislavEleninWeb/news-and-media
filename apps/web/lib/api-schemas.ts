import { z } from 'zod';
import { localeSchema } from '@nm/services/content/contracts';

export const slugParam = z.string().regex(/^[a-z0-9-]{1,64}$/);
export const idParam = z.string().uuid();
export const pageParams = {
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
};
export const localeParam = { locale: localeSchema.default('bg') };
