import { handleUpdateOrderStatus } from '../../src/server/ordersManagementService.ts';

export default async function handler(req: any, res: any) {
  return handleUpdateOrderStatus(req, res);
}
