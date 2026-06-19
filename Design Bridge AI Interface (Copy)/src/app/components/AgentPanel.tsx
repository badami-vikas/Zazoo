import { useState } from 'react';
import { Plus, Mic, Send, ChevronDown, Activity, Sparkles, FolderDown, ChevronsRight, ChevronsLeft, MessageSquare, Paperclip, AtSign, Workflow as Ritual, PenTool, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Resizable } from 're-resizable';
import { useLocation, useParams } from 'react-router';
import clsx from 'clsx';

interface AgentPanelProps {
  highlightedRowId: string | null;
  setHighlightedRowId: (id: string | null) => void;
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
}

// Left nav expanded width; the AI panel defaults to 1.4× this and remembers the user's last size.
const NAV_WIDTH = 240;
const DEFAULT_PANEL_WIDTH = Math.round(NAV_WIDTH * 1.4); // 336
const PANEL_WIDTH_KEY = 'bridge.agentPanelWidth';

export function AgentPanel({ highlightedRowId, setHighlightedRowId, isCollapsed, setIsCollapsed }: AgentPanelProps) {
  const [inputText, setInputText] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PANEL_WIDTH;
    const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    return saved && saved >= 240 ? saved : DEFAULT_PANEL_WIDTH;
  });
  
  const location = useLocation();
  const { id } = useParams();
  const decodedId = id ? decodeURIComponent(id) : null;
  const isItemPage = location.pathname.includes('/item/') && decodedId;

  const activeTimelineIndex = 11;

  // Contextual Chat logic based on the page being viewed
  const defaultMessages = [
    { type: 'activity', text: 'Scanning relationship network...', time: '10:41 AM' },
    { type: 'agent', text: 'I noticed several people drifting toward dormancy. Would you like me to suggest reconnection opportunities?', time: '10:42 AM' },
    { type: 'user', text: 'Yes, show me who.', time: '10:45 AM' },
    { type: 'activity', text: 'Analyzing interaction patterns...', refId: 'D-1000', time: '10:45 AM' },
    { type: 'agent', text: 'Found 6 people you haven\'t connected with in 90+ days. They were previously warm relationships. I can draft personalized check-ins.', time: '10:46 AM' },
  ];

  const itemMessages = [
    { type: 'activity', text: `Loading relationship context for ${decodedId}...`, time: '11:01 AM' },
    { type: 'agent', text: `I found 3 shared memories with ${decodedId} from your last conversation. They mentioned transitioning to a new role.`, time: '11:02 AM' },
    { type: 'user', text: `Any signals I should be aware of?`, time: '11:04 AM' },
    { type: 'activity', text: `Checking recent activity and milestones...`, time: '11:04 AM' },
    { type: 'agent', text: `${decodedId} just started at a new company 2 weeks ago. This could be a good time to reconnect and offer support during their transition.`, time: '11:05 AM' },
  ];

  const chatMessages = isItemPage ? itemMessages : defaultMessages;

  const suggestedActions = isItemPage ? [
    `Draft reconnection message for ${decodedId}`,
    'Add milestone: New role transition'
  ] : [
    'Review dormancy risks',
    'Suggest reconnection rituals'
  ];

  const plusMenuOptions = [
    { icon: Paperclip, label: 'Attach files', color: 'text-[var(--info)]' },
    { icon: AtSign, label: 'Mention agents', color: 'text-[var(--info)]' },
    { icon: Ritual, label: 'Rituals', color: 'text-[var(--success)]' },
    { icon: PenTool, label: 'Tools', color: 'text-[var(--warning)]' },
    { icon: Brain, label: 'Skills', color: 'text-[var(--danger)]' },
  ];

  if (isCollapsed) {
    return (
      <div className="w-16 h-full border-l flex flex-col items-center py-4 shrink-0 transition-all cursor-pointer"
        onClick={() => setIsCollapsed(false)}
        style={{
          backgroundColor: 'var(--color-background)',
          borderColor: 'var(--color-border)'
        }}>
        <div className="w-10 h-10 rounded-xl shadow-lg flex items-center justify-center mb-6"
          style={{
            background: `linear-gradient(135deg, var(--color-steel) 0%, var(--color-navy-mid) 100%)`,
            boxShadow: '0 4px 12px rgb(from var(--color-steel) r g b / 0.2)'
          }}>
          <span className="text-white font-semibold text-xl tracking-tighter relative" style={{ fontFamily: 'var(--font-editorial)' }}>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2"
              style={{
                backgroundColor: 'var(--color-sage)',
                boxShadow: '0 0 8px rgb(from var(--color-sage) r g b / 0.8)',
                borderColor: 'var(--color-navy-mid)'
              }} />
            B
          </span>
        </div>
        <div className="flex-1 flex flex-col gap-4">
          <div className="w-10 h-10 rounded-xl border flex items-center justify-center transition-all relative group"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-warm-gray)'
            }}>
            <MessageSquare className="w-5 h-5" />
            <div className="absolute top-0 right-0 w-2 h-2 rounded-full border-2 translate-x-1/3 -translate-y-1/3"
              style={{
                backgroundColor: 'var(--color-amber-soft)',
                borderColor: 'var(--color-background)'
              }} />
          </div>
        </div>
        <ChevronsLeft className="w-5 h-5 text-[var(--color-warm-gray)]" />
      </div>
    );
  }

  return (
    <Resizable
      size={{ width: panelWidth, height: '100%' }}
      minWidth={240}
      maxWidth={800}
      onResizeStop={(_e, _dir, _ref, d) => {
        const w = Math.min(800, Math.max(240, panelWidth + d.width));
        setPanelWidth(w);
        try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(w)); } catch {}
      }}
      enable={{ left: true, right: false, top: false, bottom: false, topRight: false, bottomRight: false, bottomLeft: false, topLeft: false }}
      className="border-l flex flex-col relative shrink-0"
      style={{
        backgroundColor: 'var(--color-background)',
        borderColor: 'var(--color-border)'
      }}
    >
      {/* Panel Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b backdrop-blur shrink-0 z-20"
        style={{
          backgroundColor: 'rgb(from var(--color-background) r g b / 0.8)',
          borderColor: 'var(--color-border)'
        }}>
        <button 
          onClick={() => setIsCollapsed(true)}
          className="p-2 rounded-lg transition-colors mr-2"
          style={{
            color: 'var(--color-warm-gray)',
            backgroundColor: 'transparent'
          }}
          title="Collapse Panel"
        >
          <ChevronsRight className="w-5 h-5" />
        </button>
        
        <div className="font-bold text-lg tracking-tight flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[var(--color-steel)] to-[var(--color-navy-mid)] flex items-center justify-center shadow-md shadow-[var(--color-steel)]/20">
            <span className="text-white text-xs font-semibold">B</span>
          </div>
          <span className="text-[var(--color-navy)]">Bridge</span>
          <span className="text-[var(--color-steel)]">AI</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-steel-light)] shadow-[0_0_6px_rgba(127, 165, 197,0.8)] ml-1 animate-pulse"></div>
        </div>
        
        {/* Invisible spacer to balance the header since the collapse arrow is on the left now */}
        <div className="w-9"></div>
      </div>
      
      {/* Timeline Navigation (Right Edge Scrubbing) */}
      <div className="absolute right-0 top-14 bottom-0 w-8 bg-transparent flex flex-col items-end justify-center py-10 z-20 group pointer-events-none">
        <div className="flex flex-col items-end w-full gap-1.5 pr-1 hover:pr-2 transition-all duration-300 pointer-events-auto">
          {Array.from({ length: 20 }).map((_, i) => (
            <div 
              key={i} 
              className="flex items-center justify-end w-full h-2 cursor-ns-resize group/dash"
              title={`State ${i}`}
            >
              <div className={clsx(
                "h-[2px] rounded-full transition-all duration-300 group-hover/dash:h-1 group-hover/dash:bg-[var(--color-steel)]",
                i === activeTimelineIndex 
                  ? "w-4 bg-[var(--color-steel)] shadow-[0_0_8px_rgba(77, 126, 168,0.5)]" 
                  : "w-2 bg-[var(--color-border)] group-hover:w-3"
              )} />
            </div>
          ))}
        </div>
      </div>

      {/* Intelligence Layer Feed */}
      <div className="flex-1 overflow-y-auto pr-6 pl-4 py-6 flex flex-col gap-5 relative z-10 scrollbar-hide">
        <div className="text-xs font-bold text-[var(--color-warm-gray)] uppercase tracking-widest mb-2 flex items-center gap-2">
          {isItemPage ? `Context: ${decodedId}` : 'Today'} <div className="h-px bg-[var(--color-border)] flex-1" />
        </div>
        
        {chatMessages.map((msg, idx) => {
          if (msg.type === 'activity') {
            return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex flex-col gap-1 text-xs text-[var(--color-navy-mid)] font-medium px-3 py-2 rounded-lg bg-white border border-[var(--color-border)] shadow-sm transition-all hover:border-[var(--color-steel-light)]/30 hover:shadow-md"
                onMouseEnter={() => msg.refId && setHighlightedRowId(msg.refId)}
                onMouseLeave={() => msg.refId && setHighlightedRowId(null)}
              >
                <div className="flex items-center gap-2">
                  <Activity className={clsx("w-3.5 h-3.5 shrink-0", msg.refId ? "text-[var(--color-steel-light)] animate-pulse" : "text-[var(--color-warm-gray)]")} />
                  <span className={clsx(
                    msg.refId && "cursor-pointer text-[var(--color-navy-mid)] font-semibold border-b border-dashed border-[var(--color-steel-light)] hover:text-[var(--color-steel-light)] hover:border-solid transition-all"
                  )}>
                    {msg.text}
                  </span>
                </div>
                <span className="text-[var(--color-warm-gray)] text-xs self-end">{msg.time}</span>
              </motion.div>
            );
          }

          const isAgent = msg.type === 'agent';
          return (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: idx * 0.1, type: "spring", stiffness: 200, damping: 20 }}
              className={clsx("flex flex-col max-w-[90%]", isAgent ? "self-start" : "self-end")}
            >
              <div className={clsx(
                "p-3 text-sm leading-relaxed shadow-sm backdrop-blur-sm",
                isAgent 
                  ? "bg-white border border-[var(--color-border)] text-[var(--color-navy)] rounded-2xl rounded-tl-sm shadow-[0_2px_10px_rgba(0,0,0,0.02)]" 
                  : "bg-gradient-to-br from-[var(--color-steel)] to-[var(--color-navy-mid)] text-white rounded-2xl rounded-tr-sm shadow-[0_4px_14px_rgba(77, 126, 168,0.2)]"
              )}>
                {msg.text}
              </div>
              <span className={clsx("text-xs text-[var(--color-warm-gray)] mt-1 font-medium tracking-wide", isAgent ? "ml-1" : "mr-1 self-end")}>
                {msg.time}
              </span>
            </motion.div>
          );
        })}

        {/* Action Chips */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: chatMessages.length * 0.1 }}
          className="mt-auto flex flex-col gap-2 pt-6 pb-2"
        >
          <div className="text-xs font-bold text-[var(--color-warm-gray)] uppercase tracking-widest flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-[var(--color-steel)]" /> Suggested
          </div>
          <div className="flex flex-col gap-2">
            {suggestedActions.map((action, i) => (
              <button key={i} className="px-3 py-2 bg-white border border-[var(--color-border)] text-xs font-semibold text-[var(--color-navy-mid)] rounded-xl hover:border-[var(--color-steel)] hover:text-[var(--color-steel)] hover:shadow-[0_4px_12px_rgba(77, 126, 168,0.08)] transition-all flex items-center justify-start text-left">
                {action}
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Modular Command Bar */}
      <div className="pr-4 pl-3 pb-4 pt-2 bg-gradient-to-t from-[#FAF9F5] via-[#FAF9F5] to-transparent relative z-10">
        
        <div className="bg-white border border-[var(--color-border)] rounded-2xl overflow-visible relative transition-all duration-300 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.08)] focus-within:border-[var(--color-steel)] focus-within:ring-2 focus-within:ring-[var(--color-steel)]/20 flex flex-col">
          
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Ask Bridge AI about ${isItemPage ? decodedId : 'anything'}...`}
            className="flex-1 max-h-32 min-h-[60px] resize-none border-none focus:ring-0 px-3 py-3 text-sm bg-transparent placeholder:text-[var(--color-warm-gray)] outline-none leading-relaxed text-[var(--color-navy)]"
            rows={1}
          />

          <div className="flex items-center justify-between px-2 py-1.5 bg-[var(--color-surface)]/80 border-t border-[var(--color-border)] rounded-b-2xl relative">
            
            {/* Left corner: + Dropdown and Model */}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button 
                  onClick={() => setPlusMenuOpen(!plusMenuOpen)}
                  className={clsx(
                    "flex items-center justify-center w-7 h-7 rounded-lg transition-all shadow-sm border",
                    plusMenuOpen ? "bg-[var(--color-steel)] text-white border-[var(--color-steel)]" : "bg-white border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)] text-[var(--color-navy-mid)]"
                  )}
                  title="Attach Files, Call Agents, or Link Skills"
                >
                  <Plus className={clsx("w-4 h-4 transition-transform", plusMenuOpen && "rotate-45")} />
                </button>

                {/* + Dropdown Menu */}
                <AnimatePresence>
                  {plusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPlusMenuOpen(false)} />
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-[var(--color-border)] rounded-xl shadow-xl z-50 overflow-hidden py-1.5"
                      >
                        {plusMenuOptions.map(opt => (
                          <button
                            key={opt.label}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] hover:text-[var(--color-navy)] transition-colors"
                            onClick={() => setPlusMenuOpen(false)}
                          >
                            <opt.icon className={`w-4 h-4 ${opt.color}`} />
                            {opt.label}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
              
              <div className="flex items-center gap-1 px-2 py-1 bg-white border border-[var(--color-border)] rounded-md text-xs font-bold uppercase tracking-wide text-[var(--color-navy-mid)] cursor-pointer shadow-sm hover:border-[var(--color-border)] transition-all hover:bg-[var(--color-surface)] whitespace-nowrap overflow-hidden max-w-[80px]">
                <FolderDown className="w-3 h-3 text-[var(--color-steel)] shrink-0" /> <span className="truncate">Orion-7</span> <ChevronDown className="w-3 h-3 text-[var(--color-warm-gray)] shrink-0" />
              </div>
            </div>
            
            {/* Right corner: Mic and Send */}
            <div className="flex items-center gap-1 shrink-0">
              <button 
                className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] hover:bg-white hover:shadow-sm rounded-lg transition-all group relative border border-transparent hover:border-[var(--color-border)]"
                title="Voice-to-Intent"
              >
                <Mic className="w-3.5 h-3.5 group-hover:text-[var(--color-steel)] transition-colors" />
                <div className="absolute inset-0 rounded-lg border border-[var(--color-steel)] scale-110 opacity-0 group-hover:opacity-100 group-hover:scale-100 transition-all" />
              </button>
              <button 
                className={clsx(
                  "p-1.5 rounded-lg transition-all shadow-sm font-medium",
                  inputText.trim() 
                    ? "bg-[var(--color-steel)] text-white hover:bg-[var(--color-navy-mid)] shadow-md shadow-[var(--color-steel)]/20" 
                    : "bg-[var(--color-border)] text-[var(--color-warm-gray)] cursor-not-allowed"
                )}
              >
                <Send className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Resizable>
  );
}
