import { handleListOrders } from '../../src/server/ordersManagementService.ts';

/** Authenticated seller/admin endpoint for listing structured orders. */
export default async function handler(req: any, res: any) {
  return handleListOrders(req, res);
}
