import React, { useState, useEffect } from 'react';
import { Prospect, Vendeur, ProspectStatus } from '../types';
import { 
  Users, 
  Plus, 
  Search, 
  MessageCircle, 
  Edit3, 
  Trash2, 
  X, 
  Check, 
  Phone, 
  Sparkles, 
  Lock, 
  Crown, 
  Clock, 
  Filter,
  TrendingUp,
  Award,
  CheckCircle2,
  Moon,
  Sun
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Cell, 
  CartesianGrid 
} from 'recharts';
import { useToast } from './Toast';
import { getVendorEntitlements } from '../services/entitlements';

interface ProspectsCRMProps {
  vendeur: Vendeur;
  prospects: Prospect[];
  onSaveProspect: (prospect: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }) => Promise<void>;
  onDeleteProspect: (prospectId: string) => Promise<void>;
  onSelectForAI: (prospect: Prospect) => void;
  onOpenUpgradeModal: () => void;
}

const STATUS_CONFIG: Record<ProspectStatus, { label: string; lightBadge: string; darkBadge: string }> = {
  'Nouveau': { 
    label: 'Nouveau', 
    lightBadge: 'bg-sky-50 text-sky-700 border-sky-200',
    darkBadge: 'bg-sky-950/80 text-sky-300 border-sky-800/80 shadow-xs'
  },
  'Intéressé': { 
    label: 'Intéressé', 
    lightBadge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    darkBadge: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80 shadow-xs'
  },
  'À relancer': { 
    label: 'À relancer', 
    lightBadge: 'bg-amber-50 text-amber-800 border-amber-200',
    darkBadge: 'bg-amber-950/80 text-amber-300 border-amber-800/80 shadow-xs'
  },
  'Converti': { 
    label: 'Converti 🎉', 
    lightBadge: 'bg-purple-50 text-purple-700 border-purple-200',
    darkBadge: 'bg-purple-950/80 text-purple-300 border-purple-800/80 shadow-xs'
  },
  'Perdu': { 
    label: 'Sans suite', 
    lightBadge: 'bg-slate-100 text-slate-600 border-slate-200',
    darkBadge: 'bg-slate-800 text-slate-400 border-slate-700'
  },
};

interface TooltipPayloadItem {
  payload: {
    status: string;
    count: number;
    percent: number;
    color: string;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  isDark?: boolean;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, isDark }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className={`px-3 py-2 rounded-xl shadow-xl text-xs border ${
        isDark 
          ? 'bg-slate-950 text-white border-slate-750 shadow-black/60' 
          : 'bg-slate-900 text-white border-slate-800 shadow-lg'
      }`}>
        <div className="font-bold flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
          <span>{data.status}</span>
        </div>
        <div className="mt-1 text-slate-300">
          <span className="font-extrabold text-white text-sm">{data.count}</span> {data.count > 1 ? 'contacts' : 'contact'} ({data.percent}% du total)
        </div>
      </div>
    );
  }
  return null;
};

