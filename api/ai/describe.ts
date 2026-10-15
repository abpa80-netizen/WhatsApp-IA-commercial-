import { handleAIDescribe } from '../../src/server/geminiService.ts';

/**
 * Route Serverless Vercel pour le générateur de description produit "Magie IA 🪄"
 * Endpoint de production : POST /api/ai/describe
 */
export default async function handler(req: any, res: any) {
  return handleAIDescribe(req, res);
}
