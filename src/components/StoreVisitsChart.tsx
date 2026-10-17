import React, { useState, useEffect } from 'react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  Eye, 
  MousePointerClick, 
  MessageCircle, 
  Calendar, 
  RotateCw, 
  ArrowUpRight,
  Sparkles
} from 'lucide-react';
import { Vendeur, DailyVisitStat } from '../types';
import { ApiService } from '../services/api';

interface StoreVisitsChartProps {
  vendeur: Vendeur;
  onOpenStore?: () => void;
}

type PeriodDays = 7 | 14 | 30;

export const StoreVisitsChart: React.FC<StoreVisitsChartProps> = ({ 
  vendeur,
  onOpenStore 
}) => {
  const [period, setPeriod] = useState<PeriodDays>(7);
  const [chartData, setChartData] = useState<DailyVisitStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showClicks, setShowClicks] = useState(true);
  const [showOrders, setShowOrders] = useState(true);

  // Load daily visits whenever vendor or period changes
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const stats = await ApiService.getDailyVisits(vendeur, period);
      setChartData(stats);
      setLoadError(null);
    } catch (err) {
      setLoadError('Impossible de lire les statistiques depuis Firestore. Vérifiez la connexion et les règles de sécurité, puis réessayez.');
      console.error('[StoreVisitsChart] Erreur lors du chargement des visites:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const stats = await ApiService.getDailyVisits(vendeur, period);
        if (!cancelled) {
          setChartData(stats);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) setLoadError('Impossible de lire les statistiques depuis Firestore. Vérifiez la connexion et les règles de sécurité, puis réessayez.');
        console.error('[StoreVisitsChart] Erreur lors du chargement des visites:', err);
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(true); }, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [vendeur.id, vendeur.uid, vendeur.views, period]);

  // Aggregate stats for the selected period
  const totalPeriodViews = chartData.reduce((acc, d) => acc + (d.views || 0), 0);
  const totalPeriodClicks = chartData.reduce((acc, d) => acc + (d.clicks || 0), 0);
  const totalPeriodOrders = chartData.reduce((acc, d) => acc + (d.conversions || 0), 0);
  const avgViewsPerDay = chartData.length > 0 ? (totalPeriodViews / chartData.length).toFixed(1) : '0';
  
  // Find highest peak day
  const peakDay = chartData.reduce((max, cur) => cur.views > max.views ? cur : max, { views: 0, date: '-' });

  // Custom sleek tooltip component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0]?.payload as DailyVisitStat;
      return (
        <div className="bg-slate-900/95 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md min-w-[170px] space-y-2 text-xs">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="font-bold text-slate-200">{item?.displayDate || label}</span>
            <span className="text-[10px] text-slate-400 font-mono">{item?.fullDate}</span>
          </div>

          <div className="space-y-1.5 font-medium">
            <div className="flex items-center justify-between gap-3 text-emerald-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#25D366]" />
                <span>Visites boutique :</span>
              </span>
              <strong className="font-bold font-mono text-sm">{item?.views || 0}</strong>
            </div>

            {showClicks && (
              <div className="flex items-center justify-between gap-3 text-amber-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Clics fiches :</span>
                </span>
                <strong className="font-bold font-mono text-sm">{item?.clicks || 0}</strong>
              </div>
            )}

            {showOrders && (
              <div className="flex items-center justify-between gap-3 text-purple-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span>Clics WhatsApp :</span>
                </span>
                <strong className="font-bold font-mono text-sm">{item?.conversions || 0}</strong>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div 
      id="store-visits-chart-card" 
      className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm space-y-5"
    >
      {/* Header with Title and Period Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-[#25D366] border border-emerald-200/60 flex items-center justify-center shrink-0 shadow-xs">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">Évaluation des visites de la boutique</h3>
              <span className="hidden md:inline-flex text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                Temps Réel
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Historique quotidien du trafic acheteurs et de l’intérêt pour vos articles
            </p>
          </div>
        </div>

        {/* Period Selector Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-2xl self-start sm:self-auto">
          {([7, 14, 30] as PeriodDays[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                period === d
                  ? 'bg-white text-slate-950 shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              {d} jours
            </button>
          ))}

          <button
            type="button"
            onClick={() => loadData(false)}
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white transition-colors cursor-pointer"
            title="Rafraîchir les données du graphique"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#25D366]' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Highlights Bar */}
      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Statistiques indisponibles.</strong> {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: Total Period Visits */}
        <div className="bg-slate-50/80 border border-slate-200/70 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Total Visites</span>
            <span className="w-2 h-2 rounded-full bg-[#25D366]" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900">{totalPeriodViews}</span>
            <span className="text-[10px] text-slate-500">sur {period}j</span>
          </div>
        </div>

        {/* Metric 2: Average Per Day */}
        <div className="bg-slate-50/80 border border-slate-200/70 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Moyenne / jour</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900">{avgViewsPerDay}</span>
            <span className="text-[10px] text-slate-500">visites / j</span>
          </div>
        </div>

        {/* Metric 3: Product Clicks */}
        <div 
          onClick={() => setShowClicks(!showClicks)}
          className={`border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition-all ${
            showClicks 
              ? 'bg-amber-50/50 border-amber-200/70' 
              : 'bg-slate-50/40 border-slate-200 opacity-60'
          }`}
          title="Cliquer pour afficher / masquer les clics sur le graphique"
        >
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">Clics Produits</span>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900">{totalPeriodClicks}</span>
            <span className="text-[10px] text-amber-700 font-bold">{showClicks ? 'Actif' : 'Masqué'}</span>
          </div>
        </div>

        {/* Metric 4: WhatsApp Orders */}
        <div 
          onClick={() => setShowOrders(!showOrders)}
          className={`border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition-all ${
            showOrders 
              ? 'bg-purple-50/50 border-purple-200/70' 
              : 'bg-slate-50/40 border-slate-200 opacity-60'
          }`}
          title="Cliquer pour afficher / masquer les commandes sur le graphique"
        >
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">Clics WhatsApp</span>
            <span className="w-2 h-2 rounded-full bg-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900">{totalPeriodOrders}</span>
            <span className="text-[10px] text-purple-700 font-bold">{showOrders ? 'Actif' : 'Masqué'}</span>
          </div>
        </div>
      </div>

      {/* Main Recharts Visualization Canvas */}
      <div className="w-full h-72 sm:h-80 pt-2 relative">
        {loading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex items-center justify-center z-10 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white px-4 py-2 rounded-xl shadow-md border border-slate-200">
              <RotateCw className="w-4 h-4 animate-spin text-[#25D366]" />
              <span>Chargement des visites...</span>
            </div>
          </div>
        )}

        {totalPeriodViews === 0 && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/60 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#25D366]/10 text-[#25D366] flex items-center justify-center">
              <Eye className="w-6 h-6" />
            </div>
            <div className="max-w-sm">
              <h4 className="text-sm font-bold text-slate-800">Aucune visite enregistrée pour le moment</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Partagez votre lien de catalogue sur WhatsApp ou cliquez sur « Tester ma boutique » pour enregistrer votre première visite en direct.
              </p>
            </div>
            {onOpenStore && (
              <button
                type="button"
                onClick={onOpenStore}
                className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-all cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Tester ma boutique en direct</span>
              </button>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={chartData} 
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <defs>
                {/* Gradient for Store Views (Emerald) */}
                <linearGradient id="gradientViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#25D366" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#25D366" stopOpacity={0.0} />
                </linearGradient>

                {/* Gradient for Product Clicks (Amber) */}
                <linearGradient id="gradientClicks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                </linearGradient>

                {/* Gradient for WhatsApp Orders (Purple) */}
                <linearGradient id="gradientOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid 
                strokeDasharray="3 3" 
                vertical={false} 
                stroke="#F1F5F9" 
              />

              <XAxis 
                dataKey="date" 
                stroke="#94A3B8" 
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#E2E8F0' }}
                dy={6}
              />

              <YAxis 
                stroke="#94A3B8" 
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                dx={-4}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Main Area: Views */}
              <Area
                type="monotone"
                dataKey="views"
                name="Visites catalogue"
                stroke="#25D366"
                strokeWidth={2.5}
                fill="url(#gradientViews)"
                activeDot={{ r: 6, fill: '#25D366', stroke: '#FFFFFF', strokeWidth: 2 }}
              />

              {/* Optional Area: Clicks */}
              {showClicks && (
                <Area
                  type="monotone"
                  dataKey="clicks"
                  name="Clics produits"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fill="url(#gradientClicks)"
                  activeDot={{ r: 5, fill: '#F59E0B', stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              )}

              {/* Optional Area: Orders */}
              {showOrders && (
                <Area
                  type="monotone"
                  dataKey="conversions"
                  name="Commandes WhatsApp"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  fill="url(#gradientOrders)"
                  activeDot={{ r: 5, fill: '#8B5CF6', stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer Insight Pill */}
      {totalPeriodViews > 0 && peakDay.views > 0 && (
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            <span>
              Pic d’audience atteint le <strong className="text-slate-800">{peakDay.date}</strong> avec <strong className="text-emerald-700">{peakDay.views} visites</strong>.
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Astuce : partagez vos nouveautés le matin sur votre statut WhatsApp pour maximiser le pic.
          </span>
        </div>
      )}
    </div>
  );
};
