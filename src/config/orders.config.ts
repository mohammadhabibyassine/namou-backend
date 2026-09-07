import { registerAs, type ConfigType } from '@nestjs/config';

export const ordersConfig = registerAs('orders', () => ({
  pendingTtlMinutes: Number(process.env.PENDING_ORDER_TTL_MINUTES ?? 30),
}));

export type OrdersConfiguration = ConfigType<typeof ordersConfig>;
