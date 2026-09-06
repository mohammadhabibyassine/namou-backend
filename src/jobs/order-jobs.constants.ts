export const OrderQueue = {
  Name: 'orders',
  Confirm: 'order-confirmation',
} as const;

export interface OrderConfirmationJobData {
  orderId: string;
}
