import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppGlobalSettings,
} from '../lib/appSettings';

export function useAppSettings(): {
  appSettings: AppGlobalSettings;
  appSettingsLoading: boolean;
} {
  const { user } = useAuth();
  const [appSettings, setAppSettings] = useState<AppGlobalSettings>(DEFAULT_APP_SETTINGS);
  const [appSettingsLoading, setAppSettingsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAppSettings(DEFAULT_APP_SETTINGS);
      setAppSettingsLoading(false);
      return;
    }

    setAppSettingsLoading(true);
    const ref = doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC);
    const unsub = onSnapshot(
      ref,
      snap => {
        setAppSettings(normalizeAppSettings(snap.exists() ? snap.data() : undefined));
        setAppSettingsLoading(false);
      },
      () => {
        setAppSettings(DEFAULT_APP_SETTINGS);
        setAppSettingsLoading(false);
      },
    );

    return () => unsub();
  }, [user]);

  return { appSettings, appSettingsLoading };
}
