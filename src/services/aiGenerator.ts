import { AIMessageParams, CurrencyType } from '../types';

export function formatCurrency(amount: number, currency: CurrencyType): string {
  if (currency === 'MAD') {
    return `${amount.toLocaleString('fr-FR')} DH`;
  }
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}

interface MessageTemplate {
  greeting: string;
  hook: string;
  body: string;
  urgency: string;
  cta: string;
}

export function generateCommercialScript(params: AIMessageParams): string {
  const {
    productName,
    targetAudience,
    price,
    currency,
    objective,
    tone,
    prospectName,
    sellerName = 'notre boutique'
  } = params;

  const nameGreeting = prospectName ? `Bonjour ${prospectName} ! ` : 'Bonjour ! ';
  const priceDisplay = price ? (price.includes('DH') || price.includes('FCFA') ? price : `${price} ${currency === 'MAD' ? 'DH' : 'FCFA'}`) : '';

  // Tone variations
  let toneEmoji = '✨';
  let toneVibe = '';
  if (tone === 'amical') {
    toneEmoji = '😊✨';
    toneVibe = 'J’espère que vous passez une excellente journée !';
  } else if (tone === 'pro') {
    toneEmoji = '🤝💼';
    toneVibe = 'Je me permets de vous contacter avec une solution exclusive.';
  } else if (tone === 'urgent') {
    toneEmoji = '⚡🔥';
    toneVibe = 'Attention, opportunité à durée très limitée !';
  } else if (tone === 'persuasif') {
    toneEmoji = '🌟🎯';
    toneVibe = 'Vous méritez ce qu’il y a de meilleur pour votre style et votre quotidien.';
  }

  let text = '';

  switch (objective) {
    case 'prospection': {
      text = `${nameGreeting}${toneEmoji}\n\n` +
        `${toneVibe}\n\n` +
        `Je viens de recevoir une nouveauté très demandée qui va particulièrement vous plaire : *${productName}* !\n\n` +
        `💎 *Pourquoi nos clients l'adorent ?*\n` +
        `• Qualité premium garantie & finitions impeccables\n` +
        `• Conçu spécialement pour ${targetAudience || 'nos clients les plus exigeants'}\n` +
        `• Livraison express sécurisée & paiement facile à la réception\n\n` +
        (priceDisplay ? `🏷️ *Tarif exclusif :* *${priceDisplay}* seulement\n\n` : '') +
        `📦 Les stocks de cette première série partent très vite !\n\n` +
        `Souhaitez-vous que je vous réserve une pièce ou que je vous envoie d'autres photos détaillées ? Répondez-moi simplement ici ! 📲`;
      break;
    }

    case 'relance': {
      text = `${nameGreeting}👋\n\n` +
        `J'espère que vous allez bien ! Je fais un petit suivi suite à votre intérêt pour : *${productName}*.\n\n` +
        `Avez-vous eu le temps d'y réfléchir ? 😊\n\n` +
        `💡 Sachez que nous préparons les expéditions du jour. Si vous validez maintenant :\n` +
        `✅ Votre commande part dès aujourd'hui\n` +
        (priceDisplay ? `✅ Vous profitez toujours du prix préférentiel de *${priceDisplay}*\n` : '') +
        `✅ Vérification possible à la livraison\n\n` +
        `Dites-moi si vous souhaitez finaliser votre livraison ou si vous avez la moindre question !`;
      break;
    }

    case 'objections': {
      text = `${nameGreeting}🙏\n\n` +
        `Je comprends parfaitement vos hésitations concernant *${productName}*, et c'est tout à fait normal de vouloir être 100% sûr(e) de son choix.\n\n` +
        `Permettez-moi de vous rassurer en toute transparence :\n` +
        `🛡️ *Garantie Sérénité :* Vous inspectez le colis à l'arrivée avant tout engagement.\n` +
        `⭐ *Témoignages vérifiés :* Plus de 95% de nos clients nous recommandent pour la fiabilité de nos produits.\n` +
        (priceDisplay ? `💰 *Rapport Qualité/Prix :* À *${priceDisplay}*, c'est un investissement durable et rentable.\n\n` : '\n') +
        `Puis-je vous envoyer une courte vidéo démonstrative du produit en vrai pour vous faire votre propre avis ?`;
      break;
    }

    case 'promo': {
      text = `🚨 *VENTE FLASH & OFFRE EXCLUSIVE* 🚨\n\n` +
        `${nameGreeting}${toneEmoji}\n\n` +
        `C'est le moment d'en profiter ! Nous lançons une promotion exceptionnelle sur notre best-seller : *${productName}* !\n\n` +
        `🎁 *Votre Avantage Privilège :*\n` +
        (priceDisplay ? `👉 *Prix Spécial Flash :* ~${priceDisplay}~ *(Remise immédiate déduite)*\n` : '') +
        `👉 Valable uniquement jusqu'à épuisement du stock réservé\n` +
        `👉 Idéal pour ${targetAudience || 'vous faire plaisir'}\n\n` +
        `⏳ *Il ne reste que quelques exemplaires disponibles à ce tarif !*\n\n` +
        `Pour en profiter avant la fin du stock, répondez vite *"JE COMMANDE"* par message ! ⚡🛍️`;
      break;
    }

    default:
      text = `${nameGreeting}\n\nDécouvrez notre sélection spéciale : *${productName}* !\n` +
        (priceDisplay ? `Prix : *${priceDisplay}*\n\n` : '\n') +
        `Contactez-nous directement pour commander ou avoir plus d'informations.`;
  }

  return text;
}

// Generate AI product descriptions
export function generateProductDescription(name: string, category?: string, keywords?: string): string {
  const templates = [
    `✨ Découvrez notre incontournable *${name}*, alliant élégance, durabilité et finitions haut de gamme. Conçu avec des matériaux rigoureusement sélectionnés pour vous apporter confort et satisfaction quotidienne.\n\n` +
    `Points forts :\n` +
    `• Qualité supérieure & design soigné\n` +
    `• Parfait pour un usage quotidien ou un cadeau prestigieux\n` +
    `• ${keywords ? `Spécificités : ${keywords}` : 'Livraison rapide et soignée garantie'}\n\n` +
    `Commander en direct sur WhatsApp pour une prise en charge immédiate !`,

    `🌟 *${name}* — L'alliance parfaite entre authenticité et modernité.\n\n` +
    `Ce modèle est plébiscité par nos clients pour sa robustesse et son raffinement unique. ${keywords ? `Comprend : ${keywords}.` : 'Fabriqué avec passion et savoir-faire.'}\n\n` +
    `🚚 Expédition rapide sous 24/48h. Service client WhatsApp disponible 7j/7 pour répondre à toutes vos questions.`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}
