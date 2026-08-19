import { Redirect } from 'expo-router';

// This screen is never shown — the tab press is intercepted to open the add-trip modal.
// If navigated to directly, redirect to home.
export default function PlanRedirect() {
  return <Redirect href="/" />;
}
