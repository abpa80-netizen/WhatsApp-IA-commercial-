import { handleCreateOrder } from '../../src/server/ordersService.ts';

/**
 * Route Serverless Vercel pour la création publique et sécurisée des commandes VIP
 * Endpoint de production : POST /api/orders/create
 * 
 * Cette fonction serverless est automatiquement reconnue par Vercel.
 * Elle garantit que :
 * 1. Le vendeur possède un abonnement VIP actif (l'essai ou l'expiration sont refusés).
 * 2. Les prix et totaux sont calculés côté serveur d'après le catalogue Firestore officiel.
 * 3. La commande est enregistrée dans /users/{uid}/orders/{orderId} avec le statut 'Nouveau'.
 */
export default async function handler(req: any, res: any) {
  return handleCreateOrder(req, res);
}
