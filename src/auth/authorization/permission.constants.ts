export const Permission = {
  ManageProducts: 'manage_products',
  ManageCategories: 'manage_categories',
  ManageOrders: 'manage_orders',
  ManageUsers: 'manage_users',
  ViewOrders: 'view_orders',
  ManageChat: 'manage_chat',
  ViewAnalytics: 'view_analytics',
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];
