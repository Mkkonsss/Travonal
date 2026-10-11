import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Route handler for Universal Links: tripseekapp.com/join/CODE
 * Expo Router matches this path automatically, then we redirect
 * to the join-trip screen with the code as a param.
 */
export default function JoinRedirect() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/join-trip' as any, params: { code: code?.toUpperCase() } }} />;
}