export const ProspectsCRM: React.FC<ProspectsCRMProps> = ({
  vendeur,
  prospects,
  onSaveProspect,
  onDeleteProspect,
  onSelectForAI,
  onOpenUpgradeModal,
}) => {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);

  // Adaptive Dark Theme state: reads from storage, with automatic fallback to system dark mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('wca_crm_dark_theme');
    if (saved !== null) {
      return saved === 'true';
    }
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  // Listen to system color scheme changes if user hasn't explicitly locked a preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem('wca_crm_dark_theme');
      if (saved === null) {
        setIsDarkMode(e.matches);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('wca_crm_dark_theme', String(next));
      showToast(next ? 'Thème Confort Boutique activé 🌙' : 'Mode Lumineux activé ☀️', 'info');
      return next;
    });
  };

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Form fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<ProspectStatus>('Nouveau');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Computed pipeline statistics for conversion chart
  const totalProspects = prospects.length;
  const statusCounts: Record<ProspectStatus, number> = {
    'Nouveau': prospects.filter(p => p.status === 'Nouveau').length,
    'Intéressé': prospects.filter(p => p.status === 'Intéressé').length,
    'À relancer': prospects.filter(p => p.status === 'À relancer').length,
    'Converti': prospects.filter(p => p.status === 'Converti').length,
    'Perdu': prospects.filter(p => p.status === 'Perdu').length,
  };

  const conversionRate = totalProspects > 0 
    ? Math.round((statusCounts['Converti'] / totalProspects) * 100) 
    : 0;

  const chartData = [
    { 
      status: 'Nouveau', 
      count: statusCounts['Nouveau'], 
      percent: totalProspects > 0 ? Math.round((statusCounts['Nouveau'] / totalProspects) * 100) : 0,
      color: '#0ea5e9' // sky-500
    },
    { 
      status: 'Intéressé', 
      count: statusCounts['Intéressé'], 
      percent: totalProspects > 0 ? Math.round((statusCounts['Intéressé'] / totalProspects) * 100) : 0,
      color: '#10b981' // emerald-500
    },
    { 
      status: 'À relancer', 
      count: statusCounts['À relancer'], 
      percent: totalProspects > 0 ? Math.round((statusCounts['À relancer'] / totalProspects) * 100) : 0,
      color: '#f59e0b' // amber-500
    },
    { 
      status: 'Converti', 
      count: statusCounts['Converti'], 
      percent: totalProspects > 0 ? Math.round((statusCounts['Converti'] / totalProspects) * 100) : 0,
      color: '#8b5cf6' // violet-500
    },
    { 
      status: 'Sans suite', 
      count: statusCounts['Perdu'], 
      percent: totalProspects > 0 ? Math.round((statusCounts['Perdu'] / totalProspects) * 100) : 0,
      color: '#94a3b8' // slate-400
    },
  ];

  // Hardware / Browser Back button handling for closing modal
  useEffect(() => {
    const handlePopState = () => {
      if (modalOpen) {
        setModalOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [modalOpen]);

  const isRestricted = !getVendorEntitlements(vendeur).hasPremiumAccess;

  const handleOpenAdd = () => {
    setEditingProspect(null);
    setName('');
    setPhone('');
    setNotes('');
    setStatus('Nouveau');
    setModalOpen(true);
    window.history.pushState({ modal: 'prospect_form' }, '');
  };

  const handleOpenEdit = (p: Prospect) => {
    setEditingProspect(p);
    setName(p.name);
    setPhone(p.phone);
    setNotes(p.notes);
    setStatus(p.status);
    setModalOpen(true);
    window.history.pushState({ modal: 'prospect_form', prospectId: p.id }, '');
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    if (window.history.state?.modal === 'prospect_form') {
      window.history.back();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      showToast('Veuillez renseigner le nom et le numéro WhatsApp', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveProspect({
        id: editingProspect?.id,
        name: name.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        status,
      });

      showToast(editingProspect ? 'Prospect mis à jour' : 'Nouveau prospect ajouté au CRM !', 'success');
      setModalOpen(false);
    } catch {
      showToast('Erreur lors de l’enregistrement', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, pName: string) => {
    if (confirm(`Supprimer le contact ${pName} ?`)) {
      try {
        await onDeleteProspect(id);
        showToast('Prospect supprimé', 'success');
      } catch {
        showToast('Erreur lors de la suppression', 'error');
      }
    }
  };

  const handleDirectWhatsApp = (p: Prospect) => {
    const clean = p.phone.replace(/\D/g, '');
    const text = encodeURIComponent(`Bonjour ${p.name} ! J’espère que vous allez bien.`);
    window.open(`https://wa.me/${clean}?text=${text}`, '_blank');
  };

  if (isRestricted) {
    return (
      <div 
        id="crm-locked" 
        className={`rounded-3xl p-8 border shadow-xs text-center max-w-lg mx-auto space-y-4 my-8 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
          Mini-CRM Prospects réservé à l’essai et au Pack VIP
        </h2>
        <p className={`text-xs sm:text-sm leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Votre période d’essai est terminée. En mode gratuit, le CRM est verrouillé. Passez au Pack VIP pour retrouver vos contacts, le suivi client et les relances WhatsApp.
        </p>
        <button
          onClick={onOpenUpgradeModal}
          className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-6 py-3 rounded-xl text-sm shadow-md transition-all cursor-pointer"
        >
          <Crown className="w-4 h-4" />
          <span>Passer au Pack VIP</span>
        </button>
      </div>
    );
  }

  const filteredProspects = prospects.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.phone.includes(searchQuery) || p.notes.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div id="prospects-crm" className={`space-y-6 transition-colors duration-200 ${isDarkMode ? 'dark' : ''}`}>
      {/* Top Bar with Adaptive Theme Toggle */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border shadow-xs transition-colors ${
        isDarkMode 
          ? 'bg-slate-900 border-slate-800 text-white shadow-black/20' 
          : 'bg-white border-slate-200/80 text-slate-900'
      }`}>
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Mini-CRM Prospects WhatsApp
            </h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              isDarkMode ? 'bg-slate-800 text-emerald-400 border border-slate-700' : 'bg-slate-100 text-slate-700'
            }`}>
              {prospects.length} contacts
            </span>
          </div>
          <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            Gérez vos acheteurs potentiels et envoyez des relances personnalisées en un clic.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          {/* Theme switcher button for visual comfort during prolonged store operations */}
          <button
            type="button"
            onClick={toggleDarkMode}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isDarkMode 
                ? 'bg-slate-800 hover:bg-slate-750 text-amber-300 border-slate-700 shadow-xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            }`}
            title={isDarkMode ? 'Activer mode clair' : 'Activer le mode sombre confort boutique'}
          >
            {isDarkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Mode Jour</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">Confort Nuit</span>
              </>
            )}
          </button>

          <button
            id="btn-add-prospect"
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau prospect</span>
          </button>
        </div>
      </div>

      {/* Visual Pipeline Progression & Conversion Rate Card (via Recharts) */}
      <div className={`p-5 rounded-2xl border shadow-xs space-y-4 transition-colors ${
        isDarkMode 
          ? 'bg-slate-900 border-slate-800 text-white shadow-black/20' 
          : 'bg-white border-slate-200/80 text-slate-900'
      }`}>
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
          isDarkMode ? 'border-slate-800' : 'border-slate-100'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold border ${
              isDarkMode 
                ? 'bg-purple-950/60 text-purple-300 border-purple-800/60' 
                : 'bg-purple-50 text-purple-600 border-purple-200/60'
            }`}>
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                Progression du Pipeline & Conversion
              </h3>
              <p className={`text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Visualisation du parcours client et de la transformation commerciale
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className={`border rounded-xl px-3 py-1.5 flex items-center gap-2 ${
              isDarkMode 
                ? 'bg-purple-950/50 border-purple-800/60 text-purple-300' 
                : 'bg-purple-50/80 border-purple-200/80 text-purple-700'
            }`}>
              <Award className="w-4 h-4 text-purple-400 shrink-0" />
              <div>
                <span className="text-[10px] opacity-80 font-semibold uppercase tracking-wider block">
                  Taux de conversion
                </span>
                <span className="text-base font-extrabold leading-none">{conversionRate}%</span>
              </div>
            </div>

            <div className={`border rounded-xl px-3 py-1.5 flex items-center gap-2 ${
              isDarkMode 
                ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300' 
                : 'bg-emerald-50/80 border-emerald-200/80 text-emerald-700'
            }`}>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="text-[10px] opacity-80 font-semibold uppercase tracking-wider block">
                  Clients Convertis
                </span>
                <span className="text-base font-extrabold leading-none">{statusCounts['Converti']}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recharts Bar Chart with Adaptive Palette */}
        <div className="h-44 w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid 
                strokeDasharray="3 3" 
                vertical={false} 
                stroke={isDarkMode ? '#334155' : '#f1f5f9'} 
              />
              <XAxis 
                dataKey="status" 
                tick={{ fontSize: 11, fill: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: 500 }} 
                axisLine={{ stroke: isDarkMode ? '#334155' : '#e2e8f0' }} 
                tickLine={false} 
              />
              <YAxis 
                allowDecimals={false} 
                tick={{ fontSize: 11, fill: isDarkMode ? '#94a3b8' : '#64748b' }} 
                axisLine={{ stroke: isDarkMode ? '#334155' : '#e2e8f0' }} 
                tickLine={false} 
              />
              <Tooltip 
                content={<CustomTooltip isDark={isDarkMode} />} 
                cursor={{ fill: isDarkMode ? 'rgba(51, 65, 85, 0.4)' : '#f8fafc' }} 
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Visual Pipeline Stacked Bar */}
        {totalProspects > 0 && (
          <div className={`pt-2 border-t space-y-2 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
            <div className={`flex items-center justify-between text-[11px] font-medium ${
              isDarkMode ? 'text-slate-400' : 'text-slate-500'
            }`}>
              <span>Répartition des {totalProspects} contacts</span>
              <span className="text-purple-400 font-bold">{conversionRate}% convertis avec succès</span>
            </div>
            <div className={`h-2.5 w-full rounded-full overflow-hidden flex shadow-inner ${
              isDarkMode ? 'bg-slate-800' : 'bg-slate-100'
            }`}>
              {chartData.map((entry) => {
                if (entry.count === 0) return null;
                return (
                  <div
                    key={`bar-seg-${entry.status}`}
                    style={{ width: `${entry.percent}%`, backgroundColor: entry.color }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
                    title={`${entry.status}: ${entry.count} (${entry.percent}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {chartData.map((entry) => (
                <div key={`legend-${entry.status}`} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>{entry.status}:</span>
                  <span className={`font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{entry.count}</span>
                  <span className="text-slate-500">({entry.percent}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filters and search with adaptive surface colors */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher par nom, téléphone, mot-clé..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full border rounded-xl pl-10 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-colors ${
              isDarkMode 
                ? 'bg-slate-900 border-slate-750 text-white placeholder-slate-500' 
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? isDarkMode ? 'bg-[#25D366] text-slate-950 font-bold' : 'bg-slate-900 text-white'
                : isDarkMode 
                  ? 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Tous ({prospects.length})
          </button>
          {Object.keys(STATUS_CONFIG).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white font-bold'
                  : isDarkMode 
                    ? 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800' 
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Prospects List */}
      {filteredProspects.length === 0 ? (
        <div className={`rounded-2xl p-12 text-center border shadow-xs space-y-3 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200/80 text-slate-900'
        }`}>
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ${
            isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'
          }`}>
            <Users className="w-8 h-8" />
          </div>
          <h3 className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            Aucun contact trouvé
          </h3>
          <p className={`text-xs max-w-sm mx-auto ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            Enregistrez les coordonnées des personnes qui vous contactent pour garder un suivi commercial rigoureux.
          </p>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter un premier contact</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProspects.map((prospect) => {
            const statusInfo = STATUS_CONFIG[prospect.status] || STATUS_CONFIG['Nouveau'];
            const badgeClass = isDarkMode ? statusInfo.darkBadge : statusInfo.lightBadge;

            return (
              <div
                key={prospect.id}
                className={`rounded-2xl p-4 border shadow-xs hover:shadow-md transition-all flex flex-col justify-between ${
                  isDarkMode 
                    ? 'bg-slate-900 border-slate-800 hover:border-slate-700 text-white shadow-black/20' 
                    : 'bg-white border-slate-200/80 hover:border-slate-300 text-slate-900'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {prospect.name}
                      </h4>
                      <p className={`text-xs flex items-center gap-1 mt-0.5 ${
                        isDarkMode ? 'text-slate-400' : 'text-slate-500'
                      }`}>
                        <Phone className="w-3 h-3 text-[#25D366]" />
                        <span>{prospect.phone}</span>
                      </p>
                    </div>

                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeClass}`}>
                      {statusInfo.label}
                    </span>
                  </div>

                  <div className={`rounded-xl p-2.5 text-xs my-2 min-h-[48px] border transition-colors ${
                    isDarkMode 
                      ? 'bg-slate-950/70 border-slate-800 text-slate-300' 
                      : 'bg-slate-50 border-slate-100 text-slate-600'
                  }`}>
                    {prospect.notes ? (
                      <p className="line-clamp-2 leading-relaxed">{prospect.notes}</p>
                    ) : (
                      <span className="text-slate-500 italic">Aucune note particulière.</span>
                    )}
                  </div>
                </div>

                <div className={`pt-3 border-t flex items-center justify-between ${
                  isDarkMode ? 'border-slate-800' : 'border-slate-100'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onSelectForAI(prospect)}
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        isDarkMode 
                          ? 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60' 
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/60'
                      }`}
                      title="Rédiger avec l'IA pour ce prospect"
                    >
                      <Sparkles className="w-3 h-3 text-[#25D366]" />
                      <span>Script IA</span>
                    </button>

                    <button
                      onClick={() => handleDirectWhatsApp(prospect)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        isDarkMode 
                          ? 'bg-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/30' 
                          : 'bg-[#25D366]/10 text-emerald-700 hover:bg-[#25D366]/20'
                      }`}
                      title="Ouvrir WhatsApp directement"
                    >
                      <MessageCircle className="w-4 h-4 fill-current text-[#25D366]" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(prospect)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        isDarkMode 
                          ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' 
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                      }`}
                      title="Modifier"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(prospect.id, prospect.name)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        isDarkMode 
                          ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/40' 
                          : 'text-rose-500 hover:text-rose-700 hover:bg-rose-50'
                      }`}
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal with Adaptive Dark Styling */}
      {modalOpen && (
        <div 
          id="prospect-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
          onClick={handleCloseModal}
        >
          <div 
            className={`rounded-3xl max-w-md w-full p-6 shadow-2xl border transition-all ${
              isDarkMode 
                ? 'bg-slate-900 border-slate-750 text-white shadow-black/80' 
                : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between pb-3 border-b ${
              isDarkMode ? 'border-slate-800' : 'border-slate-100'
            }`}>
              <h3 className={`text-base font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {editingProspect ? 'Modifier le contact' : 'Nouveau prospect WhatsApp'}
              </h3>
              <button
                onClick={handleCloseModal}
                className={`p-1 rounded-full cursor-pointer transition-colors ${
                  isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  Nom complet du prospect *
                </label>
                <input
                  type="text"
                  placeholder="Ex : Sarah Bennani"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-colors ${
                    isDarkMode 
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' 
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                  required
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  Numéro WhatsApp (avec indicatif) *
                </label>
                <input
                  type="tel"
                  placeholder="Ex : +212600000000 ou +2250700000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-colors ${
                    isDarkMode 
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' 
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                  required
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  Statut du prospect
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProspectStatus)}
                  className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-colors ${
                    isDarkMode 
                      ? 'bg-slate-800 border-slate-700 text-white' 
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                >
                  <option value="Nouveau" className={isDarkMode ? 'bg-slate-800 text-white' : ''}>Nouveau</option>
                  <option value="Intéressé" className={isDarkMode ? 'bg-slate-800 text-white' : ''}>Intéressé</option>
                  <option value="À relancer" className={isDarkMode ? 'bg-slate-800 text-white' : ''}>À relancer</option>
                  <option value="Converti" className={isDarkMode ? 'bg-slate-800 text-white' : ''}>Converti</option>
                  <option value="Perdu" className={isDarkMode ? 'bg-slate-800 text-white' : ''}>Sans suite</option>
                </select>
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isDarkMode ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  Notes & Besoins exprimés
                </label>
                <textarea
                  rows={3}
                  placeholder="Articles demandés, taille, budget, date d’événement..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={`w-full border rounded-xl p-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366] transition-colors ${
                    isDarkMode 
                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' 
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <div className={`pt-3 border-t flex items-center justify-end gap-2.5 ${
                isDarkMode ? 'border-slate-800' : 'border-slate-100'
              }`}>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    isDarkMode 
                      ? 'text-slate-400 hover:text-white hover:bg-slate-800' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs shadow-md disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Enregistrer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
