export type DemoExpense = {
  readonly id: string;
  readonly title: string;
  readonly category: 'market' | 'coffee' | 'transport';
  readonly categoryLabel: string;
  readonly timeLabel: string;
  readonly amount: number;
};

// Fixed display fixtures. These values are not calculated or persisted.
export const demoBudget = {
  dateLabel: '25 EKİM 2026, PAZAR',
  dailyBudget: 1250,
  remainingBudget: 15000,
  daysUntilPayday: 12,
  paydayLabel: '6 Kasım',
} as const;

export const demoExpenses: readonly DemoExpense[] = [
  {
    id: 'demo-market',
    title: 'Market alışverişi',
    category: 'market',
    categoryLabel: 'Market',
    timeLabel: 'Bugün, 12.40',
    amount: -485.5,
  },
  {
    id: 'demo-coffee',
    title: 'Kahve molası',
    category: 'coffee',
    categoryLabel: 'Yeme içme',
    timeLabel: 'Bugün, 10.15',
    amount: -95,
  },
  {
    id: 'demo-transport',
    title: 'Ulaşım',
    category: 'transport',
    categoryLabel: 'Ulaşım',
    timeLabel: 'Bugün, 08.30',
    amount: -42,
  },
];
