import { handleUpdateOrderStatus } from '../../src/server/ordersManagementService.ts';

/** Authenticated seller/admin endpoint for updating an order status. */
export default async function handler(req: any, res: any) {
  return handleUpdateOrderStatus(req, res);
}
