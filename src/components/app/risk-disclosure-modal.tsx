'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ScrollText,
  CalendarClock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ScrollArea,
} from '@/components/ui/scroll-area';
import {
  getRiskDisclosure,
  getRiskDisclosureStatus,
  acknowledgeRiskDisclosure,
} from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { RiskDisclosureStatus } from '@/lib/types';

interface RiskDisclosureModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called once acknowledgment succeeds — caller (bot-control) proceeds with the action. */
  onAcknowledged?: () => void;
}

/**
 * RiskDisclosureModal — Sprint 5/6 acknowledgment gate.
 *
 * The modal shows the full disclosure text + two checkboxes ("I have read…" /
 * "I agree to follow V2 rules") and calls POST /api/risk-disclosure/acknowledge.
 * The bot-control component gates Start Bot behind this modal whenever the
 * backend reports `requires_reack: true` or `acknowledged: false`.
 */
export function RiskDisclosureModal({ open, onOpenChange, onAcknowledged }: RiskDisclosureModalProps) {
  const [text, setText] = useState<string>('');
  const [status, setStatus] = useState<RiskDisclosureStatus | null>(null);
  const [acceptedRisks, setAcceptedRisks] = useState(false);
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const authUser = useAppStore((s) => s.authUser);

  // Load disclosure text + status when the modal opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([getRiskDisclosure(), getRiskDisclosureStatus()])
      .then(([r, s]) => {
        setText(r.text);
        setStatus(s);
      })
      .catch((e) => {
        toast({
          title: 'Gagal memuat risk disclosure',
          description: String(e),
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  }, [open]);

  const expiryDate = status?.expires_at ? new Date(status.expires_at) : null;
  const ackDate = status?.acknowledged_at ? new Date(status.acknowledged_at) : null;

  const handleSubmit = async () => {
    if (!acceptedRisks || !acceptedRules) {
      toast({
        title: 'Acknowledgment belum lengkap',
        description: 'Centang kedua checkbox untuk melanjutkan.',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await acknowledgeRiskDisclosure({
        version: '2.0',
        accepted_rules: acceptedRules,
        accepted_risks: acceptedRisks,
      });
      toast({
        title: 'Risk disclosure acknowledged',
        description: `Valid until ${new Date(res.expires_at).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Jakarta',
        })} WIB`,
      });
      onOpenChange(false);
      onAcknowledged?.();
    } catch (e) {
      toast({
        title: 'Acknowledgment gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = acceptedRisks && acceptedRules && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warn" />
            Risk Disclosure Acknowledgment
          </DialogTitle>
          <DialogDescription className="text-xs">
            Wajib di-acknowledge sebelum start bot. Valid 30 hari, kemudian re-acknowledge otomatis.
          </DialogDescription>
        </DialogHeader>

        {/* Status strip */}
        {status && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge
              variant="outline"
              className={cn(
                'gap-1',
                status.acknowledged ? 'text-bull border-bull' : 'text-bear border-bear',
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              {status.acknowledged ? 'Acknowledged' : 'Not acknowledged'}
            </Badge>
            {ackDate && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <CalendarClock className="h-3 w-3" />
                Acked: {ackDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Jakarta' })}
              </Badge>
            )}
            {expiryDate && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1',
                  status.requires_reack ? 'text-warn border-warn' : 'text-info border-info',
                )}
              >
                <CalendarClock className="h-3 w-3" />
                Expires: {expiryDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Jakarta' })}
                {status.days_remaining !== null && ` (${status.days_remaining}d)`}
              </Badge>
            )}
            {status.requires_reack && (
              <Badge variant="outline" className="text-warn border-warn">
                RE-ACKNOWLEDGE REQUIRED
              </Badge>
            )}
          </div>
        )}

        {/* Disclosure text */}
        <ScrollArea className="h-[260px] rounded-md border p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-[11px] font-mono leading-relaxed text-muted-foreground">
              {text}
            </pre>
          )}
        </ScrollArea>

        {/* Checkboxes */}
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="ack-risks"
              checked={acceptedRisks}
              onCheckedChange={(v) => setAcceptedRisks(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="ack-risks" className="text-xs cursor-pointer leading-relaxed">
              <strong>I have read and understood the risks</strong> — Trading forex
              involves substantial risk of loss; the V2 strategy is not a profit guarantee;
              past performance (backtests) does not indicate future results.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="ack-rules"
              checked={acceptedRules}
              onCheckedChange={(v) => setAcceptedRules(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="ack-rules" className="text-xs cursor-pointer leading-relaxed">
              <strong>I agree to follow the V2 strategy rules</strong> — including the
              tiered stop (-1% / -2% / -4% / -10%), 1% risk per trade, max 3 simultaneous
              positions, max 5 trades/day, ADX regime filter, and the kill switch.
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="gap-1.5">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScrollText className="h-4 w-4" />
            )}
            Acknowledge &amp; Continue
          </Button>
        </DialogFooter>

        <p className="text-[10px] text-muted-foreground">
          Acknowledged by: <strong>{authUser?.username ?? 'unknown'}</strong>
        </p>
      </DialogContent>
    </Dialog>
  );
}
