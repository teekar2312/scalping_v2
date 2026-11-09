'use client';

import { Play, Square, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { controlBot, getRiskDisclosureStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RiskDisclosureModal } from './risk-disclosure-modal';
import type { BotStatus, RiskDisclosureStatus } from '@/lib/types';

interface BotControlProps {
  status?: BotStatus;
  onStatusChange?: (status: BotStatus) => void;
}

export function BotControl({ status: externalStatus, onStatusChange }: BotControlProps) {
  const [internalStatus, setInternalStatus] = useState<BotStatus>(externalStatus || 'STOPPED');
  const [loading, setLoading] = useState<'start' | 'stop' | null>(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [riskStatus, setRiskStatus] = useState<RiskDisclosureStatus | null>(null);
  const [pendingStart, setPendingStart] = useState(false);

  useEffect(() => {
    if (externalStatus) setInternalStatus(externalStatus);
  }, [externalStatus]);

  // When the user clicks Start, first check risk disclosure status.
  const attemptStart = async () => {
    setLoading('start');
    try {
      const status = await getRiskDisclosureStatus();
      setRiskStatus(status);
      if (!status.acknowledged || status.requires_reack) {
        // Show the modal — actual bot start happens after acknowledgment.
        setPendingStart(true);
        setRiskModalOpen(true);
        return;
      }
      await actuallyStart();
    } catch (e) {
      // Non-fatal: continue with start (backend will also enforce)
      await actuallyStart();
    } finally {
      setLoading(null);
    }
  };

  const actuallyStart = async () => {
    setLoading('start');
    try {
      const result = await controlBot('start');
      setInternalStatus('RUNNING');
      onStatusChange?.('RUNNING');
      toast({
        title: 'Bot dimulai',
        description: result.message,
      });
    } catch (e) {
      toast({ title: 'Gagal', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  const handleStop = async () => {
    setLoading('stop');
    try {
      const result = await controlBot('stop');
      setInternalStatus('STOPPED');
      onStatusChange?.('STOPPED');
      toast({
        title: 'Bot dihentikan',
        description: result.message,
      });
    } catch (e) {
      toast({ title: 'Gagal', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  // After acknowledgment succeeds, run the original Start action.
  const handleAcknowledged = () => {
    if (pendingStart) {
      setPendingStart(false);
      void actuallyStart();
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
        {riskStatus?.requires_reack && (
          <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 text-warn border-warn">
            RISK
          </Badge>
        )}
      </div>

      {!isRunning && !isKilled && (
        <Button
          size="sm"
          variant="default"
          className="gap-1.5"
          onClick={attemptStart}
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
          onClick={handleStop}
          disabled={loading !== null}
        >
          {loading === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          Stop
        </Button>
      )}

      <RiskDisclosureModal
        open={riskModalOpen}
        onOpenChange={setRiskModalOpen}
        onAcknowledged={handleAcknowledged}
      />
    </div>
  );
}
