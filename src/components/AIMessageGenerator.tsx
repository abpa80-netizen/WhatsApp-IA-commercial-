import React, { useState, useEffect, useRef } from 'react';
import { 
  Vendeur, 
  Product, 
  AIMessageObjective, 
  AIMessageTone, 
  Prospect 
} from '../types';
import { 
  Sparkles, 
  Copy, 
  MessageCircle, 
  Check, 
  Send,
  Zap,
  Target,
  Sliders,
  Bot,
  User,
  RotateCcw,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  Loader2,
  PhoneCall,
  Clock,
  Sparkle
} from 'lucide-react';
import { generateCommercialScript, formatCurrency } from '../services/aiGenerator';
import { GeminiClient, ChatMessage } from '../services/geminiClient';
import { useToast } from './Toast';
import { getVendorEntitlements } from '../services/entitlements';

interface AIMessageGeneratorProps {
  vendeur: Vendeur;
  products: Product[];
  prospects?: Prospect[];
  initialProspectId?: string;
  onOpenUpgradeModal: () => void;
}

const COACH_QUICK_PROMPTS = [
  {
    title: 'Relance prospect indécis',
    prompt: 'Rédige-moi un message WhatsApp chaleureux et persuasif pour relancer un client qui m’a dit "Je vais réfléchir" hier soir.',
    icon: '⏳',
  },
  {
    title: 'Objection : C’est trop cher',
    prompt: 'Un prospect trouve que nos prix sont trop élevés par rapport à la concurrence. Donne-moi le meilleur argumentaire WhatsApp pour justifier la qualité et conclure la vente sans brader mon prix.',
    icon: '💡',
  },
  {
    title: 'Promo Flash WhatsApp',
    prompt: 'Crée un message pour une vente flash de 24h sur WhatsApp avec un sentiment d’urgence puissant et des emojis percutants.',
    icon: '🔥',
  },
  {
    title: 'Message en Darija marocaine',
    prompt: 'Rédige un message commercial très accrocheur en Darija marocaine (mélange arabizi/français vendeur) pour annoncer un arrivage exclusif.',
    icon: '🇲🇦',
  },
  {
    title: 'Fidélisation post-achat',
    prompt: 'Rédige un message WhatsApp de remerciement après livraison d’une commande, demandant un avis client et proposant un coupon fidélité.',
    icon: '⭐',
  },
];

