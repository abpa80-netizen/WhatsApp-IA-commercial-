import { handleCloudinarySign } from '../../src/server/cloudinarySign.ts';

/**
 * Route Serverless Vercel pour la signature Cloudinary
 * Endpoint de production : POST /api/cloudinary/sign
 * 
 * Cette fonction serverless est automatiquement reconnue par Vercel et résout
 * l'erreur 404 lors du déploiement en production.
 */
export default async function handler(req: any, res: any) {
  return handleCloudinarySign(req, res);
}
