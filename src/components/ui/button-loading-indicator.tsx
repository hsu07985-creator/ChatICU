import { useEffect, useState } from 'react';

import logoImage from '../../assets/f438047691c382addfed5c99dfc97977dea5c831.png';
import doctorImage from '../../assets/loading-role-doctor.svg';
import pharmacistImage from '../../assets/loading-role-pharmacist.svg';
import nurseImage from '../../assets/loading-role-nurse.svg';
import { cn } from './utils';

interface LoadingRole {
  key: string;
  imageSrc: string;
  label: string;
}

const LOADING_ROLES: LoadingRole[] = [
  {
    key: 'logo',
    imageSrc: logoImage,
    label: 'ChatICU',
  },
  {
    key: 'doctor',
    imageSrc: doctorImage,
    label: '醫師',
  },
  {
    key: 'pharmacist',
    imageSrc: pharmacistImage,
    label: '藥師',
  },
  {
    key: 'nurse',
    imageSrc: nurseImage,
    label: '護理師',
  },
];

interface ButtonLoadingIndicatorProps {
  className?: string;
  compact?: boolean;
  intervalMs?: number;
}

export function ButtonLoadingIndicator({
  className,
  compact = false,
  intervalMs = 800,
}: ButtonLoadingIndicatorProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % LOADING_ROLES.length);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  const iconSizeClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const containerGapClass = compact ? 'gap-0.5' : 'gap-1';

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex items-center justify-center shrink-0', containerGapClass, className)}
    >
      {LOADING_ROLES.map((role, index) => {
        const isActive = index === activeIndex;

        return (
          <span
            key={role.key}
            title={role.label}
            className={cn(
              'inline-flex items-center justify-center overflow-hidden rounded-full transition-opacity duration-300',
              iconSizeClass,
              isActive ? 'opacity-100' : 'opacity-30',
            )}
          >
            <img
              src={role.imageSrc}
              alt=""
              className={cn('h-full w-full object-cover', !isActive && 'grayscale-[0.25]')}
            />
          </span>
        );
      })}
    </span>
  );
}
