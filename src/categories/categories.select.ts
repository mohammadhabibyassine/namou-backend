import { Prisma } from '../generated/prisma/client.js';

export const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;
