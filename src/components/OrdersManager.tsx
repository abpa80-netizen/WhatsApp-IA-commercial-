import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, RefreshCw, Search, PackageCheck, MessageCircle, MapPin, Clock3, AlertCircle, Crown } from 'lucide-react';
import { Vendeur, StructuredOrder, OrderStatus } from '../types';
import { ApiService } from '../services/api';
import { getVendorEntitlements } from '../services/entitlements';
import { formatCurrency } from '../services/aiGenerator';

interface OrdersManagerProps {
  vendeur: Vendeur;
}

const ORDER_STATUSES: OrderStatus[] = ['Nouveau', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];

function formatDate(value?: string): string {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Date inconnue';
}

function statusClass(status: OrderStatus): string {
  if (status === 'Nouveau') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Confirmée') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'En préparation') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Expédiée') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (status === 'Livrée') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

export const OrdersManager: React.FC<OrdersManagerProps> = ({ vendeur }) => {
  const [orders, setOrders] = useState<StructuredOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'Toutes' | OrderStatus>('Toutes');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const vendorId = vendeur.uid || vendeur.id;
  const isVip = getVendorEntitlements(vendeur).isVipActive;

  const loadOrders = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const result = await ApiService.getOrders(vendorId);
      setOrders(result);
    } catch (err: any) {
      setError(err?.message || 'Impossible de charger les commandes. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (isVip) void loadOrders();
    else setLoading(false);
  }, [isVip, loadOrders]);

  const filteredOrders = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = filter === 'Toutes' || order.status === filter;
      const matchesSearch = !queryText ||
        order.customerName.toLowerCase().includes(queryText) ||
        order.customerWhatsApp.toLowerCase().includes(queryText) ||
        order.id.toLowerCase().includes(queryText);
      return matchesStatus && matchesSearch;
    });
  }, [orders, search, filter]);

  const newCount = orders.filter((order) => order.status === 'Nouveau').length;
  const totalRevenue = orders.filter((order) => order.status !== 'Annulée').reduce((sum, order) => sum + order.total, 0);

  const handleStatusChange = async (order: StructuredOrder, nextStatus: OrderStatus) => {
    if (order.status === nextStatus) return;
    setUpdatingId(order.id);
    setError('');
    try {
      await ApiService.updateOrderStatus(vendorId, order.id, nextStatus);
      setOrders((current) => current.map((item) => item.id === order.id
        ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() }
        : item));
    } catch (err: any) {
      setError(err?.message || 'Le statut n’a pas pu être enregistré.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (!isVip) {
    return (
      <section className="max-w-3xl mx-auto bg-white border border-amber-200 rounded-3xl p-6 sm:p-10 text-center shadow-sm">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
          <Crown className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-extrabold text-slate-900 mt-4">Gestion des commandes structurées</h2>
        <p className="text-sm text-slate-600 mt-2 max-w-lg mx-auto">Cette fonctionnalité est réservée aux abonnements VIP actifs. L’essai gratuit et un abonnement expiré ne donnent pas accès à la gestion des commandes.</p>
        <p className="text-xs text-slate-500 mt-3">Vos produits existants restent conservés. L’activation VIP déverrouille la gestion des commandes.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider">
            <ClipboardList className="w-4 h-4" /> Espace VIP
          </div>
          <h1 className="text-2xl font-extrabold text-slate-950 mt-1">Commandes structurées</h1>
          <p className="text-sm text-slate-500 mt-1">Centralisez les commandes reçues depuis votre boutique et suivez chaque étape de livraison.</p>
        </div>
        <button type="button" onClick={() => void loadOrders(true)} disabled={loading || refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-semibold">Commandes reçues</p>
          <p className="text-2xl font-extrabold text-slate-950 mt-1">{orders.length}</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
          <p className="text-xs text-blue-700 font-semibold">À traiter</p>
          <p className="text-2xl font-extrabold text-blue-900 mt-1">{newCount}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs text-emerald-700 font-semibold">Montant des commandes non annulées</p>
          <p className="text-2xl font-extrabold text-emerald-900 mt-1">{formatCurrency(totalRevenue, vendeur.currency)}</p>
        </div>
      </div>

      {error && <div role="alert" className="flex gap-2 items-start rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un client, un WhatsApp ou une référence…" className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'Toutes' | OrderStatus)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold">
          <option value="Toutes">Tous les statuts</option>
          {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Chargement des commandes…</div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 sm:p-12 text-center">
          <PackageCheck className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-slate-800 mt-3">{orders.length ? 'Aucune commande pour ce filtre' : 'Aucune commande pour le moment'}</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{orders.length ? 'Essayez un autre statut ou une autre recherche.' : 'Les commandes structurées envoyées depuis votre boutique apparaîtront ici.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <article key={order.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold text-slate-950">{order.customerName || 'Client'}</span>
                    <span className={`text-[11px] font-bold border rounded-full px-2.5 py-1 ${statusClass(order.status)}`}>{order.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 break-all">Réf. {order.id}</p>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" /> {formatDate(order.createdAt)}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xl font-extrabold text-slate-950">{formatCurrency(order.total, order.currency)}</p>
                  <a href={`https://wa.me/${String(order.customerWhatsApp || '').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-emerald-700 hover:text-emerald-800">
                    <MessageCircle className="w-3.5 h-3.5" /> Contacter le client
                  </a>
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start gap-2 text-sm text-slate-600"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" /><span>{order.deliveryAddress || 'Adresse non renseignée'}</span></div>
                <div className="divide-y divide-slate-100">
                  {order.items.map((item, index) => (
                    <div key={`${order.id}-${item.productId}-${index}`} className="py-2 flex items-center gap-3">
                      {item.image ? <img src={item.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-slate-100" /> : <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center"><PackageCheck className="w-5 h-5 text-slate-400" /></div>}
                      <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.quantity} × {formatCurrency(item.price, order.currency)}</p></div>
                      <p className="text-sm font-bold text-slate-800">{formatCurrency(item.total, order.currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-100 pt-3 space-y-1 text-sm">
                  <div className="flex justify-between text-slate-500"><span>Sous-total</span><span>{formatCurrency(order.subtotal, order.currency)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>Livraison</span><span>{formatCurrency(order.deliveryFee, order.currency)}</span></div>
                  <div className="flex justify-between font-extrabold text-slate-950"><span>Total</span><span>{formatCurrency(order.total, order.currency)}</span></div>
                </div>
                {order.notes && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><span className="font-bold text-slate-700">Note du client : </span>{order.notes}</div>}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                  <label htmlFor={`status-${order.id}`} className="text-xs font-bold text-slate-600">Mettre à jour le statut</label>
                  <select id={`status-${order.id}`} value={order.status} disabled={updatingId === order.id} onChange={(e) => void handleStatusChange(order, e.target.value as OrderStatus)} className="sm:ml-auto rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold disabled:opacity-50">
                    {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  {updatingId === order.id && <span className="text-xs text-slate-500">Enregistrement…</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