export const AIMessageGenerator: React.FC<AIMessageGeneratorProps> = ({
  vendeur,
  products,
  prospects = [],
  initialProspectId,
  onOpenUpgradeModal,
}) => {
  const { showToast } = useToast();

  // Mode switcher: 'chat' (Gemini Chatbot) vs 'script_tool' (Classic Template Builder)
  const [activeMode, setActiveMode] = useState<'chat' | 'script_tool'>('chat');

  // --- CHATBOT STATE ---
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'model',
      text: `👋 Bonjour ${vendeur.name} ! Je suis votre **Coach Commercial & Assistant WhatsApp**.

Je suis là pour vous aider à booster vos ventes au quotidien :
• Rédiger des relances percutantes pour vos prospects indécis
• Répondre aux objections sur le prix ou la livraison
• Créer des offres flash irrésistibles pour vos statuts WhatsApp
• Vous conseiller sur les meilleures techniques de closing direct

Que souhaitez-vous préparer aujourd'hui ? Choisissez une suggestion ci-dessous ou écrivez-moi directement !`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedCrmProspectId, setSelectedCrmProspectId] = useState<string>(initialProspectId || '');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialProspectId) {
      setSelectedCrmProspectId(initialProspectId);
      setSelectedProspectId(initialProspectId);
    }
  }, [initialProspectId]);

  // Auto-scroll chat
  useEffect(() => {
    if (activeMode === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatLoading, activeMode]);

  // Handle Send Chat
  const handleSendChatMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputMessage;
    if (!textToSend.trim() || isChatLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!customPrompt) setInputMessage('');
    setIsChatLoading(true);

    try {
      const historyForApi = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, text: m.text }));

      const topProductsStr = products
        .slice(0, 5)
        .map((p) => `${p.name} (${p.price} ${vendeur.currency})`)
        .join(', ');

      const reply = await GeminiClient.sendChat({
        message: textToSend.trim(),
        history: historyForApi,
        vendorContext: {
          name: vendeur.name,
          currency: vendeur.currency,
          location: vendeur.location,
          productsCount: products.length,
          topProducts: topProductsStr,
          prospectsCount: prospects.length,
        },
      });

      const aiMessage: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: `⚠️ Désolé, une petite erreur est survenue lors de la communication avec Gemini (${err.message || 'Réseau'}). Veuillez réessayer dans un instant.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Reset conversation
  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'model',
        text: `Conversation réinitialisée ! 🔄 Comment puis-je vous accompagner pour vos ventes aujourd'hui, ${vendeur.name} ?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    showToast('Nouvelle conversation démarrée', 'info');
  };

  // Handle Prospect CRM Auto-Follow-up prompt
  const handleTriggerProspectRelance = () => {
    if (!selectedCrmProspectId) {
      showToast('Sélectionnez d’abord un prospect dans le menu', 'info');
      return;
    }
    const prospect = prospects.find((p) => p.id === selectedCrmProspectId);
    if (!prospect) return;

    const promptText = `Peux-tu rédiger un message de relance WhatsApp ultra personnalisé pour ce prospect de mon CRM ?
- Nom du prospect : ${prospect.name}
- Statut actuel : ${prospect.status}
- Produit ou intérêt noté : ${prospect.notes || 'Intérêt général pour notre catalogue'}
- Téléphone : ${prospect.phone}
- Ma boutique : ${vendeur.name} (${vendeur.currency})

Donne-moi un message direct prêt à être copié-collé et envoyé sur WhatsApp avec des formules de politesse adaptées et un appel à l'action clair.`;

    handleSendChatMessage(promptText);
  };

  // Copy helper
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Message copié dans le presse-papier !', 'success');
  };

  // WhatsApp open helper
  const handleSendViaWhatsApp = (text: string, phone?: string) => {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const encoded = encodeURIComponent(text);
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
    showToast('Ouverture de WhatsApp...', 'info');
  };

  // --- SCRIPT BUILDER STATE (SUB-TAB) ---
  const [selectedProductId, setSelectedProductId] = useState<string>('custom');
  const [customProductName, setCustomProductName] = useState('');
  const [targetAudience, setTargetAudience] = useState('Clients exigeants & modernes');
  const [priceInput, setPriceInput] = useState('');
  const [objective, setObjective] = useState<AIMessageObjective>('prospection');
  const [tone, setTone] = useState<AIMessageTone>('amical');
  const [selectedProspectId, setSelectedProspectId] = useState<string>('');
  const [targetPhone, setTargetPhone] = useState('');
  const [generatedScript, setGeneratedScript] = useState('');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  useEffect(() => {
    if (products.length > 0 && selectedProductId === 'custom' && !customProductName) {
      const first = products[0];
      setSelectedProductId(first.id);
      setCustomProductName(first.name);
      setPriceInput(formatCurrency(first.price, vendeur.currency));
    }
  }, [products]);

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    if (prodId === 'custom') {
      setCustomProductName('');
      setPriceInput('');
    } else {
      const found = products.find((p) => p.id === prodId);
      if (found) {
        setCustomProductName(found.name);
        setPriceInput(formatCurrency(found.price, vendeur.currency));
      }
    }
  };

  const handleProspectChange = (prospId: string) => {
    setSelectedProspectId(prospId);
    if (prospId) {
      const p = prospects.find((item) => item.id === prospId);
      if (p) setTargetPhone(p.phone);
    }
  };

  const activeProspect = prospects.find((p) => p.id === selectedProspectId);

  const handleGenerateScript = async () => {
    const prodName = selectedProductId === 'custom' 
      ? customProductName 
      : (products.find((p) => p.id === selectedProductId)?.name || customProductName);

    if (!prodName.trim()) {
      showToast('Veuillez spécifier le nom du produit', 'info');
      return;
    }

    setIsGeneratingScript(true);
    try {
      // First try Gemini server
      const scriptPrompt = `Rédige un message WhatsApp commercial d'excellence pour le produit "${prodName.trim()}".
Objectif : ${objective}
Ton : ${tone}
Public cible : ${targetAudience}
${priceInput ? `Prix : ${priceInput}` : ''}
${activeProspect ? `Nom du prospect : ${activeProspect.name}` : ''}
Boutique : ${vendeur.name}
Inclus des emojis percutants et un appel à l'action clair.`;

      const aiReply = await GeminiClient.sendChat({
        message: scriptPrompt,
        history: [],
        vendorContext: {
          name: vendeur.name,
          currency: vendeur.currency,
          location: vendeur.location,
          productsCount: products.length,
        },
      });

      setGeneratedScript(aiReply);
      showToast('Script commercial généré avec succès !', 'success');
    } catch {
      // Fallback to local script generator
      const script = generateCommercialScript({
        productName: prodName.trim(),
        targetAudience: targetAudience.trim(),
        price: priceInput.trim(),
        currency: vendeur.currency,
        objective,
        tone,
        prospectName: activeProspect?.name,
        sellerName: vendeur.name,
      });
      setGeneratedScript(script);
      showToast('Script commercial généré avec succès !', 'success');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  if (!getVendorEntitlements(vendeur).hasPremiumAccess) {
    return (
      <div id="ai-premium-locked" className="max-w-2xl mx-auto my-10 bg-white rounded-3xl border border-amber-200 shadow-sm p-8 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-xl font-bold text-slate-900">Assistant IA réservé à l’essai et au Pack VIP</h2>
        <p className="text-sm text-slate-600">Votre période d’essai est terminée. En mode gratuit, le catalogue public reste limité à 4 produits et l’accès à l’IA, au CRM et aux analyses est désactivé.</p>
        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
          <button onClick={onOpenUpgradeModal} className="inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold px-6 py-3 rounded-xl"><Crown className="w-4 h-4" /> Débloquer le Pack VIP</button>
          <button onClick={onOpenUpgradeModal} className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-6 py-3 rounded-xl"><MessageCircle className="w-4 h-4" /> Voir l’offre et contacter le support</button>
        </div>
      </div>
    );
  }

  return (
    <div id="ai-generator" className="space-y-6">
      {/* Top Header & Mode Switcher */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#25D366] to-emerald-400 text-slate-950 flex items-center justify-center shrink-0 shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Commercial IA & Coach de Vente</h2>
              <span className="bg-emerald-50 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-200">
                Gemini 3.8
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Assistant intelligent multi-tours pour coacher vos ventes, lever les objections et relancer vos prospects.
            </p>
          </div>
        </div>

        {/* Navigation Switcher */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200/80">
          <button
            onClick={() => setActiveMode('chat')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeMode === 'chat'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-[#25D366]" />
            <span>Coach Chatbot IA</span>
          </button>

          <button
            onClick={() => setActiveMode('script_tool')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeMode === 'script_tool'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-purple-600" />
            <span>Générateur Express</span>
          </button>
        </div>
      </div>

      {/* MODE 1: CHATBOT GEMINI & COACH CRM */}
      {activeMode === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Chat Thread (Left / Top) */}
          <div className="lg:col-span-8 flex flex-col bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden h-[680px]">
            {/* Chat header */}
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-[#25D366] text-slate-950 flex items-center justify-center font-bold">
                    <Bot className="w-4 h-4" />
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-slate-900 rounded-full" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Coach Commercial WhatsApp</span>
                    <span className="text-[10px] text-emerald-400 font-normal">En ligne</span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Propulsé par Gemini AI • Contexte boutique actif
                  </p>
                </div>
              </div>

              <button
                onClick={handleResetChat}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer text-[11px] flex items-center gap-1"
                title="Recommencer une nouvelle session"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Effacer l'historique</span>
              </button>
            </div>

            {/* Scrollable messages container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/50">
              {messages.map((m) => {
                const isUser = m.role === 'user';

                return (
                  <div
                    key={m.id}
                    className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 ${
                        isUser
                          ? 'bg-slate-800 text-white font-bold'
                          : 'bg-[#25D366] text-slate-950 font-bold shadow-xs'
                      }`}
                    >
                      {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>

                    {/* Bubble */}
                    <div
                      className={`max-w-[85%] sm:max-w-[78%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-xs ${
                        isUser
                          ? 'bg-slate-900 text-white rounded-tr-none'
                          : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                      }`}
                    >
                      <div className="whitespace-pre-wrap font-sans">{m.text}</div>

                      <div
                        className={`flex items-center justify-between gap-3 mt-2.5 pt-2 border-t text-[10px] ${
                          isUser ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-400'
                        }`}
                      >
                        <span>{m.timestamp}</span>

                        {/* Quick action buttons for AI responses */}
                        {!isUser && m.id !== 'welcome' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleCopyText(m.text)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors cursor-pointer"
                              title="Copier ce message"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copier</span>
                            </button>

                            <button
                              onClick={() => handleSendViaWhatsApp(m.text)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md transition-colors cursor-pointer font-bold"
                              title="Ouvrir dans WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3 text-[#25D366]" />
                              <span>WhatsApp</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isChatLoading && (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#25D366] text-slate-950 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs text-slate-500 shadow-xs flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#25D366]" />
                    <span>Le Coach IA prépare votre réponse commerciale...</span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Quick Prompt Chips (Above Input) */}
            <div className="px-4 py-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto">
              <span className="text-[10px] font-bold text-slate-400 shrink-0">Suggestions :</span>
              {COACH_QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendChatMessage(qp.prompt)}
                  disabled={isChatLoading}
                  className="text-[11px] bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 px-2.5 py-1 rounded-full whitespace-nowrap transition-colors border border-slate-200/80 cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-1"
                >
                  <span>{qp.icon}</span>
                  <span>{qp.title}</span>
                </button>
              ))}
            </div>

            {/* Input bar */}
            <div className="p-3 sm:p-4 bg-white border-t border-slate-200">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChatMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Posez une question ou demandez un script commercial personnalisé..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                  disabled={isChatLoading}
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !inputMessage.trim()}
                  className="bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold p-3 rounded-2xl shadow-md transition-all disabled:opacity-50 cursor-pointer shrink-0"
                  title="Envoyer au Coach IA"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Right Sidebar: Coach Ventes & Relance CRM */}
          <div className="lg:col-span-4 space-y-4">
            {/* CRM Follow-up Assistant Card */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#25D366] flex items-center justify-center">
                  <Target className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Coach Relance CRM</h3>
                  <p className="text-[11px] text-slate-500">Relancez vos prospects en 1 clic</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sélectionner un prospect du CRM :
                  </label>
                  {prospects.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 text-center">
                      Aucun prospect enregistré. Ajoutez des contacts dans l'onglet <strong>CRM Prospects</strong>.
                    </div>
                  ) : (
                    <select
                      value={selectedCrmProspectId}
                      onChange={(e) => setSelectedCrmProspectId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                    >
                      <option value="">-- Choisir un client à relancer --</option>
                      {prospects.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name} • {pr.status} ({pr.phone})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedCrmProspectId && (
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs space-y-1">
                    {(() => {
                      const found = prospects.find((p) => p.id === selectedCrmProspectId);
                      if (!found) return null;
                      return (
                        <>
                          <div className="font-bold text-emerald-950 flex items-center justify-between">
                            <span>{found.name}</span>
                            <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-emerald-300">
                              {found.status}
                            </span>
                          </div>
                          <p className="text-emerald-800 text-[11px]">
                            📞 {found.phone}
                          </p>
                          {found.notes && (
                            <p className="text-emerald-700 text-[10px] italic">
                              "{found.notes}"
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleTriggerProspectRelance}
                  disabled={!selectedCrmProspectId || isChatLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Générer un message de relance sur-mesure</span>
                </button>
              </div>
            </div>

            {/* Best Sales Practices Card */}
            <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <TrendingUp className="w-4 h-4" />
                <span>Conseils du Coach Commercial</span>
              </div>
              <ul className="text-xs text-slate-300 space-y-2.5">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Moins de 10 min :</strong> Relancez un prospect dans les 10 minutes suivant sa question pour multiplier vos chances par 3.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Question fermée :</strong> Concluez toujours par un choix binaire (ex : <em>"Préférez-vous livraison matin ou après-midi ?"</em>).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Preuve visuelle :</strong> Envoyez une courte vidéo ou photo réelle de l'article avant de demander l'adresse.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: GENERATEUR EXPRESS DE SCRIPTS */}
      {activeMode === 'script_tool' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Form: Inputs */}
          <div className="lg:col-span-5 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-600" />
              <span>Paramètres du message commercial</span>
            </h3>

            {/* Product selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Produit concerné
              </label>
              <select
                value={selectedProductId}
                onChange={(e) => handleProductChange(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
              >
                <option value="custom">-- Article personnalisé / Nouveauté --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {formatCurrency(p.price, vendeur.currency)}
                  </option>
                ))}
              </select>
            </div>

            {selectedProductId === 'custom' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nom du produit / Offre
                </label>
                <input
                  type="text"
                  placeholder="Ex : Coffret Huile d'Argan Bio & Sérum"
                  value={customProductName}
                  onChange={(e) => setCustomProductName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                />
              </div>
            )}

            {/* Price */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tarif mentionné ({vendeur.currency})
              </label>
              <input
                type="text"
                placeholder="Ex : 290 DH ou 15 000 FCFA"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
              />
            </div>

            {/* Objective */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Objectif commercial
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'prospection', label: '1. Nouveauté / Découverte' },
                  { id: 'relance', label: '2. Relance client indécis' },
                  { id: 'objections', label: '3. Traiter une objection' },
                  { id: 'promo_flash', label: '4. Promotion urgente' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setObjective(item.id as AIMessageObjective)}
                    className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer ${
                      objective === item.id
                        ? 'border-[#25D366] bg-emerald-50/50 text-slate-950 font-bold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tonalité de communication
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'amical', label: 'Chaleureux' },
                  { id: 'pro', label: 'Pro' },
                  { id: 'persuasif', label: 'Persuasif' },
                  { id: 'urgent', label: 'Urgent 🔥' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id as AIMessageTone)}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      tone === t.id
                        ? 'border-[#25D366] bg-emerald-50 text-slate-950 font-bold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Audience */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Public cible ou bénéfice principal
              </label>
              <input
                type="text"
                placeholder="Ex : Femmes actives, passionnés de mode..."
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
              />
            </div>

            {/* Optional Prospect link */}
            {prospects.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Associer un prospect du CRM (Optionnel)
                </label>
                <select
                  value={selectedProspectId}
                  onChange={(e) => handleProspectChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                >
                  <option value="">-- Aucun (Message généraliste) --</option>
                  {prospects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.phone}) - {p.status}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleGenerateScript}
              disabled={isGeneratingScript}
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold py-3 px-4 rounded-xl text-xs sm:text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {isGeneratingScript ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Rédaction en cours avec l'IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Générer le script WhatsApp</span>
                </>
              )}
            </button>
          </div>

          {/* Right Preview: Output */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex-1 flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-[#25D366]" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Aperçu du message WhatsApp
                  </span>
                </div>
                {activeProspect && (
                  <span className="text-[10px] bg-emerald-50 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold">
                    Destinataire : {activeProspect.name}
                  </span>
                )}
              </div>

              {/* Message display bubble */}
              <div className="flex-1 my-4 p-4 rounded-2xl bg-[#DCF8C6]/30 border border-[#25D366]/20 font-sans text-xs sm:text-sm text-slate-900 whitespace-pre-wrap leading-relaxed shadow-inner">
                {generatedScript || (
                  <span className="text-slate-400 italic">
                    Cliquez sur "Générer le script WhatsApp" pour afficher la proposition commerciale personnalisée.
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-3 border-t border-slate-100">
                <button
                  onClick={() => handleCopyText(generatedScript)}
                  disabled={!generatedScript}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-bold py-2.5 px-4 rounded-xl text-xs transition-all disabled:opacity-40 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copier le texte</span>
                </button>

                <button
                  onClick={() => handleSendViaWhatsApp(generatedScript, targetPhone)}
                  disabled={!generatedScript}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs shadow-md transition-all disabled:opacity-40 cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {targetPhone ? `Envoyer à ${targetPhone}` : 'Ouvrir sur WhatsApp'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
