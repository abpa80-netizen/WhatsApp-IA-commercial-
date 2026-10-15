import { handleAIChat } from '../../src/server/geminiService.ts';

/**
 * Route Serverless Vercel pour le Coach Commercial & Assistant IA WhatsApp
 * Endpoint de production : POST /api/ai/chat
 * 
 * Cette fonction serverless est automatiquement reconnue par Vercel et résout
 * l'erreur 404 lors du déploiement en production.
 */
export default async function handler(req: any, res: any) {
  return handleAIChat(req, res);
}
