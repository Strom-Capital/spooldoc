'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';

const THEMES = [
  { id: 'system', label: 'System', icon: MonitorIcon },
  { id: 'light', label: 'Light', icon: SunIcon },
  { id: 'dark', label: 'Dark', icon: MoonIcon },
];

const subscribeNothing = () => () => undefined;

/** System, Light and Dark as menu items, for the account menu. */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  // The saved theme is only known in the browser
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const current = (hydrated && THEMES.find((item) => item.id === theme)?.id) || 'system';

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={current} onValueChange={setTheme}>
        {THEMES.map((item) => (
          // Keep the menu open so the change can be seen
          <DropdownMenuRadioItem key={item.id} value={item.id} onSelect={(event) => event.preventDefault()}>
            <item.icon />
            {item.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
