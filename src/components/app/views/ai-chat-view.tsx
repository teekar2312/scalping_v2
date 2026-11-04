'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, User, Loader2, Trash2, Zap } from 'lucide-react';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { aiChat } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/types';

const QUICK_PROMPTS = [
  { label: 'ADX & Regime', prompt: 'Jelaskan ADX filter regime V2 dan kapan harus trade/skip' },
  { label: 'RR Net & Biaya', prompt: 'Bagaimana cara hitung RR net setelah biaya transaksi?' },
  { label: 'SL Adaptif ATR', prompt: 'Jelaskan rumus stop loss adaptif berbasis ATR(14)' },
  { label: 'Jam Trading', prompt: 'Sesi trading WIB mana yang terbaik untuk scalping?' },
  { label: 'Pemilihan Pair', prompt: 'Pair mana yang direkomendasikan untuk pemula scalping?' },
  { label: 'Checklist V2', prompt: 'Sebutkan 8 poin pre-trade checklist V2' },
  { label: 'Kill Switch', prompt: 'Bagaimana kill switch dan tiered stop bekerja?' },
  { label: 'Psikologi', prompt: 'Apa 5 musuh scalper V2 dan mitigasinya?' },
];

export function AiChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial system context
    setMessages([
      {
        id: 'sys-1',
        role: 'system',
        content:
          'AI Analyst dengan context Strategi Scalping Forex V2 — 3 indikator core (EMA+VWAP+ATR), ADX regime filter, ATR-based SL, RR net ≥ 2.0, tiered stop. Pair EUR/USD #1, GBP/USD #2, USD/JPY #3.',
        context: 'system',
        model: 'llama3.2:latest',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'init-1',
        role: 'assistant',
        content:
          'Halo! Saya AI Analyst dengan context penuh Strategi Scalping V2. Saya bisa bantu menganalisa setup, menjelaskan aturan V2 (ADX, RR net, SL adaptif, checklist), atau memberi rekomendasi psikologi trading.\n\nCoba tanya: "Jelaskan ADX filter regime" atau klik salah satu quick prompt di bawah.',
        context: 'general',
        model: 'llama3.2:latest',
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      context: 'general',
      model: 'llama3.2:latest',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await aiChat([...messages, userMsg]);
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response,
        context: 'general',
        model: 'llama3.2:latest',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${String(e)}`,
          context: 'error',
          model: 'llama3.2:latest',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages((prev) => prev.filter((m) => m.role === 'system'));
  };

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        {/* Main chat */}
        <PanelCard
          title="AI Chat — Ollama llama3.2:latest"
          subtitle="Context: Strategi Scalping V2"
          icon={Bot}
          actions={
            <>
              <Badge variant="outline" className="text-[10px]">
                <Sparkles className="h-2.5 w-2.5 mr-1" /> llama3.2
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleClear} title="Clear chat">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          }
          className="xl:col-span-3"
          bodyClassName="flex flex-col h-[calc(100vh-260px)]"
        >
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin space-y-3 py-3">
            {messages
              .filter((m) => m.role !== 'system')
              .map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex gap-2',
                    m.role === 'user' && 'flex-row-reverse'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-info/20 text-info'
                    )}
                  >
                    {m.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  </div>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-md px-3 py-2 text-xs',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 border'
                    )}
                  >
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{m.content}</pre>
                  </div>
                </div>
              ))}
            {loading && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-info/20 text-info">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  llama3.2 sedang berpikir...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t pt-3">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tanya AI tentang strategi V2, analisa setup, atau psikologi trading..."
                className="min-h-[60px] max-h-[120px] resize-none text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                size="sm"
                className="self-end"
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </PanelCard>

        {/* Quick prompts */}
        <PanelCard
          title="Quick Prompts"
          subtitle="Topik strategi V2"
          icon={Zap}
          bodyClassName="h-[calc(100vh-260px)]"
        >
          <div className="flex flex-col gap-2 pt-3">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                onClick={() => handleSend(q.prompt)}
                disabled={loading}
                className="rounded-md border p-2 text-left text-xs hover:bg-accent/50 disabled:opacity-50 transition-colors"
              >
                <div className="font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-info" />
                  {q.label}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{q.prompt}</div>
              </button>
            ))}
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
