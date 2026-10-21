import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Minus, Plus, ShoppingCart, X } from 'lucide-react';
import { Product, Vendeur, PublicStoreProfile, CurrencyType } from '../types';
import { ApiService } from '../services/api';
import { formatCurrency } from '../services/aiGenerator';

type Seller = Vendeur | PublicStoreProfile;

interface StructuredOrderCheckoutProps {
  open: boolean;
  vendeur: Seller;
  products: Product[];
  cartItems: Record<string, number>;
  setCartItems: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  idempotencyKey: string;
  setIdempotencyKey: (value: string) => void;
  onClose: () => void;
}

export const StructuredOrderCheckout: React.FC<StructuredOrderCheckoutProps> = ({
  open, vendeur, products, cartItems, setCartItems, idempotencyKey, setIdempotencyKey, onClose,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsApp, setCustomerWhatsApp] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ orderId: string; total: number; currency: CurrencyType } | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const cart = Object.entries(cartItems)
    .map(([productId, quantity]) => ({ product: products.find((item) => item.id === productId), quantity }))
    .filter((entry): entry is { product: Product; quantity: number } => Boolean(entry.product && entry.quantity > 0));
  const cartCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);
  const subtotal = Math.round(cart.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0) * 100) / 100;
  const deliveryFee = Math.max(0, Number((vendeur as any).defaultDeliveryFee || 0));
  const estimatedTotal = Math.round((subtotal + deliveryFee) * 100) / 100;

  const updateQuantity = (productId: string, delta: number) => {
    setCartItems((current) => {
      const next = { ...current };
      const quantity = (next[productId] || 0) + delta;
      if (quantity <= 0) delete next[productId];
      else next[productId] = Math.min(1000, quantity);
      return next;
    });
    setIdempotencyKey('');
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cart.length) {
      setError('Votre panier est vide.');
      return;
    }
    setSubmitting(true);
    setError('');
    const key = idempotencyKey || ('ord_idemp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
    setIdempotencyKey(key);
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({
          vendeur_id: vendeur.id,
          customerName: customerName.trim(),
          customerWhatsApp: customerWhatsApp.trim(),
          deliveryAddress: deliveryAddress.trim(),
          notes: notes.trim(),
          deliveryFee,
          items: cart.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.orderId) {
        if (response.status === 409) setIdempotencyKey('');
        throw new Error(data.error || ('Impossible d’enregistrer la commande (HTTP ' + response.status + ').'));
      }
      setResult({ orderId: String(data.orderId), total: Number(data.total || 0), currency: (data.currency === 'MAD' ? 'MAD' : data.currency === 'CFA' ? 'CFA' : vendeur.currency) as CurrencyType });
      const productIds = cart.map(({ product }) => product.id);
      setCartItems({});
      await Promise.allSettled(productIds.map((productId) => ApiService.trackConversion(vendeur.id, productId)));
    } catch (err: any) {
      setError(err?.message || 'Erreur réseau. Vous pouvez réessayer sans risque de doublon.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (setter: (value: string) => void, value: string) => {
    setter(value);
    setIdempotencyKey('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="structured-checkout-title" className="bg-white w-full sm:max-w-xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">Commande sécurisée · VIP</p>
            <h2 id="structured-checkout-title" className="text-xl font-extrabold text-slate-950 mt-1">{result ? 'Commande enregistrée' : 'Finaliser ma commande'}</h2>
            <p className="text-xs text-slate-500 mt-1">Boutique : {vendeur.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-xl bg-slate-100 hover:bg-slate-200 p-2 text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        {result ? (
          <div className="p-6 sm:p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><CheckCircle2 className="w-9 h-9" /></div>
            <h3 className="text-lg font-extrabold text-slate-950">Merci pour votre commande !</h3>
            <p className="text-sm text-slate-600">Référence de commande</p>
            <p className="font-mono text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl p-3 break-all">{result.orderId}</p>
            <p className="text-2xl font-extrabold text-slate-950">{formatCurrency(result.total, result.currency)}</p>
            <p className="text-xs text-slate-500">Conservez cette référence. Le vendeur pourra vous contacter sur WhatsApp pour confirmer la livraison.</p>
            <button type="button" onClick={onClose} className="w-full rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-extrabold px-4 py-3">Terminer</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
            {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}

            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">Votre panier ({cartCount} article{cartCount > 1 ? 's' : ''})</h3>
              {cart.map(({ product, quantity }) => (
                <div key={product.id} className="flex gap-3 items-center border border-slate-100 rounded-xl p-3">
                  <img src={product.images?.[0] || ''} alt="" className="w-14 h-14 rounded-lg object-cover bg-slate-100" />
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold text-slate-800">{product.name}</p><p className="text-xs text-slate-500">{formatCurrency(product.price, vendeur.currency)} l’unité</p></div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateQuantity(product.id, -1)} aria-label={'Retirer une unité de ' + product.name} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                    <span className="w-5 text-center text-sm font-bold">{quantity}</span>
                    <button type="button" onClick={() => updateQuantity(product.id, 1)} aria-label={'Ajouter une unité de ' + product.name} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600"><span>Sous-total estimé</span><span>{formatCurrency(subtotal, vendeur.currency)}</span></div>
                <div className="flex justify-between text-slate-600"><span>Livraison (tarif défini par la boutique)</span><span>{formatCurrency(deliveryFee, vendeur.currency)}</span></div>
                <div className="border-t border-slate-200 pt-2 flex justify-between font-extrabold text-slate-950"><span>Total estimé</span><span>{formatCurrency(estimatedTotal, vendeur.currency)}</span></div>
                <p className="text-[11px] leading-relaxed text-slate-500">Les prix et frais de livraison sont recalculés côté serveur à partir des paramètres de la boutique.</p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">Informations de livraison</h3>
              <label className="block text-xs font-bold text-slate-700">Nom complet
                <input required maxLength={100} autoComplete="name" value={customerName} onChange={(e) => updateField(setCustomerName, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" placeholder="Votre nom" />
              </label>
              <label className="block text-xs font-bold text-slate-700">Numéro WhatsApp
                <input required type="tel" maxLength={32} autoComplete="tel" value={customerWhatsApp} onChange={(e) => updateField(setCustomerWhatsApp, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" placeholder="+212 6..." />
              </label>
              <label className="block text-xs font-bold text-slate-700">Adresse ou lieu de livraison
                <textarea required maxLength={250} autoComplete="street-address" value={deliveryAddress} onChange={(e) => updateField(setDeliveryAddress, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" rows={2} placeholder="Ville, quartier, rue, repère…" />
              </label>
              <label className="block text-xs font-bold text-slate-700">Instructions complémentaires (facultatif)
                <textarea maxLength={1000} value={notes} onChange={(e) => updateField(setNotes, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" rows={2} placeholder="Heure souhaitée, repère, consignes…" />
              </label>
            </div>

            <button type="submit" disabled={submitting || !cart.length} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3.5 text-sm font-extrabold text-slate-950 shadow-md">
              {submitting ? 'Enregistrement sécurisé…' : <><ShoppingCart className="w-4 h-4" /> Confirmer la commande</>}
            </button>
            <p className="text-[11px] text-center text-slate-500">Votre commande est transmise à la boutique. Aucun paiement en ligne n’est prélevé.</p>
          </form>
        )}
      </section>
    </div>
  );
};
