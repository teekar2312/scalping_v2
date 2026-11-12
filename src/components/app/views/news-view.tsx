'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, AlertTriangle, Clock, ShieldAlert, ExternalLink } from 'lucide-react';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getNews } from '@/lib/api';
import { V2_RULES } from '@/lib/constants';
import { TIINGO_NEWS_TEMPLATE, WEEKLY_NEWS_BLACKLIST_NOTE } from '@/lib/strategy-content';
import { cn } from '@/lib/utils';
import type { NewsEvent } from '@/lib/types';

export function NewsView() {
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterImpact, setFilterImpact] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');

  useEffect(() => {
    getNews()
      .then(setNews)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat kalender ekonomi...</div>
      </div>
    );
  }

  const now = new Date();
  const upcoming = news.filter((n) => new Date(n.eventTime) > now);
  const past = news.filter((n) => new Date(n.eventTime) <= now);

  const filtered = [...upcoming, ...past].filter(
    (n) => filterImpact === 'ALL' || n.impact === filterImpact
  );

  const inBlackoutNow = news.some((n) => {
    if (!n.blackoutStart || !n.blackoutEnd) return false;
    return now >= new Date(n.blackoutStart) && now <= new Date(n.blackoutEnd);
  });

  const nextHigh = upcoming.find((n) => n.impact === 'HIGH');
  const nextHighTime = nextHigh
    ? new Date(nextHigh?.eventTime).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      })
    : '-';

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Events" value={news.length} icon={CalendarClock} />
        <StatCard label="HIGH Impact" value={news.filter((n) => n.impact === 'HIGH').length} variant="bear" icon={AlertTriangle} />
        <StatCard
          label="Blackout Status"
          value={inBlackoutNow ? 'ACTIVE' : 'CLEAR'}
          variant={inBlackoutNow ? 'bear' : 'bull'}
          icon={ShieldAlert}
          trend={inBlackoutNow ? 'down' : 'up'}
          trendValue={inBlackoutNow ? 'Trading di-skip' : 'Safe to trade'}
        />
        <StatCard
          label="Next HIGH News"
          value={nextHigh ? nextHighTime.split(',')[0] : '-'}
          variant="warn"
          icon={Clock}
          trendValue={nextHigh ? nextHighTime.split(',')[1] : ''}
        />
      </div>

      {/* Blackout warning */}
      {inBlackoutNow && (
        <div className="rounded-md border border-bear bg-bear/10 p-3 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-bear shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-bear">NEWS BLACKOUT ACTIVE — TRADING DIHENTIKAN</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Sedang dalam window ±{V2_RULES.NEWS_BLACKOUT_MINUTES} menit dari news HIGH impact. Bot otomatis skip semua entry baru.
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Impact:</span>
        {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filterImpact === f ? 'default' : 'outline'}
            className="text-xs"
            onClick={() => setFilterImpact(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {/* News list */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <PanelCard
          title="Upcoming Events"
          subtitle={`${upcoming.length} berikutnya · Tiingo`}
          icon={CalendarClock}
          className="xl:col-span-2"
        >
          <div className="pt-3">
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-2 font-medium">Time (WIB)</th>
                    <th className="text-left font-medium">Currency</th>
                    <th className="text-left font-medium">Impact</th>
                    <th className="text-left font-medium">Event</th>
                    <th className="text-left font-medium">Country</th>
                    <th className="text-right font-medium">Forecast</th>
                    <th className="text-right font-medium">Previous</th>
                    <th className="text-right font-medium">Blackout</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((n) => {
                    const eventDate = new Date(n.eventTime);
                    const inBlackout = n.blackoutStart && n.blackoutEnd &&
                      now >= new Date(n.blackoutStart) && now <= new Date(n.blackoutEnd);
                    return (
                      <tr key={n.id} className={cn(
                        'border-b last:border-0 hover:bg-accent/30',
                        inBlackout && 'bg-bear/5'
                      )}>
                        <td className="py-1.5 px-2 tabular-nums">
                          <div>{eventDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' })}</div>
                          <div className="text-muted-foreground">
                            {eventDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}
                          </div>
                        </td>
                        <td>
                          <Badge variant="outline" className="text-[10px]">{n.currency}</Badge>
                        </td>
                        <td>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] px-1.5',
                              n.impact === 'HIGH' && 'text-bear border-bear',
                              n.impact === 'MEDIUM' && 'text-warn border-warn',
                              n.impact === 'LOW' && 'text-muted-foreground'
                            )}
                          >
                            {n.impact}
                          </Badge>
                        </td>
                        <td className="font-medium">{n.title}</td>
                        <td className="text-[10px]">{n.country}</td>
                        <td className="text-right tabular-nums text-[10px]">{n.forecast || '-'}</td>
                        <td className="text-right tabular-nums text-[10px]">{n.previous || '-'}</td>
                        <td className="text-right">
                          {n.impact === 'HIGH' ? (
                            <Badge variant="outline" className={cn(
                              'text-[9px] px-1',
                              inBlackout ? 'text-bear border-bear bg-bear/10' : 'text-muted-foreground'
                            )}>
                              {inBlackout ? 'ACTIVE' : `±${V2_RULES.NEWS_BLACKOUT_MINUTES}m`}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </PanelCard>

        {/* Weekly template */}
        <PanelCard
          title="Weekly News Template V2"
          subtitle="Kalender standar mingguan"
          icon={CalendarClock}
        >
          <div className="pt-3">
            <div className="flex flex-col gap-2">
              {TIINGO_NEWS_TEMPLATE.map((n, i) => (
                <div key={i} className="rounded-md border p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{n.day}</Badge>
                      <span className="text-xs font-mono tabular-nums">{n.time}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] px-1',
                        n.impact === 'HIGH' ? 'text-bear border-bear' : 'text-warn border-warn'
                      )}
                    >
                      {n.impact}
                    </Badge>
                  </div>
                  <div className="text-xs font-medium">{n.event}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{n.detail}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
              {WEEKLY_NEWS_BLACKLIST_NOTE}
            </div>
          </div>
        </PanelCard>
      </div>

      {/* Source info */}
      <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3 text-xs">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Source:</span>
          <span className="font-medium">Tiingo Economic Calendar API</span>
          <Badge variant="outline" className="text-[10px]">cache 1h</Badge>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
          <ExternalLink className="h-3 w-3" />
          Tiingo Docs
        </Button>
      </div>
    </div>
  );
}
