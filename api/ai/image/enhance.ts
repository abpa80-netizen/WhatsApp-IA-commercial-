import { handleAIImageEnhance } from '../../../src/server/geminiService.ts';

/**
 * Route Serverless Vercel pour la sublimation de photo produit
 * Endpoint de production : POST /api/ai/image/enhance
 */
export default async function handler(req: any, res: any) {
  return handleAIImageEnhance(req, res);
}
