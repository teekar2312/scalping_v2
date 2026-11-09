'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  variant?: 'default' | 'bull' | 'bear' | 'warn' | 'info';
  className?: string;
}

export function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
  trendValue,
  variant = 'default',
  className,
}: StatCardProps) {
  const variantColor = {
    default: 'text-foreground',
    bull: 'text-bull',
    bear: 'text-bear',
    warn: 'text-warn',
    info: 'text-info',
  }[variant];

  return (
    <Card className={cn('density-card', className)}>
      <CardContent className="p-0">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="density-text-xs text-muted-foreground uppercase tracking-wide">
              {label}
            </span>
            <div className="flex items-baseline gap-1">
              <span className={cn('density-text text-2xl font-bold tabular-nums', variantColor)}>
                {value}
              </span>
              {unit && <span className="density-text-xs text-muted-foreground">{unit}</span>}
            </div>
            {trend && trendValue && (
              <span
                className={cn(
                  'density-text-xs font-medium tabular-nums',
                  trend === 'up' && 'text-bull',
                  trend === 'down' && 'text-bear',
                  trend === 'neutral' && 'text-muted-foreground'
                )}
              >
                {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
              </span>
            )}
          </div>
          {Icon && <Icon className={cn('density-icon', variantColor, 'opacity-70')} />}
        </div>
      </CardContent>
    </Card>
  );
}

interface PanelCardProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function PanelCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: PanelCardProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-3 pt-3 px-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <div>
            <CardTitle className="text-sm font-semibold leading-tight">{title}</CardTitle>
            {subtitle && <p className="text-xs text-muted-foreground leading-tight mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </CardHeader>
      <CardContent className={cn('flex-1 overflow-auto scroll-thin', bodyClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

interface StatusDotProps {
  status: 'ok' | 'error' | 'warning' | 'idle';
  label: string;
  value?: string;
}

export function StatusDot({ status, label, value }: StatusDotProps) {
  const colorMap = {
    ok: 'bg-bull',
    error: 'bg-bear',
    warning: 'bg-warn',
    idle: 'bg-muted-foreground',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-full', colorMap[status])} />
      <span className="density-text-xs text-muted-foreground">{label}</span>
      {value && <span className="density-text-xs font-medium tabular-nums">{value}</span>}
    </div>
  );
}
