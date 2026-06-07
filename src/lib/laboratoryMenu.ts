import type { LucideIcon } from 'lucide-react';
import {
  BatteryCharging,
  Gauge,
  Printer,
  Ruler,
  ShieldCheck,
  Stamp,
  Thermometer,
  Weight,
  Wrench,
} from 'lucide-react';

export type LaboratoryMenuItem = {
  id: string;
  number: number;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Optional PNG/WebP in `public/laboratory/` — falls back to icon when missing. */
  imageSrc?: string;
};

export const LABORATORY_MENU_ITEMS: LaboratoryMenuItem[] = [
  {
    id: 'standard-weights',
    number: 1,
    title: 'Standard Weights',
    description: 'Manage standard and reference weights',
    icon: Weight,
    imageSrc: '/laboratory/standard-weights.png',
  },
  {
    id: 'environmental-monitoring',
    number: 2,
    title: 'Environmental Monitoring',
    description: 'Temperature & humidity monitoring and logs',
    icon: Thermometer,
    imageSrc: '/laboratory/environmental-monitoring.png',
  },
  {
    id: 'traceability',
    number: 3,
    title: 'Traceability',
    description: 'Manage traceability to national/international standards',
    icon: ShieldCheck,
    imageSrc: '/laboratory/traceability.png',
  },
  {
    id: 'seal-plier',
    number: 4,
    title: 'Seal Plier',
    description: 'Manage seal pliers and their verification records',
    icon: Stamp,
    imageSrc: '/laboratory/seal-plier.png',
  },
  {
    id: 'dies',
    number: 5,
    title: 'Dies',
    description: 'Manage dies and their verification records',
    icon: Wrench,
    imageSrc: '/laboratory/dies.png',
  },
  {
    id: 'level-monitor',
    number: 6,
    title: 'Level Monitor',
    description: 'Monitor instrument level accuracy and records',
    icon: Ruler,
    imageSrc: '/laboratory/level-monitor.png',
  },
  {
    id: 'multimeter',
    number: 7,
    title: 'Multimeter',
    description: 'Check electrical parameters of weighing scales',
    icon: Gauge,
    imageSrc: '/laboratory/multimeter.png',
  },
  {
    id: 'car-inverter',
    number: 8,
    title: 'Car Inverter',
    description: 'Power supply for field verification operations',
    icon: BatteryCharging,
    imageSrc: '/laboratory/car-inverter.png',
  },
  {
    id: 'qr-label-printer',
    number: 9,
    title: 'QR Label Printer',
    description: 'Print silver labels with QR code for verification',
    icon: Printer,
    imageSrc: '/laboratory/qr-label-printer.png',
  },
];
