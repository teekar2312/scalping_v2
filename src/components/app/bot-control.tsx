'use client';

import { Play, Square, Loader2, Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { controlBot } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BotStatus } from '@/lib/types';

interface BotControlProps {
  status?: BotStatus;
  onStatusChange?: (status: BotStatus) => void;
}

export function BotControl({ status: externalStatus, onStatusChange }: BotControlProps) {
  const [internalStatus, setInternalStatus] = useState<BotStatus>(externalStatus || 'STOPPED');
  const [loading, setLoading] = useState<'start' | 'stop' | null>(null);

  useEffect(() => {
    if (externalStatus) setInternalStatus(externalStatus);
  }, [externalStatus]);

  const handleAction = async (action: 'start' | 'stop') => {
    setLoading(action);
    try {
      const result = await controlBot(action);
      const newStatus: BotStatus = action === 'start' ? 'RUNNING' : 'STOPPED';
      setInternalStatus(newStatus);
      onStatusChange?.(newStatus);
      toast({
        title: action === 'start' ? 'Bot dimulai' : 'Bot dihentikan',
        description: result.message,
      });
    } catch (e) {
      toast({ title: 'Gagal', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  const isRunning = internalStatus === 'RUNNING';
  const isKilled = internalStatus === 'KILLED';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isRunning && 'bg-bull pulse-bull',
            !isRunning && !isKilled && 'bg-muted-foreground',
            isKilled && 'bg-bear pulse-bear'
          )}
        />
        <span className="text-xs font-medium tabular-nums">
          {isRunning ? 'LIVE' : isKilled ? 'KILLED' : 'STOP'}
        </span>
      </div>

      {!isRunning && !isKilled && (
        <Button
          size="sm"
          variant="default"
          className="gap-1.5"
          onClick={() => handleAction('start')}
          disabled={loading !== null}
        >
          {loading === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start Bot
        </Button>
      )}

      {isRunning && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => handleAction('stop')}
          disabled={loading !== null}
        >
          {loading === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          Stop
        </Button>
      )}
    </div>
  );
}
