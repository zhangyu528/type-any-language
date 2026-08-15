'use client';

/**
 * SettingsSection — the "设置" partition of the console.
 *
 * Reuses /me's SettingsTab verbatim (theme / audio rate / difficulty /
 * phonetics / logout / reset). The console now owns settings UI, so
 * /me redirects into here. SettingsTab reads `useAuth` itself, so no
 * props are needed.
 */

import SettingsTab from '../../me/SettingsTab';

export default function SettingsSection() {
  return <SettingsTab />;
}
