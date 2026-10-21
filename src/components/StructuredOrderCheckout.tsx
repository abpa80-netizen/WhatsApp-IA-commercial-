import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { CurrencyType, Product } from '../types';
import { formatCurrency } from '../services/aiGenerator';

interface StructuredOrderCheckoutProps {
  vendorId: string;
  vendorName: string;
  currency: CurrencyType;
  products: Product[];
  initialProduct: Product;
  onClose: () => void;
}

interface CartLine {
  productId: string;
  quantity: number;
}

interface CreatedOrder {
  orderId: string;
  status: string;
  total: number;
  currency: CurrencyType;
  replayed?: boolean;
}

function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* Use a compatible fallback below. */ }
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export const StructuredOrderCheckout: React.FC<StructuredOrderCheckoutProps> = ({
  vendorId, vendorName, currency, products, initialProduct, onClose,
}) => {
  const [cart, setCart] = useState<CartLine[]>([{ productId: initialProduct.id, quantity: 1 }]);
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsApp, setCustomerWhatsApp] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<CreatedOrder | null>(null);
  const [additionalProductId, setAdditionalProductId] = useState('');
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  const availableProducts = useMemo(() => products.filter((product) => product.id && product.id !== ''), [products]);
  const cartProducts = useMemo(() => cart.map((line) => ({
    ...line,
    product: availableProducts.find((product) => product.id === line.productId),
  })).filter((line) => Boolean(line.product)), [cart, availableProducts]);

  const estimatedSubtotal = cartProducts.reduce((sum, line) => sum + (Number(line.product?.price) || 0) * line.quantity, 0);
  const numericDeliveryFee = Number(deliveryFee);
  const validDeliveryFee = deliveryFee.trim() !== '' && Number.isFinite(numericDeliveryFee) && numericDeliveryFee >= 0 && numericDeliveryFee <= 100000000;

  const updateQuantity = (productId: string, delta: number) => {
    setCart((current) => current.map((line) => line.productId === productId
      ? { ...line, quantity: Math.max(1, Math.min(1000, line.quantity + delta)) }
      : line));
  };

  const removeProduct = (productId: string) => {
    setCart((current) => current.filter((line) => line.productId !== productId));
  };

  const addProduct = () => {
    if (!additionalProductId) return;
    setCart((current) => {
      const existing = current.find((line) => line.productId === additionalProductId);
      if (existing) return current.map((line) => line.productId === additionalProductId ? { ...line, quantity: Math.min(1000, line.quantity + 1) } : line);
      return [...current, { productId: additionalProductId, quantity: 1 }];
    });
    setAdditionalProductId('');
  };

  const submitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (cartProducts.length === 0) {
      setError('Ajoutez au moins un produit à la commande.');
      return;
    }
    if (!customerName.trim() || !customerWhatsApp.trim() || !deliveryAddress.trim()) {
      setError('Veuillez renseigner votre nom, votre numéro WhatsApp et votre adresse de livraison.');
      return;
    }
    if (!validDeliveryFee) {
      setError('Les frais de livraison doivent être un nombre positif ou nul.');
      return;
    }

    const payload = {
      vendeur_id: vendorId,
      customerName: customerName.trim(),
      customerWhatsApp: customerWhatsApp.trim(),
      deliveryAddress: deliveryAddress.trim(),
      items: cartProducts.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      deliveryFee: Math.round(numericDeliveryFee * 100) / 100,
      notes: notes.trim(),
    };
    const signature = JSON.stringify(payload);
    if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
      idempotencyRef.current = { signature, key: makeIdempotencyKey() };
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyRef.current.key,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        if (response.status === 409 && data.code === 'IDEMPOTENCY_CONFLICT') {
          idempotencyRef.current = null;
          throw new Error('Cette tentative a rencontré un conflit de sécurité. Vérifiez votre panier puis réessayez.');
        }
        if (response.status === 429) throw new Error('Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.');
        if (response.status === 403 && (data.code === 'VIP_REQUIRED' || data.code === 'VIP_EXPIRED')) {
          throw new Error('Cette boutique ne peut pas recevoir de commandes structurées actuellement.');
        }
        throw new Error(typeof data.error === 'string' ? data.error : 'La commande n’a pas pu être enregistrée. Réessayez.');
      }
      setSuccess({
        orderId: String(data.orderId || ''),
        status: String(data.status || 'Nouveau'),
        total: Number(data.total) || 0,
        currency: data.currency === 'MAD' ? 'MAD' : 'CFA',
        replayed: Boolean(data.replayed),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
  const labelClass = 'block text-sm font-bold text-slate-700';

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="structured-order-title">
      <div className="flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-700">Commande sécurisée · VIP</p>
            <h2 id="structured-order-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">Commander chez {vendorName}</h2>
            <p className="mt-1 text-xs text-slate-500">Les prix et le total définitif sont recalculés côté serveur.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X className="h-5 w-5" /></button>
        </div>

        {success ? (
          <div className="overflow-y-auto px-5 py-10 text-center sm:px-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-9 w-9" /></div>
            <h3 className="mt-4 text-2xl font-black text-slate-950">Commande enregistrée</h3>
            <p className="mt-2 text-sm text-slate-600">Votre commande a été transmise à la boutique. Le vendeur pourra vous contacter pour la suite.</p>
            <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Référence</p>
              <p className="mt-1 break-all font-mono text-sm font-bold text-slate-900">{success.orderId || 'Commande confirmée'}</p>
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Statut</span><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{success.status}</span></div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3"><span className="text-sm text-slate-500">Total confirmé</span><span className="text-lg font-black text-slate-950">{formatCurrency(success.total, success.currency)}</span></div>
            </div>
            <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3.5 text-sm font-extrabold text-slate-950 transition hover:bg-emerald-400 sm:w-auto sm:min-w-48">Terminer</button>
          </div>
        ) : (
          <form onSubmit={submitOrder} className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-extrabold text-slate-900">Votre panier</h3><span className="text-xs font-semibold text-slate-500">{cartProducts.length} article(s) différent(s)</span></div>
              <div className="space-y-3">
                {cartProducts.map(({ productId, quantity, product }) => product && (
                  <div key={productId} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                    <img src={product.images?.[0] || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=160&q=70'} alt="" className="h-14 w-14 rounded-xl bg-slate-100 object-cover" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{product.name}</p><p className="mt-1 text-xs text-slate-500">{formatCurrency(product.price, currency)} / unité</p></div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => quantity === 1 ? removeProduct(productId) : updateQuantity(productId, -1)} aria-label="Diminuer la quantité ou retirer" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50">{quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}</button>
                      <span className="min-w-6 text-center text-sm font-extrabold">{quantity}</span>
                      <button type="button" onClick={() => updateQuantity(productId, 1)} aria-label="Augmenter la quantité" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
              {availableProducts.some((product) => !cart.some((line) => line.productId === product.id)) && (
                <div className="mt-3 flex gap-2">
                  <select value={additionalProductId} onChange={(event) => setAdditionalProductId(event.target.value)} aria-label="Choisir un autre produit" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                    <option value="">Ajouter un autre produit…</option>
                    {availableProducts.filter((product) => !cart.some((line) => line.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} — {formatCurrency(product.price, currency)}</option>)}
                  </select>
                  <button type="button" onClick={addProduct} disabled={!additionalProductId} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"><Plus className="h-4 w-4" /> Ajouter</button>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm text-slate-600">Sous-total estimé</span><span className="font-extrabold text-slate-900">{formatCurrency(estimatedSubtotal, currency)}</span></div>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-400">Estimation indicative. Le serveur vérifiera le catalogue et recalculera les prix officiels au moment de l’enregistrement.</p>
            </section>

            <section className="mt-6">
              <h3 className="mb-3 font-extrabold text-slate-900">Informations de livraison</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Nom complet<input className={fieldClass} autoComplete="name" maxLength={100} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Votre nom" required /></label>
                <label className={labelClass}>Numéro WhatsApp<input className={fieldClass} type="tel" inputMode="tel" autoComplete="tel" maxLength={32} value={customerWhatsApp} onChange={(event) => setCustomerWhatsApp(event.target.value)} placeholder="+212…" required /></label>
                <label className={`${labelClass} sm:col-span-2`}>Adresse / lieu de livraison<textarea className={fieldClass} autoComplete="street-address" maxLength={250} rows={2} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Ville, quartier, rue, repère…" required /></label>
                <label className={labelClass}>Frais de livraison ({currency})<input className={fieldClass} type="number" min="0" max="100000000" step="0.01" value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} required /></label>
                <label className={`${labelClass} sm:col-span-2`}>Note pour le vendeur (facultatif)<textarea className={fieldClass} rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Instructions utiles pour la livraison…" /></label>
              </div>
            </section>

            {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

            <div className="sticky bottom-0 mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Annuler</button>
              <button type="submit" disabled={submitting || cartProducts.length === 0 || !validDeliveryFee} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-extrabold text-slate-950 shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Envoi sécurisé…</> : <><ShoppingBag className="h-4 w-4" /> Confirmer la commande</>}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
