import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { loadProfileSafe, saveProfile } from '@/services/storage';
import { useAuth } from '@/context/auth';
import { pushProfile, pullProfile } from '@/services/sync';

export interface TravelProfile {
  pace: 'relaxed' | 'moderate' | 'active';
  flexibility: 'planned' | 'some' | 'freeflow';
  /** Only set if the user explicitly chose a budget preference. */
  budget?: 'budget' | 'moderate' | 'premium';
  interests: string[];
  dietaryRestrictions: string[];
  /** Free-text note about dietary needs (e.g. "severe peanut allergy"). */
  dietaryNote?: string;
  mobilityNeeds: string[];
  /** Catch-all free-text field from the optional final survey question. */
  anythingElse?: string;
  dislikes: string[];
  absoluteRules: string[];
  /** Only set if the user explicitly answered who they travel with. */
  travelWith?: 'solo' | 'partner' | 'family' | 'friends' | 'group';
  accommodationPreference: 'hostel' | 'hotel' | 'boutique' | 'resort' | 'apartment';
  /** Up to 3 factors the user uses to judge a place. */
  decisionPriorities?: string[];
  crowdTolerance?: 'fine' | 'moderate' | 'avoid';
  foodImportance?: 'big' | 'care' | 'simple';
  /** Up to 2 categories where the user is happy to spend more. */
  spendingPriorities?: string[];
  recommendationStyle?: 'best' | 'few' | 'explore';
}

const DEFAULT_PROFILE: TravelProfile = {
  pace: 'moderate',
  flexibility: 'some',
  // budget intentionally omitted — only set if user explicitly chose
  interests: [],
  dietaryRestrictions: [],
  mobilityNeeds: [],
  dislikes: [],
  absoluteRules: [],
  // travelWith intentionally omitted — only set if user explicitly chose
  accommodationPreference: 'hotel',
};

interface ProfileContextType {
  profile: TravelProfile;
  loaded: boolean;
  updateProfile: (updates: Partial<TravelProfile>) => void;
  resetProfile: () => void;
  setSyncErrorCallback: (cb: () => void) => void;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<TravelProfile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncErrorCallback = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadProfileSafe<TravelProfile>(DEFAULT_PROFILE).then((result) => {
      if (!result.ok) setLoadFailed(true);
      setProfile(result.data);
      setLoaded(true);
    });
  }, []);

  // On sign-in, pull remote profile — only apply fields the remote actually has set
  useEffect(() => {
    if (!loaded || !user?.id) return;
    pullProfile(user.id).then((result) => {
      if (!result) return;
      const remote = result.profile;
      // Only merge non-default fields from remote to avoid overwriting local customizations
      // with stale default values from an old remote save
      setProfile((prev) => {
        const merged = { ...prev };
        for (const key of Object.keys(remote) as (keyof TravelProfile)[]) {
          const val = remote[key];
          // Skip undefined/null and empty arrays — these are likely unset defaults
          if (val === undefined || val === null) continue;
          if (Array.isArray(val) && val.length === 0) continue;
          (merged as any)[key] = val;
        }
        return merged;
      });
    });
  }, [loaded, user?.id]);

  // Save to AsyncStorage on every change
  useEffect(() => {
    if (loaded && !loadFailed) {
      saveProfile(profile);
    }
  }, [profile, loaded, loadFailed]);

  // Push to Supabase (debounced)
  useEffect(() => {
    if (!loaded || !user?.id) return;
    const userId = user.id;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      const ok = await pushProfile(userId, profile);
      if (!ok && syncErrorCallback.current) syncErrorCallback.current();
    }, 1500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [profile, loaded, user?.id]);

  function updateProfile(updates: Partial<TravelProfile>) {
    setProfile((prev) => ({ ...prev, ...updates }));
  }

  function resetProfile() {
    setProfile(DEFAULT_PROFILE);
  }

  function setSyncErrorCb(cb: () => void) {
    syncErrorCallback.current = cb;
  }

  return (
    <ProfileContext.Provider value={{ profile, loaded, updateProfile, resetProfile, setSyncErrorCallback: setSyncErrorCb }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
