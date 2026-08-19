import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { loadProfileSafe, saveProfile } from '@/services/storage';

export interface TravelProfile {
  pace: 'relaxed' | 'moderate' | 'active';
  flexibility: 'planned' | 'some' | 'freeflow';
  budget: 'budget' | 'moderate' | 'premium';
  interests: string[];
  dietaryRestrictions: string[];
  mobilityNeeds: string[];
  dislikes: string[];
  absoluteRules: string[];
  travelWith: 'solo' | 'partner' | 'family' | 'friends' | 'group';
  accommodationPreference: 'hostel' | 'hotel' | 'boutique' | 'resort' | 'apartment';
}

const DEFAULT_PROFILE: TravelProfile = {
  pace: 'moderate',
  flexibility: 'some',
  budget: 'moderate',
  interests: [],
  dietaryRestrictions: [],
  mobilityNeeds: [],
  dislikes: [],
  absoluteRules: [],
  travelWith: 'solo',
  accommodationPreference: 'hotel',
};

interface ProfileContextType {
  profile: TravelProfile;
  loaded: boolean;
  updateProfile: (updates: Partial<TravelProfile>) => void;
  resetProfile: () => void;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<TravelProfile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    loadProfileSafe<TravelProfile>(DEFAULT_PROFILE).then((result) => {
      if (!result.ok) setLoadFailed(true);
      setProfile(result.data);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded && !loadFailed) {
      saveProfile(profile);
    }
  }, [profile, loaded, loadFailed]);

  function updateProfile(updates: Partial<TravelProfile>) {
    setProfile((prev) => ({ ...prev, ...updates }));
  }

  function resetProfile() {
    setProfile(DEFAULT_PROFILE);
  }

  return (
    <ProfileContext.Provider value={{ profile, loaded, updateProfile, resetProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
  return ctx;
}
