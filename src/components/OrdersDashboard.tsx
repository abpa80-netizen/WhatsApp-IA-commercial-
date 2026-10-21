import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, LoaderCircle, RefreshCw, Search, ShoppingBag
} from 'lucide-react';
import { auth } from '../firebase';
import { OrderStatus, StructuredOrder, Vendeur } from '../types';
import { formatCurrency } from '../services/aiGenerator';
import { getVendorEntitlements } from '../services/entitlements';
import { useToast } from './Toast';

const STATUSES: OrderStatus[] = ['Nouveau', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];
const STATUS_STYLES: Record<OrderStatus, string> = {
  Nouveau: 'bg-blue-50 text-blue-700 ring-blue-200',
  Confirmée: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'En préparation': 'bg-amber-50 text-amber-800 ring-amber-200',
  Expédiée: 'bg-violet-50 text-violet-700 ring-violet-200',
  Livrée: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Annulée: 'bg-rose-50 text-rose-700 ring-rose-200',
};

interface OrdersDashboardProps {
  vendeur: Vendeur;
  onOpenUpgradeModal: () => void;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function formatDate(value: unknown): string {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Date indisponible';
}

export const OrdersDashboard: React.FC<OrdersDashboardProps> = ({ vendeur, onOpenUpgradeModal }) => {
  const { showToast } = useToast();
  const [orders, setOrders] = useState<StructuredOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'Toutes' | OrderStatus>('Toutes');
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState('');

  const uid = auth.currentUser?.uid || '';
  const entitlements = getVendorEntitlements(vendeur);
  const isOwnerSession = Boolean(uid && (uid === vendeur.id || auth.currentUser?.email?.trim().toLowerCase() === 'foosco80@gmail.com'));

  const loadOrders = useCallback(async (quiet = false) => {
    if (!uid || uid !== vendeur.id) {
      setOrders([]);
      setLoadError('La session authentifiée ne correspond pas à cette boutique. Reconnectez-vous pour consulter les commandes.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('AUTH_REQUIRED');
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/orders/list?vendeur_id=${encodeURIComponent(vendeur.id)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true || !Array.isArray(payload.orders)) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'ORDERS_LIST_FAILED');
      }
      const nextOrders = payload.orders.map((data: any) => ({
        ...data,
        id: String(data.id || ''),
        vendeur_id: vendeur.id,
        items: Array.isArray(data.items) ? data.items : [],
        status: STATUSES.includes(data.status) ? data.status : 'Nouveau',
      } as StructuredOrder));
      nextOrders.sort((a: StructuredOrder, b: StructuredOrder) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
      setOrders(nextOrders);
    } catch (error) {
      console.error('[OrdersDashboard] Impossible de charger les commandes:', error);
      setLoadError('Impossible de charger les commandes. Vérifiez votre connexion puis réessayez.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid, vendeur.id]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const updateStatus = async (order: StructuredOrder, status: OrderStatus) => {
    if (!isOwnerSession || savingOrderId) return;
    if (order.status === status) return;
    setSavingOrderId(order.id);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('AUTH_REQUIRED');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/orders/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vendeur_id: vendeur.id, orderId: order.id, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'ORDER_STATUS_UPDATE_FAILED');
      }
      const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString();
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status, updatedAt } : item));
      showToast('Statut de la commande mis à jour.', 'success');
    } catch (error) {
      console.error('[OrdersDashboard] Mise à jour du statut refusée:', error);
      showToast('Impossible de modifier le statut. Vérifiez votre connexion et vos droits VIP.', 'error');
    } finally {
      setSavingOrderId(null);
    }
  };

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('fr');
    return orders.filter((order) => {
      const statusMatches = filter === 'Toutes' || order.status === filter;
      const searchMatches = !q || [
        order.customerName,
        order.customerWhatsApp,
        order.deliveryAddress,
        order.id,
        ...(order.items || []).map((item) => item.name),
      ].some((value) => String(value || '').toLocaleLowerCase('fr').includes(q));
      return statusMatches && searchMatches;
    });
  }, [orders, filter, search]);

  const totalRevenue = orders.filter((order) => order.status !== 'Annulée').reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const newOrders = orders.filter((order) => order.status === 'Nouveau').length;
  const activeOrders = orders.filter((order) => ['Confirmée', 'En préparation', 'Expédiée'].includes(order.status)).length;

  if (!entitlements.isVipActive) {
    return (
      <section className="max-w-4xl mx-auto px-4 py-10">
        <div className="rounded-3xl border border-amber-200 bg-white p-7 sm:p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShoppingBag className="h-7 w-7" /></div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-700">Fonctionnalité VIP</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Commandes structurées</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">Centralisez les commandes, consultez les coordonnées de livraison et suivez chaque étape, de la confirmation à la livraison. Cette fonctionnalité nécessite un abonnement VIP actif.</p>
          <button onClick={onOpenUpgradeModal} className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">Découvrir le Pack VIP</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">Espace vendeur · VIP</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Gestion des commandes</h1>
          <p className="mt-2 text-sm text-slate-500">Consultez, recherchez et mettez à jour les commandes de votre boutique.</p>
        </div>
        <button onClick={() => void loadOrders(true)} disabled={refreshing || loading} className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Total des commandes</p><p className="mt-2 text-3xl font-black text-slate-950">{orders.length}</p></div>
        <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">À traiter</p><p className="mt-2 text-3xl font-black text-blue-700">{newOrders}</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Montant des commandes non annulées</p><p className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(totalRevenue, vendeur.currency)}</p><p className="mt-1 text-xs text-slate-400">{activeOrders} en cours de traitement</p></div>
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row">
        <label className="relative block flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un client, un numéro, un article…" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
        </label>
        <select value={filter} onChange={(event) => setFilter(event.target.value as 'Toutes' | OrderStatus)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-400">
          <option value="Toutes">Tous les statuts</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      {loadError && <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><span>{loadError}</span></div>}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-16 text-sm font-semibold text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Chargement des commandes…</div>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
          <ShoppingBag className="mx-auto h-9 w-9 text-slate-300" />
          <h3 className="mt-3 text-lg font-extrabold text-slate-800">{orders.length === 0 ? 'Aucune commande pour le moment' : 'Aucun résultat'}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{orders.length === 0 ? 'Les nouvelles commandes structurées de votre boutique apparaîtront ici.' : 'Essayez de modifier votre recherche ou le filtre de statut.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => (
            <article key={order.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-slate-950">Commande #{order.id.slice(0, 8).toUpperCase()}</h3><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${STATUS_STYLES[order.status] || STATUS_STYLES.Nouveau}`}>{order.status}</span></div>
                  <p className="mt-1 text-xs text-slate-500">Créée le {formatDate(order.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor={`status-${order.id}`} className="text-xs font-bold text-slate-500">Statut</label>
                  <select id={`status-${order.id}`} value={order.status} disabled={savingOrderId === order.id} onChange={(event) => void updateStatus(order, event.target.value as OrderStatus)} className="max-w-[210px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400 disabled:opacity-60">
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  {savingOrderId === order.id && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
                </div>
              </div>
              <div className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[1.2fr_1fr_0.8fr]">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Client</p>
                  <p className="mt-2 font-bold text-slate-900">{order.customerName || 'Nom non renseigné'}</p>
                  <a href={`https://wa.me/${String(order.customerWhatsApp || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"><MessageCircleIcon />{order.customerWhatsApp || 'WhatsApp non renseigné'}</a>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-5 text-slate-600">{order.deliveryAddress || 'Adresse non renseignée'}</p>
                  {order.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">Note : {order.notes}</p>}
                </div>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Articles ({order.items.length})</p>
                  <div className="mt-2 space-y-2">
                    {order.items.map((item, index) => <div key={item.productId || index} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="font-semibold text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.quantity} × {formatCurrency(item.price, order.currency)}</p></div><p className="shrink-0 font-bold text-slate-800">{formatCurrency(item.total, order.currency)}</p></div>)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Récapitulatif</p>
                  <div className="mt-3 flex justify-between gap-3 text-sm text-slate-600"><span>Sous-total</span><span>{formatCurrency(order.subtotal, order.currency)}</span></div>
                  <div className="mt-2 flex justify-between gap-3 text-sm text-slate-600"><span>Livraison</span><span>{formatCurrency(order.deliveryFee, order.currency)}</span></div>
                  <div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3 text-base font-black text-slate-950"><span>Total</span><span>{formatCurrency(order.total, order.currency)}</span></div>
                  <p className="mt-3 text-[11px] text-slate-400">Dernière mise à jour : {formatDate(order.updatedAt)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

const MessageCircleIcon = () => <span aria-hidden="true">↗</span>;
