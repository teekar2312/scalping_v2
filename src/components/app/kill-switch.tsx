'use client';

import { ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { controlBot } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';

export function KillSwitchButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleKill = async () => {
    setLoading(true);
    try {
      const result = await controlBot('kill');
      toast({
        title: 'KILL SWITCH ACTIVATED',
        description: result.message + '. Semua posisi ditutup, bot dihentikan.',
        variant: 'destructive',
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Kill switch gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5 font-semibold kill-glow"
        >
          <ShieldAlert className="h-4 w-4" />
          KILL SWITCH
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            AKTIVASI KILL SWITCH
          </AlertDialogTitle>
          <AlertDialogDescription asChild className="text-sm">
            <div>
              <strong className="text-foreground">PERINGATAN:</strong> Tindakan ini akan:
              <ul className="mt-2 list-disc pl-4 space-y-1">
                <li>Menutup SEMUA posisi terbuka via market order</li>
                <li>Membatalkan semua pending orders</li>
                <li>Menghentikan trading engine secara paksa</li>
                <li>Mengunci bot sampai manual reset</li>
              </ul>
              <span className="mt-3 block text-xs text-muted-foreground">
                Hanya gunakan saat darurat (loss tidak terkendali, news black swan, atau kesalahan sistem).
                Eksekusi tidak dapat dibatalkan.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="gap-1.5">
            <X className="h-4 w-4" />
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleKill}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
          >
            <ShieldAlert className="h-4 w-4" />
            {loading ? 'EKSEKUSI...' : 'KILL SEKARANG'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
