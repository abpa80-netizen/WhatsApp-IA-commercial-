import { handleRecalculateEntitlements } from '../../src/server/entitlementsService.ts';

/**
 * Route Serverless Vercel pour le recalcul des droits et expirations
 * Endpoint de production : GET / POST /api/admin/recalculate-entitlements
 * 
 * Utilisé par :
 * 1. Tâche planifiée Vercel Cron (GET avec Authorization: Bearer <CRON_SECRET>)
 * 2. Déclenchement manuel sécurisé depuis le tableau de bord Admin foosco80@gmail.com
 */
export default async function handler(req: any, res: any) {
  return handleRecalculateEntitlements(req, res);
}
