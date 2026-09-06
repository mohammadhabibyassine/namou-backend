export interface CategoryTreeRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  depth: number;
}

export interface CategoryTreeNode extends CategoryTreeRow {
  children: CategoryTreeNode[];
}
