'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

const THEMES = [
  { id: 'system', label: 'System', icon: MonitorIcon },
  { id: 'light', label: 'Light', icon: SunIcon },
  { id: 'dark', label: 'Dark', icon: MoonIcon },
];

const subscribeNothing = () => () => undefined;

/** System, Light and Dark as three buttons. A choice applies at once and is kept in the browser. */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  // The saved theme is only known in the browser
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const current = (hydrated && THEMES.find((item) => item.id === theme)?.id) || 'system';

  return (
    <ButtonGroup aria-label="Theme">
      {THEMES.map((item) => (
        <Button key={item.id} type="button" variant={current === item.id ? 'secondary' : 'outline'} aria-pressed={current === item.id} onClick={() => setTheme(item.id)}>
          <item.icon />
          {item.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}
