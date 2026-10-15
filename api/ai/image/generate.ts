import { handleAIImageGenerate } from '../../../src/server/geminiService.ts';

/**
 * Route Serverless Vercel pour la génération d'images promotionnelles
 * Endpoint de production : POST /api/ai/image/generate
 */
export default async function handler(req: any, res: any) {
  return handleAIImageGenerate(req, res);
}
