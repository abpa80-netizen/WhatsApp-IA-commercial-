import { handleListOrders } from '../../src/server/ordersManagementService.ts';

export default async function handler(req: any, res: any) {
  return handleListOrders(req, res);
}
